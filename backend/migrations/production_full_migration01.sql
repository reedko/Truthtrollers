-- ============================================================================
-- TRUTHTROLLERS PRODUCTION MIGRATION SCRIPT
-- Comprehensive idempotent migration combining all schema changes
-- Safe to run multiple times - checks before making changes
-- ============================================================================

-- Set session variables for safety
SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='TRADITIONAL,ALLOW_INVALID_DATES';

-- ============================================================================
-- SECTION 1: CREATE NEW TABLES
-- ============================================================================

-- 1.1: Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_token (token),
  INDEX idx_expires (expires_at),
  INDEX idx_user_id (user_id)
);

-- 1.2: User claim ratings table
CREATE TABLE IF NOT EXISTS user_claim_ratings (
  user_claim_rating_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  reference_claim_id INT NOT NULL,
  task_claim_id INT NOT NULL,
  user_quality_rating INT NOT NULL,
  ai_quality_rating INT,
  ai_stance ENUM('support', 'refute', 'nuance', 'insufficient'),
  honesty_score INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (reference_claim_id) REFERENCES claims(claim_id),
  FOREIGN KEY (task_claim_id) REFERENCES claims(claim_id),
  INDEX idx_user (user_id),
  INDEX idx_task_claim (task_claim_id),
  UNIQUE KEY unique_user_claim_pair (user_id, reference_claim_id, task_claim_id)
);

