-- Content Rating & Evaluation System - Fixed
-- Run this with: mysql -u root -pTrollers2020 truthtrollers < add_content_rating_system_fixed.sql

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
-- TABLE 3: User Reputation (Aggregate track record)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_reputation (
  user_id INT PRIMARY KEY,
  content_ratings_submitted INT DEFAULT 0,
  content_ratings_approved INT DEFAULT 0,
  content_ratings_rejected INT DEFAULT 0,
  content_ratings_pending INT DEFAULT 0,
  approval_rate DECIMAL(5,2) DEFAULT 0,
  avg_content_score DECIMAL(5,2) DEFAULT 0,
  evaluations_given INT DEFAULT 0,
  avg_evaluation_score_given DECIMAL(5,2) DEFAULT 0,
  total_points DECIMAL(10,2) DEFAULT 0,
  veracity_rating DECIMAL(5,2) DEFAULT 50.0,
  reputation_level INT DEFAULT 1,
  consistency_score DECIMAL(5,2) DEFAULT 50.0,
  evidence_quality DECIMAL(5,2) DEFAULT 50.0,
  bias_score DECIMAL(5,2) DEFAULT 50.0,
  total_penalties INT DEFAULT 0,
  penalty_points DECIMAL(10,2) DEFAULT 0,
  last_penalty_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_veracity (veracity_rating),
  INDEX idx_points (total_points),
  INDEX idx_level (reputation_level),
  INDEX idx_approval_rate (approval_rate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  INSERT INTO user_reputation (user_id, evaluations_given, avg_evaluation_score_given, last_activity_at)
  VALUES (NEW.evaluator_user_id, 1, NEW.score, NOW())
  ON DUPLICATE KEY UPDATE
    evaluations_given = evaluations_given + 1,
    avg_evaluation_score_given = (
      (avg_evaluation_score_given * evaluations_given + NEW.score) / (evaluations_given + 1)
    ),
    last_activity_at = NOW();
END$$

DROP TRIGGER IF EXISTS after_content_rating_update$$

CREATE TRIGGER after_content_rating_update
AFTER UPDATE ON content_ratings
FOR EACH ROW
BEGIN
  IF OLD.approval_status != NEW.approval_status THEN
    -- Update user reputation stats
    INSERT INTO user_reputation (
      user_id,
      content_ratings_submitted,
      content_ratings_approved,
      content_ratings_rejected,
      content_ratings_pending,
      avg_content_score,
      total_points,
      last_activity_at
    )
    SELECT
      NEW.user_id,
      COUNT(*),
      SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END),
      SUM(CASE WHEN approval_status = 'rejected' THEN 1 ELSE 0 END),
      SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END),
      AVG(COALESCE(avg_evaluation_score, 0)),
      SUM(COALESCE(total_points, 0)),
      NOW()
    FROM content_ratings
    WHERE user_id = NEW.user_id
    ON DUPLICATE KEY UPDATE
      content_ratings_submitted = VALUES(content_ratings_submitted),
      content_ratings_approved = VALUES(content_ratings_approved),
      content_ratings_rejected = VALUES(content_ratings_rejected),
      content_ratings_pending = VALUES(content_ratings_pending),
      approval_rate = (VALUES(content_ratings_approved) / GREATEST(VALUES(content_ratings_submitted), 1)) * 100,
      avg_content_score = VALUES(avg_content_score),
      total_points = VALUES(total_points),
      veracity_rating = GREATEST(0, LEAST(100,
        (VALUES(content_ratings_approved) / GREATEST(VALUES(content_ratings_submitted), 1)) * 100 * 0.6 +
        (VALUES(avg_content_score) + 99) / 198 * 100 * 0.4
      )),
      last_activity_at = NOW();
  END IF;
END$$

DELIMITER ;

-- ══════════════════════════════════════════════════════════════════
-- Initialize reputation for existing users
-- ══════════════════════════════════════════════════════════════════
INSERT INTO user_reputation (user_id)
SELECT user_id FROM users
WHERE user_id NOT IN (SELECT user_id FROM user_reputation);

-- ══════════════════════════════════════════════════════════════════
-- DONE!
-- ══════════════════════════════════════════════════════════════════
SELECT 'Content Rating System installed successfully!' as status;
