-- ============================================================================
-- COMPREHENSIVE USERIFICATION SCHEMA UPDATES
-- Combines all database changes for user-scoped platform
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
-- 2. ADD GLOBALLY_REMOVED TO CONTENT_RELATIONS (Admin hard-delete)
-- ────────────────────────────────────────────────────────────────────────────

SET @dbname = DATABASE();
SET @tablename = 'content_relations';
SET @columnname = 'globally_removed';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' BOOLEAN DEFAULT FALSE
    COMMENT ''TRUE = admin hard-deleted this reference (hidden from all scopes except admin)''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. ADD USER_ID TO PUBLISHER_RATINGS (Per-user ratings)
-- ────────────────────────────────────────────────────────────────────────────

-- Check if column exists first
SET @dbname = DATABASE();
SET @tablename = 'publisher_ratings';
SET @columnname = 'user_id';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1', -- Column exists, do nothing
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT NULL
    COMMENT ''User who created this rating (NULL = system/global rating)''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. ADD USER_ID TO AUTHOR_RATINGS (Per-user ratings)
-- ────────────────────────────────────────────────────────────────────────────

SET @tablename = 'author_ratings';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1', -- Column exists, do nothing
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT NULL
    COMMENT ''User who created this rating (NULL = system/global rating)''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. ENSURE PROVENANCE FIELDS IN CONTENT_RELATIONS
-- ────────────────────────────────────────────────────────────────────────────

SET @columnname = 'added_by_user_id';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT NULL
    COMMENT ''User who added this reference (NULL = system/initial scrape)''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'is_system';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' BOOLEAN DEFAULT FALSE
    COMMENT ''TRUE = system reference from initial scrape (NULL treated as TRUE for legacy data)''')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. VERIFICATION QUERIES
-- ────────────────────────────────────────────────────────────────────────────

SELECT '============================================================================' AS '';
SELECT 'VERIFICATION RESULTS' AS '';
SELECT '============================================================================' AS '';

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

-- Check content_relations provenance columns
SELECT
  'Content Relations Provenance' AS Check_Type,
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
  'Publisher Ratings User ID' AS Check_Type,
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
  'Author Ratings User ID' AS Check_Type,
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE,
  COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'author_ratings'
  AND COLUMN_NAME = 'user_id';

SELECT '============================================================================' AS '';
SELECT 'Migration Complete!' AS '';
SELECT '============================================================================' AS '';
