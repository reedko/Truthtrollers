-- Add voting fields to existing approval system
-- Note: Skip errors if columns already exist

ALTER TABLE user_claim_ratings
ADD COLUMN votes_for INT DEFAULT 0 AFTER approval_status,
ADD COLUMN votes_against INT DEFAULT 0 AFTER votes_for,
ADD COLUMN total_votes INT DEFAULT 0 AFTER votes_against,
ADD COLUMN finalized_at TIMESTAMP NULL AFTER total_votes;

ALTER TABLE user_veracity_ratings
ADD COLUMN votes_for INT DEFAULT 0 AFTER approval_status,
ADD COLUMN votes_against INT DEFAULT 0 AFTER votes_for,
ADD COLUMN total_votes INT DEFAULT 0 AFTER votes_against,
ADD COLUMN finalized_at TIMESTAMP NULL AFTER total_votes;

CREATE INDEX idx_total_votes ON user_claim_ratings(total_votes);
CREATE INDEX idx_total_votes_veracity ON user_veracity_ratings(total_votes);

CREATE TABLE rating_votes (
  vote_id INT AUTO_INCREMENT PRIMARY KEY,
  rating_id INT NOT NULL,
  rating_type ENUM('claim', 'veracity') NOT NULL,
  evaluator_user_id INT NOT NULL,
  vote ENUM('approve', 'reject') NOT NULL,
  notes TEXT NULL,
  points_earned DECIMAL(5,1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_vote (rating_id, rating_type, evaluator_user_id),
  FOREIGN KEY (evaluator_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_rating (rating_id, rating_type),
  INDEX idx_evaluator (evaluator_user_id),
  INDEX idx_vote (vote)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_evaluation_stats (
  stat_id INT AUTO_INCREMENT PRIMARY KEY,
  evaluator_user_id INT NOT NULL,
  total_evaluations INT DEFAULT 0,
  total_approvals INT DEFAULT 0,
  total_rejections INT DEFAULT 0,
  total_points_earned DECIMAL(10,1) DEFAULT 0,
  average_evaluation_quality DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_evaluator (evaluator_user_id),
  FOREIGN KEY (evaluator_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_points (total_points_earned),
  INDEX idx_quality (average_evaluation_quality)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