-- 1.3: Molecule views tables
CREATE TABLE IF NOT EXISTS molecule_views (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  content_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  display_mode VARCHAR(50) DEFAULT 'mr_cards',
  positions JSON DEFAULT NULL,
  node_settings JSON DEFAULT NULL,
  last_viewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_view_name (user_id, content_id, name),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
  INDEX idx_user_content (user_id, content_id),
  INDEX idx_last_viewed (last_viewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS molecule_view_pins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  view_id INT NOT NULL,
  reference_content_id INT NOT NULL,
  is_pinned BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_pin (view_id, reference_content_id),
  FOREIGN KEY (view_id) REFERENCES molecule_views(id) ON DELETE CASCADE,
  FOREIGN KEY (reference_content_id) REFERENCES content(content_id) ON DELETE CASCADE,
  INDEX idx_view_id (view_id),
  INDEX idx_reference_content (reference_content_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- SECTION 2: ADD COLUMNS TO EXISTING TABLES (IF NOT EXISTS)
-- ============================================================================

-- 2.1: Add columns to claim_links table
SET @dbname = DATABASE();
SET @tablename = "claim_links";

-- Add veracity_score
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'veracity_score'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_links ADD COLUMN veracity_score DECIMAL(5,2) DEFAULT NULL COMMENT ''AI-generated veracity score 0-1'' AFTER support_level',
  'SELECT ''Column veracity_score already exists'' AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add confidence
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'confidence'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_links ADD COLUMN confidence DECIMAL(5,2) DEFAULT NULL COMMENT ''AI confidence in this match 0.15-0.98'' AFTER veracity_score',
  'SELECT ''Column confidence already exists'' AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add created_by_ai
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'created_by_ai'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_links ADD COLUMN created_by_ai TINYINT(1) DEFAULT 0 COMMENT ''1 if auto-generated, 0 if user-created'' AFTER user_id',
  'SELECT ''Column created_by_ai already exists'' AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add points_earned
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'points_earned'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_links ADD COLUMN points_earned DECIMAL(5,1) DEFAULT 0 COMMENT ''Points earned for this link in GameSpace''',
  'SELECT ''Column points_earned already exists'' AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2.2: Add is_active to content table
SET @tablename = "content";
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'is_active'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE content ADD COLUMN is_active TINYINT DEFAULT 1 AFTER is_retracted',
  'SELECT ''Column is_active already exists'' AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- SECTION 3: MODIFY EXISTING COLUMNS
-- ============================================================================

-- 3.1: Make user_id nullable in claim_links
ALTER TABLE claim_links
MODIFY COLUMN user_id INT NULL
COMMENT 'User who created the link. NULL for AI-generated links (created_by_ai=1)';

-- 3.2: Update login_events.event_type to support password reset events
-- Change from ENUM to VARCHAR(50) to support all event types
ALTER TABLE login_events
MODIFY COLUMN event_type VARCHAR(50) NOT NULL;

-- ============================================================================
-- SECTION 4: ADD INDEXES
-- ============================================================================

-- Add indexes for claim_links queries (check if exists first)
SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'claim_links' AND INDEX_NAME = 'idx_claim_links_target'
);
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_claim_links_target ON claim_links(target_claim_id, disabled)',
  'SELECT ''Index idx_claim_links_target already exists'' AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'claim_links' AND INDEX_NAME = 'idx_claim_links_source'
);
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_claim_links_source ON claim_links(source_claim_id)',
  'SELECT ''Index idx_claim_links_source already exists'' AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'claim_links' AND INDEX_NAME = 'idx_claim_links_auto'
);
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_claim_links_auto ON claim_links(created_by_ai, disabled)',
  'SELECT ''Index idx_claim_links_auto already exists'' AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for content.is_active
SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'content' AND INDEX_NAME = 'idx_content_is_active'
);
SET @sql = IF(@index_exists = 0,
  'CREATE INDEX idx_content_is_active ON content(is_active)',
  'SELECT ''Index idx_content_is_active already exists'' AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- SECTION 5: DATA UPDATES
-- ============================================================================

-- Update existing user-created links to have created_by_ai = 0
UPDATE claim_links
SET created_by_ai = 0
WHERE created_by_ai IS NULL;

-- ============================================================================
-- SECTION 6: CREATE TRIGGERS
-- ============================================================================

-- Triggers to auto-update verimeter scores when claim_links change

-- Trigger: After INSERT
DROP TRIGGER IF EXISTS claim_links_after_insert;

DELIMITER $$
CREATE TRIGGER claim_links_after_insert
AFTER INSERT ON claim_links
FOR EACH ROW
BEGIN
  DELETE cs FROM content_scores cs
  JOIN content_claims cc ON cs.content_id = cc.content_id
  WHERE cc.claim_id = NEW.target_claim_id;

  DELETE FROM claim_scores
  WHERE claim_id = NEW.target_claim_id;
END$$
DELIMITER ;

-- Trigger: After UPDATE
DROP TRIGGER IF EXISTS claim_links_after_update;

DELIMITER $$
CREATE TRIGGER claim_links_after_update
AFTER UPDATE ON claim_links
FOR EACH ROW
BEGIN
  DELETE cs FROM content_scores cs
  JOIN content_claims cc ON cs.content_id = cc.content_id
  WHERE cc.claim_id = NEW.target_claim_id;

  DELETE FROM claim_scores
  WHERE claim_id = NEW.target_claim_id;
END$$
DELIMITER ;

-- Trigger: After DELETE
DROP TRIGGER IF EXISTS claim_links_after_delete;

DELIMITER $$
CREATE TRIGGER claim_links_after_delete
AFTER DELETE ON claim_links
FOR EACH ROW
BEGIN
  DELETE cs FROM content_scores cs
  JOIN content_claims cc ON cs.content_id = cc.content_id
  WHERE cc.claim_id = OLD.target_claim_id;

  DELETE FROM claim_scores
  WHERE claim_id = OLD.target_claim_id;
END$$
DELIMITER ;

-- ============================================================================
-- SECTION 7: VERIFICATION QUERIES
-- ============================================================================

-- Show table statuses
SELECT
  'Tables Created' AS Status,
  COUNT(*) AS Count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('password_reset_tokens', 'user_claim_ratings', 'molecule_views', 'molecule_view_pins');

-- Show claim_links columns
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'claim_links'
  AND COLUMN_NAME IN ('veracity_score', 'confidence', 'created_by_ai', 'points_earned', 'user_id');

-- Show login_events event_type column type
SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'login_events'
  AND COLUMN_NAME = 'event_type';

-- Show triggers
SHOW TRIGGERS WHERE `Table` = 'claim_links';

-- ============================================================================
-- RESTORE ORIGINAL SETTINGS
-- ============================================================================

SET SQL_MODE=@OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'Migration completed successfully!' AS Status;
