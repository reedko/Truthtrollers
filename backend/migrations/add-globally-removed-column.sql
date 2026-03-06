-- ============================================================================
-- ADD globally_removed COLUMN TO content_relations
-- For admin-only hard deletion of references (Phase 2: Scope Filtering)
-- ============================================================================

-- Add globally_removed column if it doesn't exist
SET @dbname = DATABASE();
SET @tablename = 'content_relations';
SET @columnname = 'globally_removed';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  "SELECT 'Column already exists' AS msg",
  CONCAT("ALTER TABLE ", @tablename, " ADD COLUMN ", @columnname, " BOOLEAN DEFAULT FALSE COMMENT 'TRUE = admin hard-deleted this reference (hidden from all scopes except admin)'")
));
PREPARE alterStatement FROM @preparedStatement;
EXECUTE alterStatement;
DEALLOCATE PREPARE alterStatement;

-- Add index if it doesn't exist
SET @indexname = 'idx_globally_removed';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (INDEX_NAME = @indexname)
  ) > 0,
  "SELECT 'Index already exists' AS msg",
  CONCAT("ALTER TABLE ", @tablename, " ADD INDEX ", @indexname, " (", @columnname, ")")
));
PREPARE alterStatement FROM @preparedStatement;
EXECUTE alterStatement;
DEALLOCATE PREPARE alterStatement;

-- Verify the changes
SELECT
  'content_relations schema updated successfully' AS Status,
  COLUMN_NAME,
  COLUMN_TYPE,
  COLUMN_DEFAULT,
  COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @dbname
  AND TABLE_NAME = @tablename
  AND COLUMN_NAME = @columnname;

SELECT
  'Index created successfully' AS Status,
  INDEX_NAME,
  COLUMN_NAME,
  NON_UNIQUE
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @dbname
  AND TABLE_NAME = @tablename
  AND INDEX_NAME = @indexname;
