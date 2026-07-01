-- =====================================================
-- COMPLETE TTLIVE TABLE FIX FOR PROD - SAFE VERSION
-- Checks before dropping foreign keys
-- =====================================================

-- First, check what foreign keys exist
SELECT
    TABLE_NAME,
    CONSTRAINT_NAME,
    REFERENCED_TABLE_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'truthtrollers'
AND TABLE_NAME LIKE 'ttlive_%'
AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME;

-- =====================================================
-- Drop foreign keys (with safe checks)
-- =====================================================

-- Check and drop ttlive_threads foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_threads'
    AND CONSTRAINT_NAME = 'ttlive_threads_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_threads DROP FOREIGN KEY ttlive_threads_ibfk_1', 'SELECT "FK ttlive_threads_ibfk_1 does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_imported_posts foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_imported_posts'
    AND CONSTRAINT_NAME = 'ttlive_imported_posts_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_imported_posts DROP FOREIGN KEY ttlive_imported_posts_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_imported_posts'
    AND CONSTRAINT_NAME = 'ttlive_imported_posts_ibfk_2');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_imported_posts DROP FOREIGN KEY ttlive_imported_posts_ibfk_2', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_posts foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_posts'
    AND CONSTRAINT_NAME = 'ttlive_posts_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_posts DROP FOREIGN KEY ttlive_posts_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_posts'
    AND CONSTRAINT_NAME = 'ttlive_posts_ibfk_2');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_posts DROP FOREIGN KEY ttlive_posts_ibfk_2', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_posts'
    AND CONSTRAINT_NAME = 'ttlive_posts_ibfk_3');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_posts DROP FOREIGN KEY ttlive_posts_ibfk_3', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_posts'
    AND CONSTRAINT_NAME = 'ttlive_posts_ibfk_4');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_posts DROP FOREIGN KEY ttlive_posts_ibfk_4', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_post_evidence foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_post_evidence'
    AND CONSTRAINT_NAME = 'ttlive_post_evidence_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_post_evidence DROP FOREIGN KEY ttlive_post_evidence_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_export_log foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_export_log'
    AND CONSTRAINT_NAME = 'ttlive_export_log_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_export_log DROP FOREIGN KEY ttlive_export_log_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_thread_subscriptions foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_thread_subscriptions'
    AND CONSTRAINT_NAME = 'ttlive_thread_subscriptions_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_thread_subscriptions DROP FOREIGN KEY ttlive_thread_subscriptions_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_conversations foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_conversations'
    AND CONSTRAINT_NAME = 'ttlive_conversations_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_conversations DROP FOREIGN KEY ttlive_conversations_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_conversation_participants foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_conversation_participants'
    AND CONSTRAINT_NAME = 'ttlive_conversation_participants_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_conversation_participants DROP FOREIGN KEY ttlive_conversation_participants_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_conversation_participants'
    AND CONSTRAINT_NAME = 'ttlive_conversation_participants_ibfk_2');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_conversation_participants DROP FOREIGN KEY ttlive_conversation_participants_ibfk_2', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_conversation_arguments foreign keys (all 5)
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_conversation_arguments'
    AND CONSTRAINT_NAME = 'ttlive_conversation_arguments_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_conversation_arguments'
    AND CONSTRAINT_NAME = 'ttlive_conversation_arguments_ibfk_2');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_2', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_conversation_arguments'
    AND CONSTRAINT_NAME = 'ttlive_conversation_arguments_ibfk_3');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_3', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_conversation_arguments'
    AND CONSTRAINT_NAME = 'ttlive_conversation_arguments_ibfk_4');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_4', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_conversation_arguments'
    AND CONSTRAINT_NAME = 'ttlive_conversation_arguments_ibfk_5');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_5', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_conversation_argument_citations foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_conversation_argument_citations'
    AND CONSTRAINT_NAME = 'ttlive_conversation_argument_citations_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_conversation_argument_citations DROP FOREIGN KEY ttlive_conversation_argument_citations_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_staged_arguments foreign keys (7 total)
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_staged_arguments'
    AND CONSTRAINT_NAME = 'ttlive_staged_arguments_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_staged_arguments'
    AND CONSTRAINT_NAME = 'ttlive_staged_arguments_ibfk_2');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_2', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_staged_arguments'
    AND CONSTRAINT_NAME = 'ttlive_staged_arguments_ibfk_3');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_3', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_staged_arguments'
    AND CONSTRAINT_NAME = 'ttlive_staged_arguments_ibfk_4');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_4', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_staged_arguments'
    AND CONSTRAINT_NAME = 'ttlive_staged_arguments_ibfk_5');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_5', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_staged_arguments'
    AND CONSTRAINT_NAME = 'ttlive_staged_arguments_ibfk_6');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_6', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_staged_arguments'
    AND CONSTRAINT_NAME = 'ttlive_staged_arguments_ibfk_7');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_7', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_argument_citations foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_argument_citations'
    AND CONSTRAINT_NAME = 'ttlive_argument_citations_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_argument_citations DROP FOREIGN KEY ttlive_argument_citations_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_argument_citations'
    AND CONSTRAINT_NAME = 'ttlive_argument_citations_ibfk_2');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_argument_citations DROP FOREIGN KEY ttlive_argument_citations_ibfk_2', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_argument_fallacies foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_argument_fallacies'
    AND CONSTRAINT_NAME = 'ttlive_argument_fallacies_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_argument_fallacies DROP FOREIGN KEY ttlive_argument_fallacies_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_argument_fallacies'
    AND CONSTRAINT_NAME = 'ttlive_argument_fallacies_ibfk_2');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_argument_fallacies DROP FOREIGN KEY ttlive_argument_fallacies_ibfk_2', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_argument_fallacies'
    AND CONSTRAINT_NAME = 'ttlive_argument_fallacies_ibfk_3');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_argument_fallacies DROP FOREIGN KEY ttlive_argument_fallacies_ibfk_3', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and drop ttlive_argument_signoffs foreign keys
SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_argument_signoffs'
    AND CONSTRAINT_NAME = 'ttlive_argument_signoffs_ibfk_1');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_argument_signoffs DROP FOREIGN KEY ttlive_argument_signoffs_ibfk_1', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'truthtrollers'
    AND TABLE_NAME = 'ttlive_argument_signoffs'
    AND CONSTRAINT_NAME = 'ttlive_argument_signoffs_ibfk_2');
SET @sql := IF(@exists > 0, 'ALTER TABLE ttlive_argument_signoffs DROP FOREIGN KEY ttlive_argument_signoffs_ibfk_2', 'SELECT "FK does not exist"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================
-- Convert all ttlive tables to utf8mb4_general_ci
-- =====================================================
ALTER TABLE ttlive_threads CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_imported_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_post_evidence CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_export_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_thread_subscriptions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_participants CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_staged_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_fallacies CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_signoffs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- =====================================================
-- Recreate all foreign keys
-- =====================================================

-- ttlive_imported_posts FKs
ALTER TABLE ttlive_imported_posts ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ttlive_imported_posts ADD FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;

-- ttlive_posts FKs
ALTER TABLE ttlive_posts ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ttlive_posts ADD FOREIGN KEY (reply_to_post_id) REFERENCES ttlive_posts(post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_posts ADD FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;

-- ttlive_post_evidence FKs
ALTER TABLE ttlive_post_evidence ADD FOREIGN KEY (post_id) REFERENCES ttlive_posts(post_id) ON DELETE CASCADE;

-- ttlive_export_log FKs
ALTER TABLE ttlive_export_log ADD FOREIGN KEY (post_id) REFERENCES ttlive_posts(post_id) ON DELETE CASCADE;

-- ttlive_thread_subscriptions FKs
ALTER TABLE ttlive_thread_subscriptions ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;

-- ttlive_conversations FKs
ALTER TABLE ttlive_conversations ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;

-- ttlive_conversation_participants FKs
ALTER TABLE ttlive_conversation_participants ADD FOREIGN KEY (conversation_id) REFERENCES ttlive_conversations(conversation_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversation_participants ADD FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- ttlive_conversation_arguments FKs
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (conversation_id) REFERENCES ttlive_conversations(conversation_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (reply_to_conv_argument_id) REFERENCES ttlive_conversation_arguments(conv_argument_id) ON DELETE SET NULL;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (staged_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL;

-- ttlive_conversation_argument_citations FKs
ALTER TABLE ttlive_conversation_argument_citations ADD FOREIGN KEY (conv_argument_id) REFERENCES ttlive_conversation_arguments(conv_argument_id) ON DELETE CASCADE;

-- ttlive_staged_arguments FKs
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (author_user_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (reply_to_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (reply_to_post_id) REFERENCES ttlive_posts(post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (moderated_by) REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (original_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL;

-- ttlive_argument_citations FKs
ALTER TABLE ttlive_argument_citations ADD FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE;
ALTER TABLE ttlive_argument_citations ADD FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE CASCADE;

-- ttlive_argument_fallacies FKs
ALTER TABLE ttlive_argument_fallacies ADD FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE;
ALTER TABLE ttlive_argument_fallacies ADD FOREIGN KEY (detected_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE ttlive_argument_fallacies ADD FOREIGN KEY (dismissed_by) REFERENCES users(user_id) ON DELETE SET NULL;

-- ttlive_argument_signoffs FKs
ALTER TABLE ttlive_argument_signoffs ADD FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE;
ALTER TABLE ttlive_argument_signoffs ADD FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- =====================================================
-- Verify all ttlive tables now have utf8mb4_general_ci
-- =====================================================
SELECT TABLE_NAME, TABLE_COLLATION
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'truthtrollers'
AND TABLE_NAME LIKE 'ttlive_%'
ORDER BY TABLE_NAME;
-- Should all show utf8mb4_general_ci
