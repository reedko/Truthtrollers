-- ============================================================================
-- PRODUCTION MIGRATION - April 6, 2026 (MariaDB Compatible)
-- ============================================================================
-- This migration file includes all database changes from March 27 - April 6
-- that may not yet be applied to production.
--
-- CONTENTS:
-- 1. llm_prompts table enhancements (March 27)
-- 2. Evidence query generation prompts (March 27)
-- 3. Remaining hardcoded prompts (March 27)
-- 4. Whitelist requests table (March 29)
-- 5. Extension settings table (March 31)
-- ============================================================================

-- ============================================================================
-- SECTION 1: llm_prompts TABLE ENHANCEMENTS
-- ============================================================================

-- Check if columns exist before adding (MariaDB safe approach)
SET @dbname = DATABASE();
SET @tablename = "llm_prompts";

-- Add max_claims column (safe for MariaDB)
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @dbname
  AND TABLE_NAME = @tablename
  AND COLUMN_NAME = 'max_claims';

SET @query = IF(@col_exists = 0,
  'ALTER TABLE llm_prompts ADD COLUMN max_claims INT DEFAULT 12 COMMENT "Maximum number of claims to extract from article"',
  'SELECT "Column max_claims already exists" AS message');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add min_sources column
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @dbname
  AND TABLE_NAME = @tablename
  AND COLUMN_NAME = 'min_sources';

SET @query = IF(@col_exists = 0,
  'ALTER TABLE llm_prompts ADD COLUMN min_sources INT DEFAULT 2 COMMENT "Minimum number of sources to gather per claim"',
  'SELECT "Column min_sources already exists" AS message');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add max_sources column
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @dbname
  AND TABLE_NAME = @tablename
  AND COLUMN_NAME = 'max_sources';

SET @query = IF(@col_exists = 0,
  'ALTER TABLE llm_prompts ADD COLUMN max_sources INT DEFAULT 4 COMMENT "Maximum number of sources to gather per claim"',
  'SELECT "Column max_sources already exists" AS message');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Set default max_claims for claim extraction prompts
UPDATE llm_prompts
SET max_claims = 12
WHERE prompt_type LIKE 'claim_extraction%'
  AND max_claims IS NULL;

-- Set default source limits for evidence search prompts
UPDATE llm_prompts
SET min_sources = 2, max_sources = 4
WHERE prompt_type IN ('claim_extraction', 'evidence_search')
  AND min_sources IS NULL
  AND max_sources IS NULL;

-- ============================================================================
-- SECTION 2: EVIDENCE QUERY GENERATION PROMPTS
-- ============================================================================

INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (100, 'evidence_query_generation_system', 'system', 'You generate diverse, high-precision search queries for fact-checking. CRITICAL: You must create queries designed to find sources that SUPPORT, REFUTE, and provide NUANCED perspectives on the claim.', '{}', 1, TRUE)
ON DUPLICATE KEY UPDATE prompt_text = VALUES(prompt_text), parameters = VALUES(parameters);

INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (101, 'evidence_query_generation_user', 'user', 'Claim: {{claimText}}\nContext: {{context}}\n\nTask: Produce {{n}} queries across intents with the following distribution:\n- At least 2 queries designed to find sources that SUPPORT the claim (prefer 3)\n- At least 2 queries designed to find sources that REFUTE the claim (prefer 3)\n- At least 1 query designed to find sources that provide NUANCED perspective on the claim (prefer 3)\n- The remaining queries can cover background or factbox information\n\nIMPORTANT: Design your queries to actively seek out sources with different perspectives. For refute queries, look for credible counterarguments, debunking sites, fact-checks, or alternative evidence. For support queries, look for sources that would confirm or provide evidence for the claim. For nuance queries, look for sources that provide context, caveats, or partial support/refutation.', '{"n": 6}', 1, TRUE)
ON DUPLICATE KEY UPDATE prompt_text = VALUES(prompt_text), parameters = VALUES(parameters);

INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (102, 'evidence_query_generation_output', 'user', 'Return EXACTLY {{n}} queries as a JSON array of strings. Example: ["query 1", "query 2", "query 3"]', '{"n": 6}', 1, TRUE)
ON DUPLICATE KEY UPDATE prompt_text = VALUES(prompt_text), parameters = VALUES(parameters);

-- ============================================================================
-- SECTION 3: REMAINING HARDCODED PROMPTS (Source Quality, Triage, etc.)
-- ============================================================================

