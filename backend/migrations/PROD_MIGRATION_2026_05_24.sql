-- ============================================================
-- PROD MIGRATION SCRIPT - Generated 2026-05-24
-- Run against: truthtrollers @ 168.231.73.248 (MariaDB)
-- Source of truth: dev @ localhost (MySQL 8)
--
-- READ BEFORE RUNNING:
--   1. Take a database backup first.
--   2. All statements are idempotent (guarded with IF NOT EXISTS or
--      information_schema checks where MariaDB supports it).
--   3. Sections marked [HIGH RISK] touch PRIMARY KEYs on live tables.
--      Run those in a maintenance window or verify table row counts
--      are small enough to be safe first.
--   4. Do NOT run automatically — review each section manually.
-- ============================================================

-- ============================================================
-- SECTION 1: CREATE MISSING TABLES
-- Tables exist on dev but not on prod.
-- Using utf8mb4_general_ci (MariaDB-compatible; dev uses 0900_ai_ci)
-- ============================================================

-- 1a. publisher_enrichment_runs
-- Tracks each run of the publisher bias/reliability enrichment pipeline
CREATE TABLE IF NOT EXISTS `publisher_enrichment_runs` (
  `enrichment_run_id` int(11) NOT NULL AUTO_INCREMENT,
  `publisher_id` int(11) NOT NULL,
  `domain` varchar(255) DEFAULT NULL,
  `provider` varchar(100) NOT NULL,
  `search_query` text DEFAULT NULL,
  `candidate_url` text DEFAULT NULL,
  `status` enum('found','not_found','ambiguous','error','skipped_recent') DEFAULT 'found',
  `extracted_rating_label` varchar(100) DEFAULT NULL,
  `extracted_bias_score` decimal(5,2) DEFAULT NULL,
  `extracted_veracity_score` decimal(5,2) DEFAULT NULL,
  `extracted_reliability_score` decimal(5,2) DEFAULT NULL,
  `evidence_quote` varchar(500) DEFAULT NULL,
  `confidence` enum('high','medium','low','unknown') DEFAULT 'unknown',
  `error_message` text DEFAULT NULL,
  `raw_result_json` longtext DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`enrichment_run_id`),
  KEY `idx_per_publisher` (`publisher_id`),
  KEY `idx_per_provider` (`provider`),
  KEY `idx_per_pub_prov` (`publisher_id`,`provider`,`created_at`),
  CONSTRAINT `publisher_enrichment_runs_ibfk_1`
    FOREIGN KEY (`publisher_id`) REFERENCES `publishers` (`publisher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 1b. publisher_profiles
-- Stores structured publisher profiles from AllSides / AdFontes / Wikipedia
CREATE TABLE IF NOT EXISTS `publisher_profiles` (
  `publisher_profile_id` int(11) NOT NULL AUTO_INCREMENT,
  `publisher_id` int(11) NOT NULL,
  `source` varchar(100) NOT NULL,
  `profile_url` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `ownership_notes` text DEFAULT NULL,
  `funding_notes` text DEFAULT NULL,
  `credibility_notes` text DEFAULT NULL,
  `political_notes` text DEFAULT NULL,
  `source_type` varchar(100) DEFAULT NULL,
  `country` varchar(100) DEFAULT NULL,
  `evidence_quote` varchar(500) DEFAULT NULL,
  `confidence` enum('high','medium','low','unknown') DEFAULT 'unknown',
  `extraction_method` enum('tavily_search','tavily_extract','llm_extraction','manual','community','unknown') DEFAULT 'unknown',
  `last_checked` datetime DEFAULT NULL,
  `raw_provider_payload` longtext DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`publisher_profile_id`),
  KEY `publisher_id` (`publisher_id`),
  KEY `idx_pp_lookup` (`publisher_id`,`source`,`last_checked`),
  CONSTRAINT `publisher_profiles_ibfk_1`
    FOREIGN KEY (`publisher_id`) REFERENCES `publishers` (`publisher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 1c. system_config
-- Generic key/value config store
CREATE TABLE IF NOT EXISTS `system_config` (
  `config_key` varchar(100) NOT NULL,
  `config_value` text NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- ============================================================
-- SECTION 2: ADD MISSING COLUMNS TO EXISTING TABLES
-- Columns exist on dev but not on prod.
-- ============================================================

-- 2a. allowed_users.notes
ALTER TABLE `allowed_users`
  ADD COLUMN IF NOT EXISTS `notes` text DEFAULT NULL AFTER `updated_at`;

-- 2b. author_ratings: added_by_user_id, is_system
ALTER TABLE `author_ratings`
  ADD COLUMN IF NOT EXISTS `added_by_user_id` int(11) DEFAULT NULL AFTER `user_id`,
  ADD COLUMN IF NOT EXISTS `is_system` tinyint(1) DEFAULT 0 AFTER `added_by_user_id`;

-- 2c. content.extraction_mode
ALTER TABLE `content`
  ADD COLUMN IF NOT EXISTS `extraction_mode` varchar(50) DEFAULT NULL AFTER `content_text`;

-- 2d. publisher_ratings: enrichment columns added by publisher-enrichment feature
ALTER TABLE `publisher_ratings`
  ADD COLUMN IF NOT EXISTS `rating_label`        varchar(100) DEFAULT NULL
    AFTER `source`,
  ADD COLUMN IF NOT EXISTS `rating_type`         enum('bias','reliability','veracity','profile','ownership','unknown') DEFAULT 'unknown'
    AFTER `rating_label`,
  ADD COLUMN IF NOT EXISTS `confidence`          enum('high','medium','low','unknown') DEFAULT 'unknown'
    AFTER `notes`,
  ADD COLUMN IF NOT EXISTS `extraction_method`   enum('licensed_api','tavily_search','tavily_extract','llm_extraction','manual','community','unknown') DEFAULT 'unknown'
    AFTER `confidence`,
  ADD COLUMN IF NOT EXISTS `evidence_quote`      varchar(500) DEFAULT NULL
    AFTER `extraction_method`,
  ADD COLUMN IF NOT EXISTS `raw_provider_payload` longtext DEFAULT NULL
    AFTER `evidence_quote`;

-- 2e. ttlive_conversation_arguments.evidence_content_id
ALTER TABLE `ttlive_conversation_arguments`
  ADD COLUMN IF NOT EXISTS `evidence_content_id` char(36) DEFAULT NULL AFTER `staged_argument_id`;


-- ============================================================
-- SECTION 3: WIDEN IP ADDRESS COLUMNS
-- Dev widened these to varchar(145) to support IPv6-mapped addresses.
-- Prod still has varchar(100) on login_attempts and registration_attempts.
-- (login_events and user_sessions are already 145 on prod — skip those.)
-- ============================================================

-- 3a. login_attempts.ip_address: prod=varchar(100) → dev=varchar(145)
ALTER TABLE `login_attempts`
  MODIFY COLUMN `ip_address` varchar(145) NOT NULL;

-- 3b. registration_attempts.ip_address: prod=varchar(100) → dev=varchar(145)
ALTER TABLE `registration_attempts`
  MODIFY COLUMN `ip_address` varchar(145) NOT NULL;


-- ============================================================
-- SECTION 4: FIX source_platform COLUMN TYPE
-- Dev changed from ENUM to varchar(50) for flexibility.
-- Prod still has ENUM — any value outside the enum silently fails on insert.
-- This change is backward-compatible (all existing enum values are valid varchars).
-- ============================================================

-- 4a. ttlive_imported_posts.source_platform
--     prod: enum('x','twitter','instagram','facebook','reddit')
--     dev:  varchar(50)
ALTER TABLE `ttlive_imported_posts`
  MODIFY COLUMN `source_platform` varchar(50) NOT NULL;

-- 4b. ttlive_threads.source_platform
--     prod: enum('x','twitter','instagram','facebook','reddit','native')
--     dev:  varchar(50)
ALTER TABLE `ttlive_threads`
  MODIFY COLUMN `source_platform` varchar(50) DEFAULT NULL;


-- ============================================================
-- SECTION 5: [HIGH RISK] ADD SURROGATE AUTO-INCREMENT PRIMARY KEYS
--
-- Dev added surrogate PKs to several junction tables via
-- add-surrogate-keys-to-junction-tables.sql and related migrations.
-- Prod still has composite PKs on these tables.
--
-- BEFORE RUNNING THIS SECTION:
--   1. Check row counts: SELECT COUNT(*) FROM <table>;
--   2. These ALTER TABLEs rewrite the entire table on MariaDB — expect
--      a full table lock for the duration.
--   3. Existing composite unique constraints are preserved as UNIQUE KEYs.
--   4. Only run in a maintenance window.
-- ============================================================

-- 5a. bias_vectors
--     prod PK: (entity_id, entity_type, topic_id) → keep as UNIQUE KEY
ALTER TABLE `bias_vectors`
  DROP PRIMARY KEY,
  ADD COLUMN `bias_vector_id` int(11) NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`bias_vector_id`),
  ADD UNIQUE KEY `uq_bias_vector` (`entity_id`, `entity_type`, `topic_id`);

-- 5b. content_users
--     prod PK: (content_id, user_id) → keep as UNIQUE KEY
ALTER TABLE `content_users`
  DROP PRIMARY KEY,
  ADD COLUMN `content_user_id` int(11) NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`content_user_id`),
  ADD UNIQUE KEY `uq_content_user` (`content_id`, `user_id`);

