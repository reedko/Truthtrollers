-- Content Rating & Evaluation System - V2 (Adds to existing user_reputation)
-- Run this with: mysql -u root -pTrollers2020 truthtrollers < add_content_rating_system_v2.sql

USE truthtrollers;

-- ══════════════════════════════════════════════════════════════════
-- TABLE 1: Content Ratings (User-assembled evidence chains)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS content_ratings (
  content_rating_id INT PRIMARY KEY AUTO_INCREMENT,
  content_id INT NOT NULL,
  user_id INT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  approval_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  votes_approve INT DEFAULT 0,
  votes_reject INT DEFAULT 0,
  total_votes INT DEFAULT 0,
  avg_evaluation_score DECIMAL(5,2) NULL,
  total_points DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  submitted_at TIMESTAMP NULL,
  finalized_at TIMESTAMP NULL,
  UNIQUE KEY unique_user_content (user_id, content_id),
  FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_approval_status (approval_status),
  INDEX idx_completed (completed),
  INDEX idx_user (user_id),
  INDEX idx_content (content_id),
  INDEX idx_submitted (submitted_at),
  INDEX idx_votes (votes_approve, votes_reject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ══════════════════════════════════════════════════════════════════
-- TABLE 2: Content Rating Evaluations (Peer votes)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS content_rating_evaluations (
  evaluation_id INT PRIMARY KEY AUTO_INCREMENT,
  content_rating_id INT NOT NULL,
  evaluator_user_id INT NOT NULL,
  score INT NOT NULL,
  vote ENUM('approve', 'reject') NOT NULL,
  notes TEXT NULL,
  evaluator_points DECIMAL(5,2) DEFAULT 15.0,
  subject_points DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (content_rating_id) REFERENCES content_ratings(content_rating_id) ON DELETE CASCADE,
  FOREIGN KEY (evaluator_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE KEY unique_evaluator_content (evaluator_user_id, content_rating_id),
  INDEX idx_content_rating (content_rating_id),
  INDEX idx_evaluator (evaluator_user_id),
  INDEX idx_vote (vote),
  INDEX idx_score (score),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ══════════════════════════════════════════════════════════════════
-- TABLE 3: Add columns to existing user_reputation table
-- ══════════════════════════════════════════════════════════════════

-- Add new columns for content rating system (keep existing columns)
ALTER TABLE user_reputation
  ADD COLUMN IF NOT EXISTS content_ratings_submitted INT DEFAULT 0 AFTER bias_vector,
  ADD COLUMN IF NOT EXISTS content_ratings_approved INT DEFAULT 0 AFTER content_ratings_submitted,
  ADD COLUMN IF NOT EXISTS content_ratings_rejected INT DEFAULT 0 AFTER content_ratings_approved,
  ADD COLUMN IF NOT EXISTS content_ratings_pending INT DEFAULT 0 AFTER content_ratings_rejected,
  ADD COLUMN IF NOT EXISTS approval_rate DECIMAL(5,2) DEFAULT 0 AFTER content_ratings_pending,
  ADD COLUMN IF NOT EXISTS avg_content_score DECIMAL(5,2) DEFAULT 0 AFTER approval_rate,
  ADD COLUMN IF NOT EXISTS evaluations_given INT DEFAULT 0 AFTER avg_content_score,
  ADD COLUMN IF NOT EXISTS avg_evaluation_score_given DECIMAL(5,2) DEFAULT 0 AFTER evaluations_given,
  ADD COLUMN IF NOT EXISTS total_points DECIMAL(10,2) DEFAULT 0 AFTER avg_evaluation_score_given,
  ADD COLUMN IF NOT EXISTS veracity_rating DECIMAL(5,2) DEFAULT 50.0 AFTER total_points,
  ADD COLUMN IF NOT EXISTS reputation_level INT DEFAULT 1 AFTER veracity_rating,
  ADD COLUMN IF NOT EXISTS consistency_score DECIMAL(5,2) DEFAULT 50.0 AFTER reputation_level,
  ADD COLUMN IF NOT EXISTS evidence_quality DECIMAL(5,2) DEFAULT 50.0 AFTER consistency_score,
  ADD COLUMN IF NOT EXISTS total_penalties INT DEFAULT 0 AFTER evidence_quality,
  ADD COLUMN IF NOT EXISTS penalty_points DECIMAL(10,2) DEFAULT 0 AFTER total_penalties,
  ADD COLUMN IF NOT EXISTS last_penalty_at TIMESTAMP NULL AFTER penalty_points,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP NULL AFTER last_penalty_at;

-- Add indexes for new columns
ALTER TABLE user_reputation
  ADD INDEX IF NOT EXISTS idx_veracity (veracity_rating),
  ADD INDEX IF NOT EXISTS idx_points (total_points),
  ADD INDEX IF NOT EXISTS idx_level (reputation_level),
  ADD INDEX IF NOT EXISTS idx_approval_rate (approval_rate);

-- ══════════════════════════════════════════════════════════════════
-- TRIGGERS - Auto-update on evaluation
-- ══════════════════════════════════════════════════════════════════

DELIMITER $$

DROP TRIGGER IF EXISTS after_content_evaluation_insert$$

CREATE TRIGGER after_content_evaluation_insert
AFTER INSERT ON content_rating_evaluations
FOR EACH ROW
BEGIN
  DECLARE approve_count INT;
  DECLARE reject_count INT;
  DECLARE avg_score DECIMAL(5,2);

  -- Count votes
  SELECT
    SUM(CASE WHEN vote = 'approve' THEN 1 ELSE 0 END),
    SUM(CASE WHEN vote = 'reject' THEN 1 ELSE 0 END),
    AVG(score)
  INTO approve_count, reject_count, avg_score
  FROM content_rating_evaluations
  WHERE content_rating_id = NEW.content_rating_id;

  -- Update content_rating
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
      WHEN approve_count >= 2
      THEN GREATEST(0, avg_score)
      ELSE 0
    END
  WHERE content_rating_id = NEW.content_rating_id;

  -- Update evaluator reputation
  UPDATE user_reputation
  SET
    evaluations_given = evaluations_given + 1,
    avg_evaluation_score_given = (
      (avg_evaluation_score_given * (evaluations_given - 1) + NEW.score) / evaluations_given
    ),
    last_activity_at = NOW()
  WHERE user_id = NEW.evaluator_user_id;

  -- Create reputation record if doesn't exist
  INSERT IGNORE INTO user_reputation (user_id, evaluations_given, avg_evaluation_score_given, last_activity_at)
  VALUES (NEW.evaluator_user_id, 1, NEW.score, NOW());
END$$

DROP TRIGGER IF EXISTS after_content_rating_update$$

CREATE TRIGGER after_content_rating_update
AFTER UPDATE ON content_ratings
FOR EACH ROW
BEGIN
  DECLARE total_submitted INT;
  DECLARE total_approved INT;
  DECLARE total_rejected INT;
  DECLARE total_pending INT;
  DECLARE avg_score DECIMAL(5,2);
  DECLARE total_pts DECIMAL(10,2);

  IF OLD.approval_status != NEW.approval_status THEN
    -- Get aggregate stats
    SELECT
      COUNT(*),
      SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END),
      SUM(CASE WHEN approval_status = 'rejected' THEN 1 ELSE 0 END),
      SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END),
      AVG(COALESCE(avg_evaluation_score, 0)),
      SUM(COALESCE(total_points, 0))
    INTO total_submitted, total_approved, total_rejected, total_pending, avg_score, total_pts
    FROM content_ratings
    WHERE user_id = NEW.user_id;

    -- Update user reputation
    UPDATE user_reputation
    SET
      content_ratings_submitted = total_submitted,
      content_ratings_approved = total_approved,
      content_ratings_rejected = total_rejected,
      content_ratings_pending = total_pending,
      approval_rate = (total_approved / GREATEST(total_submitted, 1)) * 100,
      avg_content_score = avg_score,
      total_points = total_pts,
      veracity_rating = GREATEST(0, LEAST(100,
        (total_approved / GREATEST(total_submitted, 1)) * 100 * 0.6 +
        (avg_score + 99) / 198 * 100 * 0.4
      )),
      last_activity_at = NOW()
    WHERE user_id = NEW.user_id;

    -- Create reputation record if doesn't exist
    INSERT IGNORE INTO user_reputation (
      user_id,
      content_ratings_submitted,
      content_ratings_approved,
      content_ratings_rejected,
      content_ratings_pending,
      approval_rate,
      avg_content_score,
      total_points,
      veracity_rating,
      last_activity_at
    ) VALUES (
      NEW.user_id,
      total_submitted,
      total_approved,
      total_rejected,
      total_pending,
      (total_approved / GREATEST(total_submitted, 1)) * 100,
      avg_score,
      total_pts,
      GREATEST(0, LEAST(100, (total_approved / GREATEST(total_submitted, 1)) * 100 * 0.6 + (avg_score + 99) / 198 * 100 * 0.4)),
      NOW()
    );
  END IF;
END$$

DELIMITER ;

-- ══════════════════════════════════════════════════════════════════
-- DONE!
-- ══════════════════════════════════════════════════════════════════
SELECT 'Content Rating System installed successfully!' as status;
