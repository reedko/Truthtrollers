-- =====================================================
-- COMPLETE COLLATION FIX
-- =====================================================
-- This fixes the collation mess caused by mixing explicit
-- COLLATE clauses in TTLive table creation.
--
-- Run this on BOTH dev and prod to ensure consistency
-- =====================================================

-- Step 1: Check what the database default is
SELECT
    DEFAULT_CHARACTER_SET_NAME,
    DEFAULT_COLLATION_NAME
FROM INFORMATION_SCHEMA.SCHEMATA
WHERE SCHEMA_NAME = 'truthtrollers';

-- Step 2: Check all table collations (look for inconsistencies)
SELECT
    TABLE_NAME,
    TABLE_COLLATION
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'truthtrollers'
AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;

-- Step 3: Check all column collations (look for inconsistencies)
SELECT
    TABLE_NAME,
    COLUMN_NAME,
    COLLATION_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'truthtrollers'
AND COLLATION_NAME IS NOT NULL
AND TABLE_NAME IN (
    'ttlive_threads',
    'ttlive_imported_posts',
    'ttlive_posts',
    'ttlive_conversations',
    'ttlive_staged_arguments',
    'content',
    'authors',
    'users'
)
ORDER BY TABLE_NAME, COLUMN_NAME;

-- =====================================================
-- AFTER running the above checks:
--
-- IF the database default is utf8mb4_unicode_ci:
--   Run Section A below
--
-- IF the database default is utf8mb4_general_ci:
--   Run Section B below
--
-- IF the database default is utf8mb4_0900_ai_ci:
--   Run Section C below
-- =====================================================


-- =====================================================
-- SECTION A: Fix for utf8mb4_unicode_ci database
-- =====================================================
/*
-- Revert database to NOT force any specific collation
-- (This undoes fix_all_collations.sql)
ALTER DATABASE truthtrollers CHARACTER SET utf8mb4;

-- Convert all tables to use database default (remove explicit collations)
ALTER TABLE ttlive_threads CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_imported_posts CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_posts CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_post_evidence CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_thread_subscriptions CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_export_log CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_conversations CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_conversation_participants CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_conversation_arguments CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_conversation_argument_citations CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_staged_arguments CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_argument_citations CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_argument_fallacies CONVERT TO CHARACTER SET utf8mb4;
ALTER TABLE ttlive_argument_signoffs CONVERT TO CHARACTER SET utf8mb4;

-- Now recreate all stored procedures (they will inherit the connection's collation)
-- First get all procedure definitions with:
-- SHOW CREATE PROCEDURE procedure_name;
-- Then drop and recreate each one
*/


-- =====================================================
-- SECTION B: Fix for utf8mb4_general_ci database (PROD)
-- =====================================================
/*
-- This is likely what prod needs
-- Ensure database uses general_ci
ALTER DATABASE truthtrollers CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- Convert all TTLive tables to match
ALTER TABLE ttlive_threads CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_imported_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_post_evidence CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_thread_subscriptions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_export_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_participants CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_conversation_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_staged_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_fallacies CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE ttlive_argument_signoffs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE discussion_units CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE discussion_unit_evidence CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE discussion_unit_claims CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE discussion_unit_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
ALTER TABLE discussion_unit_rebuttals CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- Verify all columns now match
SELECT DISTINCT COLLATION_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'truthtrollers'
AND COLLATION_NAME IS NOT NULL;
-- Should return only: utf8mb4_general_ci
*/


-- =====================================================
-- SECTION C: Fix for utf8mb4_0900_ai_ci database (DEV)
-- =====================================================
/*
-- This is likely what dev needs
-- Ensure database uses 0900_ai_ci (MySQL 8.0 default)
ALTER DATABASE truthtrollers CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Convert all TTLive tables to match
ALTER TABLE ttlive_threads CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_imported_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_posts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_post_evidence CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_thread_subscriptions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_export_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_conversations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_conversation_participants CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_conversation_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_conversation_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_staged_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_argument_citations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_argument_fallacies CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE ttlive_argument_signoffs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE discussion_units CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE discussion_unit_evidence CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE discussion_unit_claims CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE discussion_unit_arguments CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE discussion_unit_rebuttals CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Verify all columns now match
SELECT DISTINCT COLLATION_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'truthtrollers'
AND COLLATION_NAME IS NOT NULL;
-- Should return only: utf8mb4_0900_ai_ci
*/


-- =====================================================
-- FINAL STEP (for both dev and prod):
-- Recreate all stored procedures
-- =====================================================
-- After tables are consistent, drop and recreate procedures
-- They will automatically inherit the correct collation from
-- your connection's default

-- List of all procedures to recreate:
-- DROP PROCEDURE IF EXISTS check_rate_limit;
-- DROP PROCEDURE IF EXISTS compute_and_store_verimeter_score_for_claim;
-- DROP PROCEDURE IF EXISTS compute_and_store_verimeter_score_for_content;
-- DROP PROCEDURE IF EXISTS compute_simple_verimeter_for_content;
-- DROP PROCEDURE IF EXISTS compute_trollmeter_score;
-- DROP PROCEDURE IF EXISTS compute_verimeter_for_content;
-- DROP PROCEDURE IF EXISTS delete_content_cascade;
-- DROP PROCEDURE IF EXISTS GetContentWithTopics;
-- DROP PROCEDURE IF EXISTS get_adjusted_bias_weight;
-- DROP PROCEDURE IF EXISTS InsertContentAndTopics;
-- DROP PROCEDURE IF EXISTS InsertContentAuthor;
-- DROP PROCEDURE IF EXISTS InsertContentPublisher;
-- DROP PROCEDURE IF EXISTS InsertContentRelation;
-- DROP PROCEDURE IF EXISTS InsertOrGetAuthor;
-- DROP PROCEDURE IF EXISTS InsertOrGetPublisher;
-- DROP PROCEDURE IF EXISTS InsertOrGetReference;
-- DROP PROCEDURE IF EXISTS InsertTaskAndTopics;
-- DROP PROCEDURE IF EXISTS InsertTaskPublisher;
-- DROP PROCEDURE IF EXISTS record_social_post;
-- DROP PROCEDURE IF EXISTS update_argument_signoff_count;
-- DROP PROCEDURE IF EXISTS update_argument_validation_status;
-- DROP PROCEDURE IF EXISTS update_post_replies_count;
-- DROP PROCEDURE IF EXISTS update_thread_stats;

-- Then re-run the migration files that created these procedures
-- OR get the CREATE statements with SHOW CREATE PROCEDURE and recreate them

-- =====================================================
-- SUMMARY
-- =====================================================
-- The root cause was adding explicit COLLATE=utf8mb4_unicode_ci
-- to TTLive table creation, when the database/procedures used
-- a different default collation.
--
-- The fix: Make everything use the SAME collation (whichever
-- the database default is), and NEVER use explicit COLLATE
-- clauses in CREATE TABLE statements unless absolutely necessary.
-- =====================================================
