-- ============================================================================
-- PRODUCTION MIGRATION: Task Completion Tracking
-- Migrates from global content.progress to per-user content_users.completed_at
-- Safe to run multiple times (idempotent)
-- ============================================================================

-- Backup existing data first (optional but recommended)
-- CREATE TABLE IF NOT EXISTS content_users_backup_20260216 AS SELECT * FROM content_users;

-- ============================================================================
-- STEP 1: Add completed_at column to content_users if it doesn't exist
-- ============================================================================

-- Check if column exists and add if needed
SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_users'
    AND COLUMN_NAME = 'completed_at'
);

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE content_users ADD COLUMN completed_at TIMESTAMP NULL DEFAULT NULL',
  'SELECT "Column completed_at already exists" AS Info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- STEP 2: Add index on completed_at for better query performance
-- ============================================================================

SET @index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_users'
    AND INDEX_NAME = 'idx_completed'
);

SET @sql = IF(@index_exists = 0,
  'ALTER TABLE content_users ADD INDEX idx_completed (completed_at)',
  'SELECT "Index idx_completed already exists" AS Info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- STEP 3: Migrate existing completed tasks
-- Mark all users who have tasks with progress='Completed' as having completed them
-- ============================================================================

-- For all content_users records where the content has progress='Completed',
-- set completed_at to NOW() (only if not already set)
UPDATE content_users cu
JOIN content c ON cu.content_id = c.content_id
SET cu.completed_at = NOW()
WHERE c.progress = 'Completed'
  AND cu.completed_at IS NULL;

-- Get count of migrated records
SELECT COUNT(*) AS 'Records migrated (set to completed)'
FROM content_users cu
JOIN content c ON cu.content_id = c.content_id
WHERE c.progress = 'Completed'
  AND cu.completed_at IS NOT NULL;

-- ============================================================================
-- STEP 4: Verification queries
-- ============================================================================

-- Show summary of completion status
SELECT
  'Total content_users records' AS metric,
  COUNT(*) AS value
FROM content_users
UNION ALL
SELECT
  'Completed records (new system)',
  COUNT(*)
FROM content_users
WHERE completed_at IS NOT NULL
UNION ALL
SELECT
  'Tasks marked as Completed (old system)',
  COUNT(DISTINCT cu.content_id)
FROM content_users cu
JOIN content c ON cu.content_id = c.content_id
WHERE c.progress = 'Completed';

-- Show sample of migrated data
SELECT
  c.content_id,
  c.content_name,
  c.progress AS old_progress,
  cu.user_id,
  cu.completed_at AS new_completed_at
FROM content c
JOIN content_users cu ON c.content_id = cu.content_id
WHERE c.progress = 'Completed'
  AND cu.completed_at IS NOT NULL
LIMIT 10;

-- ============================================================================
-- NOTES FOR FUTURE REFERENCE:
-- ============================================================================
-- 1. The content.progress field is KEPT for backwards compatibility
--    and can still be used to track overall task status
-- 2. The new content_users.completed_at field tracks per-user completion
-- 3. Extension now checks content_users.completed_at for user-specific completion
-- 4. API endpoint /api/check-content now accepts userId and returns isCompleted
-- 5. New API endpoint /api/mark-task-complete allows users to mark tasks complete
-- ============================================================================

SELECT 'Migration completed successfully!' AS Status;
