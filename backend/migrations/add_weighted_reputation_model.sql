-- Migration: Weighted reputation model for content-rating governance
-- Purpose:
--   Weight earned reputation by approved rating volume, evaluator scores,
--   evaluator reputation, and evaluator participation.

USE truthtrollers;

DELIMITER $$

DROP PROCEDURE IF EXISTS add_weighted_reputation_columns$$

CREATE PROCEDURE add_weighted_reputation_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_reputation'
      AND COLUMN_NAME = 'weighted_avg_content_score'
  ) THEN
    ALTER TABLE user_reputation
      ADD COLUMN weighted_avg_content_score DECIMAL(5,2) DEFAULT 0
      COMMENT 'Approved-content evaluator score weighted by evaluator reputation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_reputation'
      AND COLUMN_NAME = 'reputation_confidence'
  ) THEN
    ALTER TABLE user_reputation
      ADD COLUMN reputation_confidence DECIMAL(5,2) DEFAULT 0
      COMMENT '0-100 confidence based on approved rating volume';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_reputation'
      AND COLUMN_NAME = 'evaluator_activity_score'
  ) THEN
    ALTER TABLE user_reputation
      ADD COLUMN evaluator_activity_score DECIMAL(5,2) DEFAULT 0
      COMMENT '0-100 score based on number of evaluations given';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_rating_evaluations'
      AND COLUMN_NAME = 'evaluator_reputation_at_evaluation'
  ) THEN
    ALTER TABLE content_rating_evaluations
      ADD COLUMN evaluator_reputation_at_evaluation DECIMAL(5,2) DEFAULT NULL
      COMMENT 'Evaluator veracity score snapshotted when this evaluation was submitted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_rating_evaluations'
      AND COLUMN_NAME = 'evaluator_weight'
  ) THEN
    ALTER TABLE content_rating_evaluations
      ADD COLUMN evaluator_weight DECIMAL(6,4) DEFAULT NULL
      COMMENT 'Weight derived from evaluator reputation at evaluation time';
  END IF;
END$$

CALL add_weighted_reputation_columns()$$
DROP PROCEDURE IF EXISTS add_weighted_reputation_columns$$

DROP PROCEDURE IF EXISTS recalculate_user_reputation$$

