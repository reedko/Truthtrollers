-- Migration: Add missing columns to user_claim_ratings
-- Based on production schema
-- Safe to run multiple times

SET @dbname = DATABASE();
SET @tablename = 'user_claim_ratings';

-- Core fields that should exist
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'user_quality_rating');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN user_quality_rating INT NOT NULL',
  'SELECT "Column user_quality_rating already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'ai_quality_rating');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN ai_quality_rating INT DEFAULT NULL',
  'SELECT "Column ai_quality_rating already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'ai_stance');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN ai_stance ENUM(\'support\',\'refute\',\'nuance\',\'insufficient\') DEFAULT NULL',
  'SELECT "Column ai_stance already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'honesty_score');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN honesty_score INT DEFAULT NULL',
  'SELECT "Column honesty_score already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'approval_status');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN approval_status ENUM(\'pending\',\'approved\',\'rejected\') DEFAULT \'pending\'',
  'SELECT "Column approval_status already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'votes_for');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN votes_for INT DEFAULT 0',
  'SELECT "Column votes_for already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'votes_against');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN votes_against INT DEFAULT 0',
  'SELECT "Column votes_against already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'total_votes');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN total_votes INT DEFAULT 0',
  'SELECT "Column total_votes already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'finalized_at');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN finalized_at TIMESTAMP NULL DEFAULT NULL',
  'SELECT "Column finalized_at already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'reviewed_by_user_id');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN reviewed_by_user_id INT DEFAULT NULL',
  'SELECT "Column reviewed_by_user_id already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'reviewed_at');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN reviewed_at TIMESTAMP NULL DEFAULT NULL',
  'SELECT "Column reviewed_at already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'reviewer_notes');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN reviewer_notes TEXT',
  'SELECT "Column reviewer_notes already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'evaluator_points');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN evaluator_points DECIMAL(5,1) DEFAULT 0.0 COMMENT \'Points earned by reviewer for evaluating this rating\'',
  'SELECT "Column evaluator_points already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'user_points');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE user_claim_ratings ADD COLUMN user_points DECIMAL(5,1) DEFAULT 0.0 COMMENT \'Points earned by rated user if approved\'',
  'SELECT "Column user_points already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add foreign key for reviewed_by_user_id (check if constraint exists first)
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename
  AND CONSTRAINT_NAME = 'user_claim_ratings_ibfk_4' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE user_claim_ratings ADD CONSTRAINT user_claim_ratings_ibfk_4 FOREIGN KEY (reviewed_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL',
  'SELECT "Foreign key user_claim_ratings_ibfk_4 already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add indexes
SET @index_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = 'idx_approval_status');
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_approval_status ON user_claim_ratings(approval_status)',
  'SELECT "Index idx_approval_status already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = 'idx_reviewed_by');
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_reviewed_by ON user_claim_ratings(reviewed_by_user_id)',
  'SELECT "Index idx_reviewed_by already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = 'idx_total_votes');
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_total_votes ON user_claim_ratings(total_votes)',
  'SELECT "Index idx_total_votes already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'user_claim_ratings schema sync completed!' as status;
