-- ============================================================================
-- COMPREHENSIVE USERIFICATION SCHEMA UPDATES (SIMPLE VERSION)
-- Run each section separately in MySQL Workbench
-- Ignore "Duplicate column" errors if column already exists
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. EXPAND IP ADDRESS FIELDS (VARCHAR 45 -> 145)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE login_attempts
MODIFY COLUMN ip_address VARCHAR(145) NOT NULL
COMMENT 'IPv4 or IPv6 address (expanded for proxy edge cases)';

ALTER TABLE registration_attempts
MODIFY COLUMN ip_address VARCHAR(145) NOT NULL
COMMENT 'IPv4 or IPv6 address (expanded for proxy edge cases)';

ALTER TABLE user_sessions
MODIFY COLUMN ip_address VARCHAR(145) DEFAULT NULL
COMMENT 'IPv4 or IPv6 address (expanded for proxy edge cases)';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. ADD GLOBALLY_REMOVED TO CONTENT_RELATIONS
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE content_relations
ADD COLUMN globally_removed BOOLEAN DEFAULT FALSE
COMMENT 'TRUE = admin hard-deleted this reference (hidden from all scopes except admin)';
-- NOTE: Ignore error 1060 (Duplicate column) if this already exists

-- ────────────────────────────────────────────────────────────────────────────
-- 3. ADD PROVENANCE FIELDS TO CONTENT_RELATIONS
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE content_relations
ADD COLUMN added_by_user_id INT NULL
COMMENT 'User who added this reference (NULL = system/initial scrape)';
-- NOTE: Ignore error 1060 (Duplicate column) if this already exists

ALTER TABLE content_relations
ADD COLUMN is_system BOOLEAN DEFAULT NULL
COMMENT 'TRUE = system reference from initial scrape (NULL treated as TRUE for legacy data)';
-- NOTE: Ignore error 1060 (Duplicate column) if this already exists

-- ────────────────────────────────────────────────────────────────────────────
-- 4. ADD USER_ID TO PUBLISHER_RATINGS
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE publisher_ratings
ADD COLUMN user_id INT NULL
COMMENT 'User who created this rating (NULL = system/global rating)';
-- NOTE: Ignore error 1060 (Duplicate column) if this already exists

-- ────────────────────────────────────────────────────────────────────────────
-- 5. ADD USER_ID TO AUTHOR_RATINGS
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE author_ratings
ADD COLUMN user_id INT NULL
COMMENT 'User who created this rating (NULL = system/global rating)';
-- NOTE: Ignore error 1060 (Duplicate column) if this already exists

-- ────────────────────────────────────────────────────────────────────────────
-- 6. VERIFICATION QUERIES
-- ────────────────────────────────────────────────────────────────────────────

-- Check ip_address column lengths
SELECT
  'IP Address Fields' AS Check_Type,
  TABLE_NAME,
  COLUMN_NAME,
  CHARACTER_MAXIMUM_LENGTH as Max_Length
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('login_attempts', 'registration_attempts', 'user_sessions')
  AND COLUMN_NAME = 'ip_address'
ORDER BY TABLE_NAME;

-- Check content_relations columns
SELECT
  'Content Relations Columns' AS Check_Type,
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'content_relations'
  AND COLUMN_NAME IN ('globally_removed', 'added_by_user_id', 'is_system')
ORDER BY COLUMN_NAME;

-- Check publisher_ratings user_id
SELECT
  'Publisher Ratings' AS Check_Type,
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE,
  COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'publisher_ratings'
  AND COLUMN_NAME = 'user_id';

-- Check author_ratings user_id
SELECT
  'Author Ratings' AS Check_Type,
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE,
  COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'author_ratings'
  AND COLUMN_NAME = 'user_id';
