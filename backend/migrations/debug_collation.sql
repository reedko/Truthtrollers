-- Find EXACTLY what's causing the collation mismatch

-- 1. Show ALL foreign keys on ttlive_imported_posts
SELECT
    CONSTRAINT_NAME,
    COLUMN_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'truthtrollers'
  AND TABLE_NAME = 'ttlive_imported_posts'
  AND REFERENCED_TABLE_NAME IS NOT NULL;

-- 2. Check the ACTUAL collations right now
SELECT
    TABLE_NAME,
    COLUMN_NAME,
    COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'truthtrollers'
  AND TABLE_NAME IN ('ttlive_imported_posts', 'ttlive_threads')
  AND COLUMN_NAME IN ('thread_id', 'imported_post_id', 'reply_to_imported_post_id')
ORDER BY TABLE_NAME, COLUMN_NAME;

-- 3. Check for triggers
SELECT
    TRIGGER_NAME,
    EVENT_MANIPULATION,
    ACTION_STATEMENT
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = 'truthtrollers'
  AND EVENT_OBJECT_TABLE = 'ttlive_imported_posts';