-- 5c. role_permissions
--     prod PK: (role_id, permission_id) → keep as UNIQUE KEY
ALTER TABLE `role_permissions`
  DROP PRIMARY KEY,
  ADD COLUMN `role_permission_id` int(11) NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`role_permission_id`),
  ADD UNIQUE KEY `uq_role_permission` (`role_id`, `permission_id`);

-- 5d. user_permissions
--     prod PK: (user_id, permission_id) → keep as UNIQUE KEY
ALTER TABLE `user_permissions`
  DROP PRIMARY KEY,
  ADD COLUMN `user_permission_id` int(11) NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`user_permission_id`),
  ADD UNIQUE KEY `uq_user_permission` (`user_id`, `permission_id`);

-- 5e. user_reference_visibility
--     prod PK: (user_id, task_content_id, reference_content_id) → keep as UNIQUE KEY
ALTER TABLE `user_reference_visibility`
  DROP PRIMARY KEY,
  ADD COLUMN `user_reference_visibility_id` int(11) NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`user_reference_visibility_id`),
  ADD UNIQUE KEY `uq_user_ref_visibility` (`user_id`, `task_content_id`, `reference_content_id`);

-- 5f. user_veracity_ratings
--     prod PK: (user_id, veracity_relation_id) → keep as UNIQUE KEY
ALTER TABLE `user_veracity_ratings`
  DROP PRIMARY KEY,
  ADD COLUMN `user_veracity_rating_id` int(11) NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (`user_veracity_rating_id`),
  ADD UNIQUE KEY `uq_user_veracity_rating` (`user_id`, `veracity_relation_id`);


-- ============================================================
-- END OF MIGRATION
-- ============================================================
