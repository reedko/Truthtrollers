-- =====================================================
-- Fix conversation and staged argument tables on PROD
-- They were created with utf8mb4_unicode_ci, need utf8mb4_general_ci
-- =====================================================

-- Drop all foreign keys first
ALTER TABLE ttlive_conversation_argument_citations DROP FOREIGN KEY ttlive_conversation_argument_citations_ibfk_1;
ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_1;
ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_2;
ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_3;
ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_4;
ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_5;
ALTER TABLE ttlive_conversation_participants DROP FOREIGN KEY ttlive_conversation_participants_ibfk_1;
ALTER TABLE ttlive_conversation_participants DROP FOREIGN KEY ttlive_conversation_participants_ibfk_2;
ALTER TABLE ttlive_conversations DROP FOREIGN KEY ttlive_conversations_ibfk_1;

ALTER TABLE ttlive_argument_citations DROP FOREIGN KEY ttlive_argument_citations_ibfk_1;
ALTER TABLE ttlive_argument_citations DROP FOREIGN KEY ttlive_argument_citations_ibfk_2;
ALTER TABLE ttlive_argument_fallacies DROP FOREIGN KEY ttlive_argument_fallacies_ibfk_1;
ALTER TABLE ttlive_argument_fallacies DROP FOREIGN KEY ttlive_argument_fallacies_ibfk_2;
ALTER TABLE ttlive_argument_fallacies DROP FOREIGN KEY ttlive_argument_fallacies_ibfk_3;
ALTER TABLE ttlive_argument_signoffs DROP FOREIGN KEY ttlive_argument_signoffs_ibfk_1;
ALTER TABLE ttlive_argument_signoffs DROP FOREIGN KEY ttlive_argument_signoffs_ibfk_2;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_1;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_2;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_3;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_4;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_5;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_6;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_7;

-- Convert all conversation tables
ALTER TABLE ttlive_conversations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_participants CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- Convert all staged argument tables
ALTER TABLE ttlive_staged_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_fallacies CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_signoffs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- Recreate foreign keys for conversations
ALTER TABLE ttlive_conversations ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversation_participants ADD FOREIGN KEY (conversation_id) REFERENCES ttlive_conversations(conversation_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversation_participants ADD FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (conversation_id) REFERENCES ttlive_conversations(conversation_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (reply_to_conv_argument_id) REFERENCES ttlive_conversation_arguments(conv_argument_id) ON DELETE SET NULL;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (staged_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL;
ALTER TABLE ttlive_conversation_argument_citations ADD FOREIGN KEY (conv_argument_id) REFERENCES ttlive_conversation_arguments(conv_argument_id) ON DELETE CASCADE;

-- Recreate foreign keys for staged arguments
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (reply_to_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (reply_to_post_id) REFERENCES ttlive_posts(post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (moderated_by) REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (original_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL;

ALTER TABLE ttlive_argument_citations ADD FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE;
ALTER TABLE ttlive_argument_citations ADD FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE ttlive_argument_fallacies ADD FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE;
ALTER TABLE ttlive_argument_fallacies ADD FOREIGN KEY (detected_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE ttlive_argument_fallacies ADD FOREIGN KEY (dismissed_by) REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE ttlive_argument_signoffs ADD FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE;
ALTER TABLE ttlive_argument_signoffs ADD FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- Verify all are now utf8mb4_general_ci
SELECT TABLE_NAME, TABLE_COLLATION
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'truthtrollers'
AND TABLE_NAME LIKE 'ttlive_%'
ORDER BY TABLE_NAME;
-- Should all show utf8mb4_general_ci
