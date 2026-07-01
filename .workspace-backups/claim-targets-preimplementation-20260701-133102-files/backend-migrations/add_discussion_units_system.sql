-- ================================================
-- Discussion Units System Migration
-- ================================================
-- Purpose: Enable users to generate structured discussion units
--          from analyzed content and post them to social media (X/Twitter)
--
-- Features:
--   - Break content into claims, evidence, and summaries
--   - Track posting history and rate limits
--   - Support threaded replies to social media posts
--   - Integration with verimeter scoring system
-- ================================================

-- Drop existing tables if rerunning migration (dev only)
-- DROP TABLE IF EXISTS discussion_unit_posts;
-- DROP TABLE IF EXISTS discussion_units;
-- DROP TABLE IF EXISTS discussion_bundles;
-- DROP TABLE IF EXISTS x_auth_tokens;
-- DROP TABLE IF EXISTS social_post_rate_limits;

-- ================================================
-- Table: discussion_bundles
-- ================================================
-- Represents a collection of discussion units generated from content
-- One bundle per content_id per user (users can regenerate)

CREATE TABLE IF NOT EXISTS discussion_bundles (
  bundle_id INT AUTO_INCREMENT PRIMARY KEY,
  content_id INT NOT NULL,
  created_by INT NOT NULL,

  -- Metadata
  original_post_url VARCHAR(1000) NULL,  -- X/Twitter URL being discussed
  tweet_id VARCHAR(100) NULL,            -- Extracted tweet ID

  -- Status tracking
  generation_status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'completed',
  generation_error TEXT NULL,

  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Constraints
  FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE,

  INDEX idx_content_user (content_id, created_by),
  INDEX idx_created_by (created_by),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- Table: discussion_units
-- ================================================
-- Individual units of discussion (claim, support, counter, summary)

CREATE TABLE IF NOT EXISTS discussion_units (
  unit_id INT AUTO_INCREMENT PRIMARY KEY,
  bundle_id INT NOT NULL,

  -- Unit content
  unit_type ENUM('claim', 'support', 'counter', 'summary') NOT NULL,
  unit_text TEXT NOT NULL,
  original_text TEXT NULL,  -- Original text before user editing

  -- Position and grouping
  unit_order INT NOT NULL DEFAULT 0,  -- Display order within bundle
  parent_unit_id INT NULL,            -- For nested/threaded structure

  -- Source data
  claim_id INT NULL,                  -- Linked to claims table
  reference_content_id INT NULL,      -- Linked to content (for evidence)

  -- Metadata
  confidence DECIMAL(5,3) NULL,       -- AI confidence (0.00-1.00)
  support_level DECIMAL(5,3) NULL,    -- From reference_claim_links (-1.2 to +1.2)
  stance VARCHAR(50) NULL,            -- support, refute, nuance

  -- Sources array (stored as JSON)
  -- Format: [{ "title": "...", "url": "...", "quality": 0.85 }]
  sources JSON NULL,

  -- User edits
  is_edited BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMP NULL,

  -- Posting status
  is_selected_for_posting BOOLEAN DEFAULT TRUE,  -- User can toggle off

  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Constraints
  FOREIGN KEY (bundle_id) REFERENCES discussion_bundles(bundle_id) ON DELETE CASCADE,
  FOREIGN KEY (claim_id) REFERENCES claims(claim_id) ON DELETE SET NULL,
  FOREIGN KEY (reference_content_id) REFERENCES content(content_id) ON DELETE SET NULL,
  FOREIGN KEY (parent_unit_id) REFERENCES discussion_units(unit_id) ON DELETE SET NULL,

  INDEX idx_bundle_id (bundle_id),
  INDEX idx_unit_type (unit_type),
  INDEX idx_claim_id (claim_id),
  INDEX idx_order (bundle_id, unit_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- Table: discussion_unit_posts
-- ================================================
-- Tracks actual social media posts made from discussion units

CREATE TABLE IF NOT EXISTS discussion_unit_posts (
  post_id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT NOT NULL,
  bundle_id INT NOT NULL,
  user_id INT NOT NULL,

  -- Platform data
  platform ENUM('twitter_x', 'facebook', 'linkedin', 'mastodon') DEFAULT 'twitter_x',
  external_post_id VARCHAR(255) NULL,   -- Tweet ID from X API
  external_url VARCHAR(1000) NULL,      -- Full URL to post

  -- Thread structure
  parent_post_id INT NULL,              -- Links to previous post in thread
  thread_position INT DEFAULT 1,         -- Position in thread (1 = first reply)

  -- Post content (may differ from unit_text if edited)
  posted_text TEXT NOT NULL,
  character_count INT NOT NULL,

  -- Status
  post_status ENUM('pending', 'posted', 'failed', 'deleted') DEFAULT 'pending',
  post_error TEXT NULL,

  -- Rate limiting
  posted_at TIMESTAMP NULL,
  retry_count INT DEFAULT 0,

  -- Engagement metrics (can be updated via API polling)
  likes_count INT DEFAULT 0,
  retweets_count INT DEFAULT 0,
  replies_count INT DEFAULT 0,
  last_metrics_update TIMESTAMP NULL,

  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Constraints
  FOREIGN KEY (unit_id) REFERENCES discussion_units(unit_id) ON DELETE CASCADE,
  FOREIGN KEY (bundle_id) REFERENCES discussion_bundles(bundle_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_post_id) REFERENCES discussion_unit_posts(post_id) ON DELETE SET NULL,

  INDEX idx_unit_id (unit_id),
  INDEX idx_bundle_id (bundle_id),
  INDEX idx_user_id (user_id),
  INDEX idx_external_post_id (external_post_id),
  INDEX idx_posted_at (posted_at),
  INDEX idx_platform_status (platform, post_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- Table: x_auth_tokens
-- ================================================
-- Stores OAuth tokens for X/Twitter API access per user

CREATE TABLE IF NOT EXISTS x_auth_tokens (
  token_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,

  -- OAuth 2.0 tokens
  access_token TEXT NOT NULL,
  refresh_token TEXT NULL,
  token_type VARCHAR(50) DEFAULT 'Bearer',

  -- Expiration
  expires_at TIMESTAMP NULL,

  -- Scope
  scope TEXT NULL,  -- e.g., 'tweet.read tweet.write users.read'

  -- X/Twitter user info
  x_user_id VARCHAR(100) NULL,      -- Twitter user ID
  x_username VARCHAR(100) NULL,      -- Twitter handle
  x_display_name VARCHAR(255) NULL,

  -- Status
  is_valid BOOLEAN DEFAULT TRUE,
  revoked_at TIMESTAMP NULL,

  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Constraints
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_token (user_id),
  INDEX idx_user_id (user_id),
  INDEX idx_x_user_id (x_user_id),
  INDEX idx_is_valid (is_valid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- Table: social_post_rate_limits
-- ================================================
-- Rate limiting per user per platform

CREATE TABLE IF NOT EXISTS social_post_rate_limits (
  limit_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  platform ENUM('twitter_x', 'facebook', 'linkedin', 'mastodon') DEFAULT 'twitter_x',

  -- Rate limit tracking
  posts_in_last_hour INT DEFAULT 0,
  posts_in_last_day INT DEFAULT 0,
  last_post_at TIMESTAMP NULL,

  -- Bundle-level rate limiting
  last_bundle_posted_at TIMESTAMP NULL,
  bundles_posted_today INT DEFAULT 0,

  -- Violation tracking
  violations_count INT DEFAULT 0,
  last_violation_at TIMESTAMP NULL,
  is_temporarily_blocked BOOLEAN DEFAULT FALSE,
  blocked_until TIMESTAMP NULL,

  -- Reset tracking
  hour_reset_at TIMESTAMP NULL,
  day_reset_at TIMESTAMP NULL,

  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Constraints
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_platform (user_id, platform),
  INDEX idx_user_platform (user_id, platform),
  INDEX idx_last_post_at (last_post_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- Integration with Reputation System
-- ================================================
-- Add fields to user_reputation table for discussion unit activity

-- Check if columns exist before adding them
SET @dbname = DATABASE();
SET @tablename = 'user_reputation';

-- Add verimeter_score column if it doesn't exist
SET @column_check = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = 'verimeter_score'
);

SET @sql = IF(
  @column_check = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN verimeter_score DECIMAL(5,2) DEFAULT 50.0 COMMENT ''User overall verimeter score (0-100, default 50)'''),
  'SELECT "Column verimeter_score already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add discussion_units_posted column if it doesn't exist
SET @column_check = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = 'discussion_units_posted'
);

SET @sql = IF(
  @column_check = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN discussion_units_posted INT DEFAULT 0 COMMENT ''Total discussion units posted to social media'''),
  'SELECT "Column discussion_units_posted already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add discussion_bundles_created column if it doesn't exist
SET @column_check = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = 'discussion_bundles_created'
);

SET @sql = IF(
  @column_check = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN discussion_bundles_created INT DEFAULT 0 COMMENT ''Total discussion bundles created'''),
  'SELECT "Column discussion_bundles_created already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add avg_engagement_score column if it doesn't exist
SET @column_check = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = 'avg_engagement_score'
);

SET @sql = IF(
  @column_check = 0,
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN avg_engagement_score DECIMAL(5,2) DEFAULT 0 COMMENT ''Average engagement (likes + retweets) per post'''),
  'SELECT "Column avg_engagement_score already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================
-- Stored Procedure: check_rate_limit
-- ================================================
-- Validates if user can post to platform based on rate limits

DELIMITER $$

DROP PROCEDURE IF EXISTS check_rate_limit$$

CREATE PROCEDURE check_rate_limit(
  IN p_user_id INT,
  IN p_platform VARCHAR(50),
  OUT p_can_post BOOLEAN,
  OUT p_reason VARCHAR(255)
)
BEGIN
  DECLARE v_posts_in_hour INT DEFAULT 0;
  DECLARE v_last_bundle_posted TIMESTAMP;
  DECLARE v_is_blocked BOOLEAN DEFAULT FALSE;
  DECLARE v_blocked_until TIMESTAMP;

  -- Get or create rate limit record
  INSERT INTO social_post_rate_limits (user_id, platform, posts_in_last_hour, posts_in_last_day)
  VALUES (p_user_id, p_platform, 0, 0)
  ON DUPLICATE KEY UPDATE user_id = user_id;

  -- Fetch current limits
  SELECT
    posts_in_last_hour,
    last_bundle_posted_at,
    is_temporarily_blocked,
    blocked_until
  INTO
    v_posts_in_hour,
    v_last_bundle_posted,
    v_is_blocked,
    v_blocked_until
  FROM social_post_rate_limits
  WHERE user_id = p_user_id AND platform = p_platform;

  -- Check if temporarily blocked
  IF v_is_blocked AND v_blocked_until > NOW() THEN
    SET p_can_post = FALSE;
    SET p_reason = CONCAT('Temporarily blocked until ', v_blocked_until);

  -- Check hourly limit (max 10 posts per hour)
  ELSEIF v_posts_in_hour >= 10 THEN
    SET p_can_post = FALSE;
    SET p_reason = 'Hourly rate limit exceeded (10 posts/hour)';

  -- Check bundle cooldown (min 1 minute between bundles)
  ELSEIF v_last_bundle_posted IS NOT NULL
    AND TIMESTAMPDIFF(SECOND, v_last_bundle_posted, NOW()) < 60 THEN
    SET p_can_post = FALSE;
    SET p_reason = 'Must wait 1 minute between bundle posts';

  ELSE
    SET p_can_post = TRUE;
    SET p_reason = 'OK';
  END IF;

END$$

DELIMITER ;

-- ================================================
-- Stored Procedure: record_social_post
-- ================================================
-- Updates rate limit counters after successful post

DELIMITER $$

DROP PROCEDURE IF EXISTS record_social_post$$

CREATE PROCEDURE record_social_post(
  IN p_user_id INT,
  IN p_platform VARCHAR(50),
  IN p_is_bundle_start BOOLEAN
)
BEGIN
  -- Increment counters
  UPDATE social_post_rate_limits
  SET
    posts_in_last_hour = posts_in_last_hour + 1,
    posts_in_last_day = posts_in_last_day + 1,
    last_post_at = NOW(),
    last_bundle_posted_at = IF(p_is_bundle_start = TRUE, NOW(), last_bundle_posted_at),
    bundles_posted_today = IF(p_is_bundle_start = TRUE, bundles_posted_today + 1, bundles_posted_today),
    updated_at = NOW()
  WHERE user_id = p_user_id AND platform = p_platform;

  -- Update user reputation
  UPDATE user_reputation
  SET
    discussion_units_posted = discussion_units_posted + 1,
    discussion_bundles_created = IF(p_is_bundle_start = TRUE, discussion_bundles_created + 1, discussion_bundles_created),
    last_activity_at = NOW()
  WHERE user_id = p_user_id;

END$$

DELIMITER ;

-- ================================================
-- View: user_posting_stats
-- ================================================
-- Aggregated posting statistics per user

CREATE OR REPLACE VIEW user_posting_stats AS
SELECT
  u.user_id,
  u.username,
  COALESCE(ur.verimeter_score, 50.0) AS verimeter_score,
  COALESCE(ur.discussion_bundles_created, 0) AS bundles_created,
  COALESCE(ur.discussion_units_posted, 0) AS units_posted,
  COALESCE(ur.avg_engagement_score, 0) AS avg_engagement,
  COUNT(DISTINCT db.bundle_id) AS total_bundles,
  COUNT(DISTINCT dup.post_id) AS total_posts,
  COUNT(DISTINCT CASE WHEN dup.post_status = 'posted' THEN dup.post_id END) AS successful_posts,
  COUNT(DISTINCT CASE WHEN dup.post_status = 'failed' THEN dup.post_id END) AS failed_posts,
  COALESCE(SUM(dup.likes_count), 0) AS total_likes,
  COALESCE(SUM(dup.retweets_count), 0) AS total_retweets,
  COALESCE(SUM(dup.replies_count), 0) AS total_replies,
  MAX(dup.posted_at) AS last_posted_at
FROM users u
LEFT JOIN user_reputation ur ON u.user_id = ur.user_id
LEFT JOIN discussion_bundles db ON u.user_id = db.created_by
LEFT JOIN discussion_unit_posts dup ON db.bundle_id = dup.bundle_id
GROUP BY u.user_id, u.username;

-- ================================================
-- Indexes for Performance
-- ================================================

-- Composite indexes for common queries (IF NOT EXISTS not supported in MariaDB, use conditional)
SET @exist_idx1 := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'discussion_bundles' AND index_name = 'idx_bundle_content_user');
SET @sql_idx1 := IF(@exist_idx1 = 0,
  'CREATE INDEX idx_bundle_content_user ON discussion_bundles(content_id, created_by, created_at)',
  'SELECT "Index idx_bundle_content_user already exists"');
PREPARE stmt FROM @sql_idx1;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exist_idx2 := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'discussion_units' AND index_name = 'idx_unit_bundle_type');
SET @sql_idx2 := IF(@exist_idx2 = 0,
  'CREATE INDEX idx_unit_bundle_type ON discussion_units(bundle_id, unit_type, unit_order)',
  'SELECT "Index idx_unit_bundle_type already exists"');
PREPARE stmt FROM @sql_idx2;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exist_idx3 := (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'discussion_unit_posts' AND index_name = 'idx_post_user_status');
SET @sql_idx3 := IF(@exist_idx3 = 0,
  'CREATE INDEX idx_post_user_status ON discussion_unit_posts(user_id, post_status, posted_at)',
  'SELECT "Index idx_post_user_status already exists"');
PREPARE stmt FROM @sql_idx3;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================
-- Initial Data / Defaults
-- ================================================

-- Add can_post column to users table if it doesn't exist
SET @column_check = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'can_post'
);

SET @sql = IF(
  @column_check = 0,
  'ALTER TABLE users ADD COLUMN can_post BOOLEAN DEFAULT TRUE COMMENT ''User can post to social media''',
  'SELECT "Column can_post already exists in users table"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Grant posting privilege to existing users (can be revoked later)
UPDATE users SET can_post = TRUE WHERE can_post IS NULL;

-- ================================================
-- Migration Complete
-- ================================================

SELECT 'Discussion Units System migration completed successfully' AS status;
