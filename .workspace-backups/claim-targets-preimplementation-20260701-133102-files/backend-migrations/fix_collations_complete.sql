-- Complete collation fix - converts database AND all columns explicitly
-- This ensures CHAR/VARCHAR columns are all utf8mb4_unicode_ci

-- Step 1: Set database default
ALTER DATABASE truthtrollers CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 2: Fix ttlive_threads explicitly (this is the parent table causing FK issues)
ALTER TABLE ttlive_threads
  MODIFY thread_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY thread_title VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY source_platform VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY source_thread_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY source_url TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 3: Fix ttlive_imported_posts
ALTER TABLE ttlive_imported_posts
  MODIFY imported_post_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY thread_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY source_post_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY source_url TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY source_author_username VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY source_author_display_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY source_author_avatar_url TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY post_text TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY post_language VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY reply_to_imported_post_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 4: Convert all other ttlive tables
ALTER TABLE ttlive_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_post_evidence CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_thread_subscriptions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_export_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Conversation system
ALTER TABLE ttlive_conversations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_conversation_participants CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_conversation_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_conversation_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Staged arguments
ALTER TABLE ttlive_staged_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_argument_fallacies CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_argument_signoffs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Core tables
ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE content CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT '✅ Complete collation fix applied - all columns now utf8mb4_unicode_ci' AS status;
