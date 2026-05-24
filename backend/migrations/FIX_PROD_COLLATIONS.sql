-- =====================================================
-- PROD COLLATION FIX
-- =====================================================
-- This fixes prod to use consistent utf8mb4_general_ci
-- (which is what most tables already use on prod)
-- =====================================================

-- Step 1: Check current database default
SELECT DEFAULT_COLLATION_NAME
FROM INFORMATION_SCHEMA.SCHEMATA
WHERE SCHEMA_NAME = 'truthtrollers';
-- Currently: latin1_swedish_ci (needs to be fixed)

-- Step 2: Check all table collations
SELECT
    TABLE_NAME,
    TABLE_COLLATION
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'truthtrollers'
AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;
-- Shows mix of: utf8mb4_general_ci, utf8mb4_unicode_ci, latin1_swedish_ci

-- =====================================================
-- FIX: Set database default to utf8mb4_general_ci
-- (This is what most prod tables already use)
-- =====================================================
ALTER DATABASE truthtrollers CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- =====================================================
-- Convert all tables to utf8mb4_general_ci
-- =====================================================
ALTER TABLE allowed_users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE author_affiliations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE author_credibility_checks CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE author_ratings CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE authors CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE bias_topic_properties CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE bias_vectors CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE canonical_claims CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE chat_messages CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE claim_link_audit CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE claim_links CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE claim_retrieval_evidence CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE claim_scores CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE claim_sources CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE claim_variants CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE claim_verifications CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE claims CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE claims_references CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_authors CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_claims CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_credibility_checks CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_publishers CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_rating_claim_links CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_rating_evaluations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_ratings CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_relations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_scores CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_source_quality CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_testimonials CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_topics CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE content_versions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE discussion_bundles CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE discussion_entries CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE discussion_unit_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE discussion_units CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE evidence_search_config CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE extension_instances CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE extension_settings CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE last_visited CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE llm_prompts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE login_attempts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE login_events CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE molecule_view_pins CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE molecule_views CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE page_visits CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE password_reset_tokens CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE permissions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE publisher_credibility_checks CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE publisher_ratings CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE publishers CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE push_subscriptions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE rating_evaluation_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE rating_votes CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE reference_claim_links CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE reference_claim_task_links CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE registration_attempts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE role_permissions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE roles CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE scrape_jobs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE search_history CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE search_themes CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE social_post_rate_limits CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE source_quality_scores CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE stored_content CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE system_config CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE temp_claims_to_check CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE testimonials CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE topic_aliases CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE topics CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE tutorial_videos CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_activities CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_claim_ratings CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_claim_visibility CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_evaluation_stats CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_permissions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_reference_visibility CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_reputation CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_roles CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_sessions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_veracity_ratings CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE user_verimeter_scores CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE veracity_history CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE veracity_relations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE whitelist_requests CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE x_auth_tokens CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- =====================================================
-- Fix TTLive tables (need to drop/recreate foreign keys on prod too)
-- =====================================================