-- Source Quality Assessment System Prompt
INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (200, 'source_quality_assessment_system', 'system', 'You are a media literacy expert who assesses source quality for fact-checking. You evaluate credibility, bias, and reliability of sources.', '{}', 1, TRUE)
ON DUPLICATE KEY UPDATE prompt_text = VALUES(prompt_text);

-- Source Quality Assessment User Prompt
INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active, min_sources, max_sources)
VALUES (201, 'source_quality_assessment_user', 'user', 'Assess the quality of this source for fact-checking purposes:\n\nSource: {{source_name}}\nURL: {{source_url}}\nContent Preview: {{content_preview}}\n\nEvaluate on:\n1. **Credibility**: Is this a reputable source? Does it have editorial standards?\n2. **Bias**: Does the source show clear political, ideological, or commercial bias?\n3. **Reliability**: Track record of factual reporting\n4. **Relevance**: How well does this source match the claim being verified?\n\nProvide scores (0-100) for:\n- credibility_score\n- bias_score (0 = highly biased, 100 = neutral)\n- reliability_score\n- relevance_score\n\nAlso classify as: primary_source, secondary_source, or tertiary_source', '{}', 1, TRUE, 2, 4)
ON DUPLICATE KEY UPDATE prompt_text = VALUES(prompt_text), min_sources = VALUES(min_sources), max_sources = VALUES(max_sources);

-- Claim Triage System Prompt
INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (300, 'claim_triage_system', 'system', 'You are a fact-checking triage specialist. You determine which claims are checkable and prioritize them for verification.', '{}', 1, TRUE)
ON DUPLICATE KEY UPDATE prompt_text = VALUES(prompt_text);

-- Claim Triage User Prompt
INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (301, 'claim_triage_user', 'user', 'Analyze this claim for fact-checking triage:\n\nClaim: {{claim_text}}\nContext: {{context}}\n\nDetermine:\n1. **Checkability**: Can this claim be verified with evidence? (checkable/opinion/too_vague/prediction)\n2. **Priority**: How important is it to check this claim? (high/medium/low)\n3. **Complexity**: How difficult will it be to fact-check? (simple/moderate/complex)\n4. **Required Evidence Types**: What types of sources would be needed?\n\nClassify and provide reasoning.', '{}', 1, TRUE)
ON DUPLICATE KEY UPDATE prompt_text = VALUES(prompt_text);

-- Evidence Assessment System Prompt
INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (400, 'evidence_assessment_system', 'system', 'You are a critical thinking expert who evaluates how well evidence supports or refutes claims. You assess relevance, strength, and stance.', '{}', 1, TRUE)
ON DUPLICATE KEY UPDATE prompt_text = VALUES(prompt_text);

-- Evidence Assessment User Prompt
INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (401, 'evidence_assessment_user', 'user', 'Evaluate how this evidence relates to the claim:\n\nClaim: {{claim_text}}\nEvidence Source: {{source_name}}\nEvidence Text: {{evidence_text}}\n\nAssess:\n1. **Stance**: Does this evidence support, refute, or provide nuance to the claim?\n2. **Strength**: How strong is this evidence? (0-100)\n3. **Relevance**: How relevant is this evidence? (0-100)\n4. **Support Level**: Overall support level (-1.0 to +1.0, where -1 strongly refutes, 0 is neutral/irrelevant, +1 strongly supports)\n\nProvide your assessment with reasoning.', '{}', 1, TRUE)
ON DUPLICATE KEY UPDATE prompt_text = VALUES(prompt_text);

-- ============================================================================
-- SECTION 4: WHITELIST REQUESTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS whitelist_requests (
  whitelist_request_id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  reason TEXT,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  approved_at TIMESTAMP NULL,
  approved_by INT,
  notes TEXT,
  INDEX idx_email (email),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (approved_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- SECTION 5: EXTENSION SETTINGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS extension_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  description VARCHAR(255),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT,
  FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default verimeter mode settings
INSERT INTO extension_settings (setting_key, setting_value, description)
VALUES ('verimeter_mode', 'user', 'Extension verimeter mode: ai, user, or combined'), ('verimeter_ai_weight', '0.5', 'AI weight for combined mode (0-1)')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Run this script on production to apply all pending changes.
-- All statements are MariaDB/MySQL Workbench compatible.
-- ============================================================================
