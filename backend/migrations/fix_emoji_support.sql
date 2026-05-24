-- Fix emoji support in ttlive_threads
-- The error shows emojis (🇰🇪) can't be stored
-- Need to ensure columns are properly utf8mb4

-- Check current charset
SELECT
    TABLE_NAME,
    COLUMN_NAME,
    CHARACTER_SET_NAME,
    COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'truthtrollers'
  AND TABLE_NAME = 'ttlive_threads'
  AND COLUMN_NAME = 'thread_title';

-- Fix the column to properly support 4-byte UTF8 (emojis)
ALTER TABLE ttlive_threads
  MODIFY COLUMN thread_title VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Also fix all text columns in ttlive_threads to be safe
ALTER TABLE ttlive_threads
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Verify the fix
SELECT
    TABLE_NAME,
    COLUMN_NAME,
    CHARACTER_SET_NAME,
    COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'truthtrollers'
  AND TABLE_NAME = 'ttlive_threads'
  AND COLUMN_NAME = 'thread_title';

SELECT '✅ Emoji support enabled for ttlive_threads' AS status;