-- Drop foreign keys
ALTER TABLE ttlive_conversation_argument_citations DROP FOREIGN KEY ttlive_conversation_argument_citations_ibfk_1;
ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_3;
ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_1;
ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_4;
ALTER TABLE ttlive_conversation_arguments DROP FOREIGN KEY ttlive_conversation_arguments_ibfk_5;
ALTER TABLE ttlive_conversation_participants DROP FOREIGN KEY ttlive_conversation_participants_ibfk_1;
ALTER TABLE ttlive_imported_posts DROP FOREIGN KEY ttlive_imported_posts_ibfk_2;
ALTER TABLE ttlive_posts DROP FOREIGN KEY ttlive_posts_ibfk_4;
ALTER TABLE ttlive_posts DROP FOREIGN KEY ttlive_posts_ibfk_3;
ALTER TABLE ttlive_posts DROP FOREIGN KEY ttlive_posts_ibfk_1;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_5;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_4;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_3;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_7;
ALTER TABLE ttlive_staged_arguments DROP FOREIGN KEY ttlive_staged_arguments_ibfk_1;
ALTER TABLE ttlive_export_log DROP FOREIGN KEY ttlive_export_log_ibfk_1;
ALTER TABLE ttlive_post_evidence DROP FOREIGN KEY ttlive_post_evidence_ibfk_1;
ALTER TABLE ttlive_argument_citations DROP FOREIGN KEY ttlive_argument_citations_ibfk_1;
ALTER TABLE ttlive_argument_fallacies DROP FOREIGN KEY ttlive_argument_fallacies_ibfk_1;
ALTER TABLE ttlive_argument_signoffs DROP FOREIGN KEY ttlive_argument_signoffs_ibfk_1;
ALTER TABLE ttlive_conversations DROP FOREIGN KEY ttlive_conversations_ibfk_1;
ALTER TABLE ttlive_imported_posts DROP FOREIGN KEY ttlive_imported_posts_ibfk_1;
ALTER TABLE ttlive_thread_subscriptions DROP FOREIGN KEY ttlive_thread_subscriptions_ibfk_1;

-- Convert tables
ALTER TABLE ttlive_threads CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_imported_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_staged_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_participants CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_fallacies CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_signoffs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_export_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_post_evidence CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_thread_subscriptions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- Recreate foreign keys
ALTER TABLE ttlive_conversation_argument_citations ADD FOREIGN KEY (conv_argument_id) REFERENCES ttlive_conversation_arguments(conv_argument_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (reply_to_conv_argument_id) REFERENCES ttlive_conversation_arguments(conv_argument_id) ON DELETE SET NULL;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (conversation_id) REFERENCES ttlive_conversations(conversation_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_conversation_arguments ADD FOREIGN KEY (staged_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL;
ALTER TABLE ttlive_conversation_participants ADD FOREIGN KEY (conversation_id) REFERENCES ttlive_conversations(conversation_id) ON DELETE CASCADE;
ALTER TABLE ttlive_imported_posts ADD FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_imported_posts ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ttlive_posts ADD FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_posts ADD FOREIGN KEY (reply_to_post_id) REFERENCES ttlive_posts(post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_posts ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (reply_to_imported_post_id) REFERENCES ttlive_imported_posts(imported_post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (reply_to_post_id) REFERENCES ttlive_posts(post_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (reply_to_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (original_argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE SET NULL;
ALTER TABLE ttlive_staged_arguments ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ttlive_export_log ADD FOREIGN KEY (post_id) REFERENCES ttlive_posts(post_id) ON DELETE CASCADE;
ALTER TABLE ttlive_post_evidence ADD FOREIGN KEY (post_id) REFERENCES ttlive_posts(post_id) ON DELETE CASCADE;
ALTER TABLE ttlive_argument_citations ADD FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE;
ALTER TABLE ttlive_argument_fallacies ADD FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE;
ALTER TABLE ttlive_argument_signoffs ADD FOREIGN KEY (argument_id) REFERENCES ttlive_staged_arguments(argument_id) ON DELETE CASCADE;
ALTER TABLE ttlive_conversations ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;
ALTER TABLE ttlive_thread_subscriptions ADD FOREIGN KEY (thread_id) REFERENCES ttlive_threads(thread_id) ON DELETE CASCADE;

-- =====================================================
-- Verify everything is now consistent
-- =====================================================
SELECT DISTINCT TABLE_COLLATION
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'truthtrollers'
AND TABLE_TYPE = 'BASE TABLE';
-- Should return only: utf8mb4_general_ci

SELECT DISTINCT COLLATION_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'truthtrollers'
AND COLLATION_NAME IS NOT NULL;
-- Should return only: utf8mb4_general_ci

-- =====================================================
-- DONE - Prod should now be consistent
-- =====================================================
