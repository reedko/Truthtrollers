-- Nuclear option: Fix ALL ttlive table collations
-- This sets EVERY table to utf8mb4_unicode_ci

-- First, drop ALL foreign keys
ALTER TABLE ttlive_imported_posts DROP FOREIGN KEY ttlive_imported_posts_ibfk_1;
ALTER TABLE ttlive_imported_posts DROP FOREIGN KEY ttlive_imported_posts_ibfk_2;
ALTER TABLE ttlive_conversations DROP FOREIGN KEY ttlive_conversations_ibfk_1;
ALTER TABLE ttlive_posts DROP FOREIGN KEY ttlive_posts_ibfk_1;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_1;

-- Now convert ALL ttlive tables to utf8mb4_unicode_ci
ALTER TABLE ttlive_threads CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_imported_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_conversations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_conversation_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_conversation_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_conversation_participants CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_post_evidence CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_staged_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_argument_fallacies CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_argument_signoffs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_export_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE ttlive_thread_subscriptions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Recreate foreign keys
ALTER TABLE ttlive_imported_posts
  ADD CONSTRAINT ttlive_imported_posts_ibfk_1
  FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;

ALTER TABLE ttlive_imported_posts
  ADD CONSTRAINT ttlive_imported_posts_ibfk_2
  FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;

ALTER TABLE ttlive_conversations
  ADD CONSTRAINT ttlive_conversations_ibfk_1
  FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;

ALTER TABLE ttlive_posts
  ADD CONSTRAINT ttlive_posts_ibfk_1
  FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;

ALTER TABLE ttlive_staged_arguments
  ADD CONSTRAINT ttlive_staged_arguments_ibfk_1
  FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;

SELECT '✅ ALL ttlive tables converted to utf8mb4_unicode_ci' AS status;
