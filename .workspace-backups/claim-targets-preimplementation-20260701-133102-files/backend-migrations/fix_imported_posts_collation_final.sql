-- Final fix for ttlive_imported_posts collation issues
-- This explicitly sets EVERY string column to utf8mb4_unicode_ci

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
  MODIFY COLUMN post_media_urls JSON,
  MODIFY COLUMN post_language VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'en',
  MODIFY COLUMN reply_to_imported_post_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Also fix threads table to match
ALTER TABLE ttlive_threads
  MODIFY COLUMN thread_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN thread_title VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN source_platform VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN source_thread_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN source_url TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT 'Collation fix complete for ttlive_imported_posts' AS status;
