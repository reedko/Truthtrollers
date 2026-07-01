-- Migration: Add multi-evaluator voting system to user_claim_ratings
-- Requires 2 out of 3 votes to approve a rating

-- Add approval tracking fields to user_claim_ratings
ALTER TABLE user_claim_ratings
ADD COLUMN approval_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending' AFTER honesty_score,
ADD COLUMN votes_for INT DEFAULT 0 AFTER approval_status,
ADD COLUMN votes_against INT DEFAULT 0 AFTER votes_for,
ADD COLUMN total_votes INT DEFAULT 0 AFTER votes_against,
ADD COLUMN finalized_at TIMESTAMP NULL AFTER total_votes,
ADD COLUMN user_points DECIMAL(5,1) DEFAULT 0 COMMENT 'Points earned by rated user if approved',
ADD INDEX idx_approval_status (approval_status),
ADD INDEX idx_votes (total_votes);

-- Create user_evaluation_stats table to track evaluator performance
CREATE TABLE IF NOT EXISTS user_evaluation_stats (
  stat_id INT AUTO_INCREMENT PRIMARY KEY,
  evaluator_user_id INT NOT NULL,
  total_evaluations INT DEFAULT 0,
  total_approvals INT DEFAULT 0,
  total_rejections INT DEFAULT 0,
  total_points_earned DECIMAL(10,1) DEFAULT 0,
  average_evaluation_quality DECIMAL(5,2) DEFAULT 0 COMMENT 'Quality score for evaluator accuracy',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_evaluator (evaluator_user_id),
  FOREIGN KEY (evaluator_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_points (total_points_earned),
  INDEX idx_quality (average_evaluation_quality)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create rating_votes table to track individual votes (3 votes per rating max)
CREATE TABLE IF NOT EXISTS rating_votes (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Individual votes on ratings - 2 out of 3 needed for approval';

-- Add comment to document the workflow
ALTER TABLE user_claim_ratings COMMENT = 'User claim quality ratings with approval workflow and points system';

-- Add voting fields to user_veracity_ratings (for veracity relation evaluations)
ALTER TABLE user_veracity_ratings
ADD COLUMN approval_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending' AFTER confidence_level,
ADD COLUMN votes_for INT DEFAULT 0 AFTER approval_status,
ADD COLUMN votes_against INT DEFAULT 0 AFTER votes_for,
ADD COLUMN total_votes INT DEFAULT 0 AFTER votes_against,
ADD COLUMN finalized_at TIMESTAMP NULL AFTER total_votes,
ADD COLUMN user_points DECIMAL(5,1) DEFAULT 0 COMMENT 'Points earned by rated user if approved',
ADD INDEX idx_approval_status (approval_status),
ADD INDEX idx_votes (total_votes);

ALTER TABLE user_veracity_ratings COMMENT = 'User veracity ratings with approval workflow and points system';
