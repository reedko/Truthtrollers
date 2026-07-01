-- Migration: Multi-evaluator voting system (2 out of 3 votes needed)
-- Adds voting fields if they don't exist

-- Add voting fields to user_claim_ratings
SET @dbname = DATABASE();
SET @tablename = 'user_claim_ratings';

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'votes_for');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN votes_for INT DEFAULT 0 AFTER approval_status',
  'SELECT "Column votes_for already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'votes_against');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN votes_against INT DEFAULT 0 AFTER votes_for',
  'SELECT "Column votes_against already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'total_votes');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN total_votes INT DEFAULT 0 AFTER votes_against',
  'SELECT "Column total_votes already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'finalized_at');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN finalized_at TIMESTAMP NULL AFTER total_votes',
  'SELECT "Column finalized_at already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index if not exists
SET @index_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = 'idx_total_votes');
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_total_votes ON user_claim_ratings(total_votes)',
  'SELECT "Index idx_total_votes already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add voting fields to user_veracity_ratings
SET @tablename = 'user_veracity_ratings';

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'votes_for');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_veracity_ratings ADD COLUMN votes_for INT DEFAULT 0 AFTER approval_status',
  'SELECT "Column votes_for already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'votes_against');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_veracity_ratings ADD COLUMN votes_against INT DEFAULT 0 AFTER votes_for',
  'SELECT "Column votes_against already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'total_votes');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_veracity_ratings ADD COLUMN total_votes INT DEFAULT 0 AFTER votes_against',
  'SELECT "Column total_votes already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'finalized_at');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_veracity_ratings ADD COLUMN finalized_at TIMESTAMP NULL AFTER total_votes',
  'SELECT "Column finalized_at already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index if not exists
SET @index_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = 'idx_total_votes_veracity');
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_total_votes_veracity ON user_veracity_ratings(total_votes)',
  'SELECT "Index idx_total_votes_veracity already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Create rating_votes table for individual evaluator votes
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

-- Create user_evaluation_stats table
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
