-- Step 1: Show current foreign keys on ttlive_imported_posts
SELECT
    CONSTRAINT_NAME,
    COLUMN_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'truthtrollers'
  AND TABLE_NAME = 'ttlive_imported_posts'
  AND REFERENCED_TABLE_NAME IS NOT NULL;

-- Step 2: After seeing the FK names above, drop them manually (replace FK_NAME with actual names)
-- Example:
-- ALTER TABLE ttlive_imported_posts DROP FOREIGN KEY actual_fk_name_here;

-- Step 3: Fix parent table (ttlive_threads) first
ALTER TABLE ttlive_threads
  MODIFY COLUMN thread_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN thread_title VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN source_platform VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN source_thread_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN source_url TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 4: Fix child table (ttlive_imported_posts)
ALTER TABLE ttlive_imported_posts
  MODIFY COLUMN imported_post_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN thread_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN source_platform VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'x',
  MODIFY COLUMN source_post_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN source_url TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN source_author_username VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN source_author_display_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN source_author_avatar_url TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN post_text TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN post_language VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'en',
  MODIFY COLUMN reply_to_imported_post_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 5: Recreate foreign key
ALTER TABLE ttlive_imported_posts
  ADD CONSTRAINT ttlive_imported_posts_thread_fk
  FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;

SELECT 'Collation fix complete!' AS status;