CREATE PROCEDURE recalculate_user_reputation(IN p_user_id INT)
BEGIN
  DECLARE v_total_submitted INT DEFAULT 0;
  DECLARE v_total_approved INT DEFAULT 0;
  DECLARE v_total_rejected INT DEFAULT 0;
  DECLARE v_total_pending INT DEFAULT 0;
  DECLARE v_avg_score DECIMAL(8,4) DEFAULT 0;
  DECLARE v_weighted_avg_score DECIMAL(8,4) DEFAULT 0;
  DECLARE v_total_points DECIMAL(10,2) DEFAULT 0;
  DECLARE v_evaluations_given INT DEFAULT 0;
  DECLARE v_avg_evaluation_given DECIMAL(8,4) DEFAULT 0;
  DECLARE v_approval_rate DECIMAL(8,4) DEFAULT 0;
  DECLARE v_reputation_confidence DECIMAL(8,4) DEFAULT 0;
  DECLARE v_evaluator_activity_score DECIMAL(8,4) DEFAULT 0;
  DECLARE v_weighted_score_normalized DECIMAL(8,4) DEFAULT 50;
  DECLARE v_confidence_adjusted_score DECIMAL(8,4) DEFAULT 50;
  DECLARE v_veracity_rating DECIMAL(8,4) DEFAULT 50;

  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN approval_status = 'rejected' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END), 0),
    COALESCE(AVG(CASE WHEN approval_status = 'approved' THEN avg_evaluation_score END), 0),
    COALESCE(SUM(CASE WHEN approval_status = 'approved' THEN total_points ELSE 0 END), 0)
  INTO
    v_total_submitted,
    v_total_approved,
    v_total_rejected,
    v_total_pending,
    v_avg_score,
    v_total_points
  FROM content_ratings
  WHERE user_id = p_user_id;

  SELECT
    COALESCE(
      SUM(cre.score * COALESCE(cre.evaluator_weight, 0.5 + COALESCE(evaluator_rep.veracity_rating, 50) / 100))
      / NULLIF(SUM(COALESCE(cre.evaluator_weight, 0.5 + COALESCE(evaluator_rep.veracity_rating, 50) / 100)), 0),
      0
    )
  INTO v_weighted_avg_score
  FROM content_ratings cr
  JOIN content_rating_evaluations cre
    ON cre.content_rating_id = cr.content_rating_id
  LEFT JOIN user_reputation evaluator_rep
    ON evaluator_rep.user_id = cre.evaluator_user_id
  WHERE cr.user_id = p_user_id
    AND cr.approval_status = 'approved';

  SELECT
    COUNT(*),
    COALESCE(AVG(score), 0)
  INTO
    v_evaluations_given,
    v_avg_evaluation_given
  FROM content_rating_evaluations
  WHERE evaluator_user_id = p_user_id;

  SET v_approval_rate = (v_total_approved / GREATEST(v_total_submitted, 1)) * 100;

  -- Log scale: reaches 100 confidence around 10 approved ratings.
  SET v_reputation_confidence = LEAST(100, (LOG(1 + v_total_approved) / LOG(11)) * 100);

  -- Log scale: reaches 100 activity score around 20 evaluations given.
  SET v_evaluator_activity_score = LEAST(100, (LOG(1 + v_evaluations_given) / LOG(21)) * 100);

  SET v_weighted_score_normalized = ((v_weighted_avg_score + 99) / 198) * 100;
  SET v_confidence_adjusted_score =
    50 + ((v_weighted_score_normalized - 50) * (v_reputation_confidence / 100));

  -- Reputation model:
  --   45% approval rate from submitted work
  --   35% evaluator-reputation-weighted score on approved work, damped by volume
  --   10% approved-rating volume confidence
  --   10% evaluation participation
  SET v_veracity_rating = GREATEST(0, LEAST(100,
    (v_approval_rate * 0.45) +
    (v_confidence_adjusted_score * 0.35) +
    (v_reputation_confidence * 0.10) +
    (v_evaluator_activity_score * 0.10)
  ));

  INSERT INTO user_reputation (
    user_id,
    content_ratings_submitted,
    content_ratings_approved,
    content_ratings_rejected,
    content_ratings_pending,
    approval_rate,
    avg_content_score,
    weighted_avg_content_score,
    evaluations_given,
    avg_evaluation_score_given,
    total_points,
    veracity_rating,
    reputation_confidence,
    evaluator_activity_score,
    last_activity_at
  ) VALUES (
    p_user_id,
    v_total_submitted,
    v_total_approved,
    v_total_rejected,
    v_total_pending,
    v_approval_rate,
    v_avg_score,
    v_weighted_avg_score,
    v_evaluations_given,
    v_avg_evaluation_given,
    v_total_points,
    v_veracity_rating,
    v_reputation_confidence,
    v_evaluator_activity_score,
    NOW()
  )
  ON DUPLICATE KEY UPDATE
    content_ratings_submitted = VALUES(content_ratings_submitted),
    content_ratings_approved = VALUES(content_ratings_approved),
    content_ratings_rejected = VALUES(content_ratings_rejected),
    content_ratings_pending = VALUES(content_ratings_pending),
    approval_rate = VALUES(approval_rate),
    avg_content_score = VALUES(avg_content_score),
    weighted_avg_content_score = VALUES(weighted_avg_content_score),
    evaluations_given = VALUES(evaluations_given),
    avg_evaluation_score_given = VALUES(avg_evaluation_score_given),
    total_points = VALUES(total_points),
    veracity_rating = VALUES(veracity_rating),
    reputation_confidence = VALUES(reputation_confidence),
    evaluator_activity_score = VALUES(evaluator_activity_score),
    last_activity_at = VALUES(last_activity_at);
END$$

DROP TRIGGER IF EXISTS after_content_evaluation_insert$$
DROP TRIGGER IF EXISTS before_content_evaluation_insert_weight$$

CREATE TRIGGER before_content_evaluation_insert_weight
BEFORE INSERT ON content_rating_evaluations
FOR EACH ROW
BEGIN
  DECLARE evaluator_veracity DECIMAL(5,2) DEFAULT 50;

  SET evaluator_veracity = COALESCE(
    (
      SELECT veracity_rating
      FROM user_reputation
      WHERE user_id = NEW.evaluator_user_id
      LIMIT 1
    ),
    50
  );

  SET NEW.evaluator_reputation_at_evaluation = evaluator_veracity;
  SET NEW.evaluator_weight = 0.5 + (evaluator_veracity / 100);
END$$

CREATE TRIGGER after_content_evaluation_insert
AFTER INSERT ON content_rating_evaluations
FOR EACH ROW
BEGIN
  DECLARE approve_count INT DEFAULT 0;
  DECLARE reject_count INT DEFAULT 0;
  DECLARE avg_score DECIMAL(5,2) DEFAULT 0;
  DECLARE rating_user_id INT;

  SELECT
    COALESCE(SUM(CASE WHEN vote = 'approve' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vote = 'reject' THEN 1 ELSE 0 END), 0),
    COALESCE(AVG(score), 0)
  INTO approve_count, reject_count, avg_score
  FROM content_rating_evaluations
  WHERE content_rating_id = NEW.content_rating_id;

  UPDATE content_ratings
  SET
    votes_approve = approve_count,
    votes_reject = reject_count,
    total_votes = approve_count + reject_count,
    avg_evaluation_score = avg_score,
    approval_status = CASE
      WHEN approve_count >= 2 THEN 'approved'
      WHEN reject_count >= 2 THEN 'rejected'
      ELSE approval_status
    END,
    finalized_at = CASE
      WHEN (approve_count >= 2 OR reject_count >= 2) AND finalized_at IS NULL
      THEN NOW()
      ELSE finalized_at
    END,
    total_points = CASE
      WHEN approve_count >= 2 THEN GREATEST(0, avg_score)
      ELSE 0
    END
  WHERE content_rating_id = NEW.content_rating_id;

  SELECT user_id
  INTO rating_user_id
  FROM content_ratings
  WHERE content_rating_id = NEW.content_rating_id;

  CALL recalculate_user_reputation(NEW.evaluator_user_id);
  CALL recalculate_user_reputation(rating_user_id);
END$$

DROP TRIGGER IF EXISTS after_content_rating_update$$

CREATE TRIGGER after_content_rating_update
AFTER UPDATE ON content_ratings
FOR EACH ROW
BEGIN
  IF OLD.approval_status != NEW.approval_status
    OR OLD.avg_evaluation_score != NEW.avg_evaluation_score
    OR OLD.total_points != NEW.total_points
  THEN
    CALL recalculate_user_reputation(NEW.user_id);
  END IF;
END$$

DROP PROCEDURE IF EXISTS refresh_all_user_reputation$$

CREATE PROCEDURE refresh_all_user_reputation()
BEGIN
  DECLARE done INT DEFAULT FALSE;
  DECLARE current_user_id INT;
  DECLARE user_cursor CURSOR FOR SELECT user_id FROM users;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

  OPEN user_cursor;

  read_loop: LOOP
    FETCH user_cursor INTO current_user_id;
    IF done THEN
      LEAVE read_loop;
    END IF;

    CALL recalculate_user_reputation(current_user_id);
  END LOOP;

  CLOSE user_cursor;
END$$

DELIMITER ;

CALL refresh_all_user_reputation();

SELECT 'Weighted reputation model installed and recalculated' AS status;
