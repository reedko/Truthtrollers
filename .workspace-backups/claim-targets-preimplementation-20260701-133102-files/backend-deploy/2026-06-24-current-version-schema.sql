-- Production schema prep for the current app version.
-- Generated from local code and production read-only schema checks on 2026-06-24.
--
-- Scope:
--   - Creates missing source/admiralty/provider tables required by current code.
--   - Adds current content_claims hierarchy and argument-mapping columns.
--   - Adds current publishers provider-signal summary columns.
--   - Seeds argument-mapping prompt rows required by argumentMappingEngine.
--
-- Safe to re-run: guarded by IF NOT EXISTS / information_schema checks.
-- Do not run automatically until this file has been reviewed and tested.

-- ============================================================
-- 1. Admiralty evaluations
-- ============================================================

CREATE TABLE IF NOT EXISTS admiralty_evaluations (
  admiralty_evaluation_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target_type ENUM('publisher','content','source','claim','claim_link','source_claim') NOT NULL,
  target_id INT UNSIGNED NOT NULL,
  source_url VARCHAR(2048),
  publisher_id INT UNSIGNED,
  source_reliability_letter CHAR(1),
  claim_credibility_number TINYINT UNSIGNED,
  admiralty_code VARCHAR(3),
  confidence ENUM('high','medium','low') DEFAULT 'low',
  evaluation_status ENUM('machine_suggested','human_confirmed','community_reviewed','needs_review','insufficient_data') DEFAULT 'machine_suggested',
  source_reliability_rationale TEXT,
  claim_credibility_rationale TEXT,
  source_signals_json JSON,
  claim_signals_json JSON,
  warnings_json JSON,
  recommended_actions_json JSON,
  created_by ENUM('system','user','admin') DEFAULT 'system',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  reviewed_by_user_id INT UNSIGNED,
  reviewed_at TIMESTAMP NULL,
  UNIQUE KEY uq_target (target_type, target_id),
  INDEX idx_publisher (publisher_id),
  INDEX idx_status (evaluation_status),
  INDEX idx_code (admiralty_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Existing older installs may have idx_target instead of uq_target.
DROP PROCEDURE IF EXISTS _prep_admiralty_unique_key;
DELIMITER $$
CREATE PROCEDURE _prep_admiralty_unique_key()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'admiralty_evaluations'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'admiralty_evaluations'
      AND INDEX_NAME = 'uq_target'
  ) THEN
    DELETE ae
    FROM admiralty_evaluations ae
    LEFT JOIN (
      SELECT MAX(admiralty_evaluation_id) AS keep_id, target_type, target_id
      FROM admiralty_evaluations
      GROUP BY target_type, target_id
    ) keeper ON keeper.keep_id = ae.admiralty_evaluation_id
    WHERE keeper.keep_id IS NULL;

    IF EXISTS (
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'admiralty_evaluations'
        AND INDEX_NAME = 'idx_target'
    ) THEN
      ALTER TABLE admiralty_evaluations DROP INDEX idx_target;
    END IF;

    ALTER TABLE admiralty_evaluations
      ADD UNIQUE KEY uq_target (target_type, target_id);
  END IF;
END$$
DELIMITER ;
CALL _prep_admiralty_unique_key();
DROP PROCEDURE IF EXISTS _prep_admiralty_unique_key;

-- Migrate old F/6 "cannot assess" values if this table already existed.
UPDATE admiralty_evaluations
   SET source_reliability_letter = 'Ø',
       admiralty_code = REPLACE(admiralty_code, 'F', 'Ø')
 WHERE source_reliability_letter = 'F';

UPDATE admiralty_evaluations
   SET claim_credibility_number = NULL,
       admiralty_code = REPLACE(admiralty_code, '6', 'Ø')
 WHERE claim_credibility_number = 6;

-- ============================================================
-- 2. Source identity and lineage
-- ============================================================

CREATE TABLE IF NOT EXISTS publisher_domains (
  publisher_domain_id INT AUTO_INCREMENT PRIMARY KEY,
  publisher_id INT NOT NULL,
  domain VARCHAR(255) NOT NULL,
  root_domain VARCHAR(255) NOT NULL,
  match_type ENUM('exact','root','subdomain','alias') NOT NULL DEFAULT 'exact',
  confidence ENUM('high','medium','low') NOT NULL DEFAULT 'high',
  is_platform_host TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pd_publisher FOREIGN KEY (publisher_id)
    REFERENCES publishers(publisher_id) ON DELETE CASCADE,
  UNIQUE KEY uq_pd_domain (domain),
  INDEX idx_pd_root_domain (root_domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS source_identity_cache (
  source_identity_cache_id INT AUTO_INCREMENT PRIMARY KEY,
  source_url VARCHAR(2048) NOT NULL,
  normalized_url VARCHAR(2048),
  root_domain VARCHAR(255),
  publisher_id INT,
  publisher_name VARCHAR(500),
  source_identity_kind ENUM(
    'publisher_domain','platform_hosted','primary_document',
    'government_source','academic_source','archive_snapshot',
    'domain_fallback','unresolved'
  ) NOT NULL DEFAULT 'unresolved',
  resolution_level TINYINT NOT NULL DEFAULT 0,
  resolution_status ENUM(
    'matched_existing_publisher','matched_publisher_domain',
    'matched_platform_host','matched_metadata',
    'matched_archive','domain_only','unresolved'
  ) NOT NULL DEFAULT 'unresolved',
  source_type ENUM(
    'primary','government','academic','journalism','reference',
    'advocacy','corporate','opinion','social','platform','unknown'
  ) NOT NULL DEFAULT 'unknown',
  reliability ENUM('high','medium','mixed','low','flagged','unchecked') NOT NULL DEFAULT 'unchecked',
  needs_human_review TINYINT(1) NOT NULL DEFAULT 1,
  metadata_json JSON,
  last_checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sic_publisher FOREIGN KEY (publisher_id)
    REFERENCES publishers(publisher_id) ON DELETE SET NULL,
  UNIQUE KEY uq_sic_normalized_url (normalized_url(512)),
  INDEX idx_sic_root_domain (root_domain),
  INDEX idx_sic_publisher_id (publisher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS source_lineage_cache (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_url VARCHAR(2048) NOT NULL,
  normalized_url VARCHAR(2048) NOT NULL,
  lineage_type ENUM('original','excerpt','repost','syndicated','pointer','archive','unknown') NOT NULL DEFAULT 'unknown',
  upstream_url VARCHAR(2048),
  upstream_publisher VARCHAR(512),
  chain_depth TINYINT UNSIGNED NOT NULL DEFAULT 0,
  lineage_chain JSON,
  detection_signals JSON,
  confidence ENUM('high','medium','low') NOT NULL DEFAULT 'low',
  last_checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_normalized_url (normalized_url(768)),
  INDEX idx_lineage_type (lineage_type),
  INDEX idx_upstream_url (upstream_url(512))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 3. Provider signal persistence
-- ============================================================

CREATE TABLE IF NOT EXISTS publisher_external_signals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  publisher_id INT NULL,
  domain VARCHAR(255) NULL,
  entity_name VARCHAR(255) NULL,
  provider VARCHAR(80) NOT NULL,
  signal_type VARCHAR(80) NOT NULL,
  admiralty_effect_type VARCHAR(32) NOT NULL,
  normalized_score DECIMAL(6,2) NULL,
  reliability_bucket VARCHAR(32) NULL,
  confidence_delta DECIMAL(6,4) NULL,
  reliability_delta DECIMAL(6,2) NULL,
  cap VARCHAR(4) NULL,
  cap_reason TEXT NULL,
  flags JSON NULL,
  raw_value JSON NULL,
  matched_name VARCHAR(255) NULL,
  matched_domain VARCHAR(255) NULL,
  match_confidence DECIMAL(6,4) NULL,
  evidence_url TEXT NULL,
  explanation TEXT NULL,
  retrieved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  error_status VARCHAR(80) NULL,
  INDEX idx_publisher_provider (publisher_id, provider),
  INDEX idx_domain_provider (domain, provider),
  INDEX idx_effect (admiralty_effect_type),
  INDEX idx_retrieved (retrieved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS publisher_relationships (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  publisher_id INT NOT NULL,
  related_entity_name VARCHAR(255) NOT NULL,
  related_entity_id VARCHAR(255) NULL,
  relationship_type VARCHAR(64) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  evidence_url TEXT NULL,
  confidence DECIMAL(6,4) NULL,
  raw_value JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_publisher_rel (publisher_id, relationship_type),
  INDEX idx_provider (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 4. Column additions / enum widening
-- ============================================================

DROP PROCEDURE IF EXISTS _prep_current_version_columns;
DELIMITER $$
CREATE PROCEDURE _prep_current_version_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'content_claims'
      AND COLUMN_NAME = 'claim_role'
  ) THEN
    ALTER TABLE content_claims
      ADD COLUMN claim_role ENUM('thesis','pillar','pillar_support','evidence','background','fallibility_critical') NULL AFTER relationship_type;
  ELSE
    ALTER TABLE content_claims
      MODIFY claim_role ENUM('thesis','pillar','pillar_support','evidence','background','fallibility_critical') NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'parent_claim_id') THEN
    ALTER TABLE content_claims ADD COLUMN parent_claim_id INT DEFAULT NULL AFTER claim_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'claim_depth') THEN
    ALTER TABLE content_claims ADD COLUMN claim_depth TINYINT DEFAULT NULL AFTER parent_claim_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'centrality_score') THEN
    ALTER TABLE content_claims ADD COLUMN centrality_score DECIMAL(5,2) DEFAULT NULL AFTER claim_depth;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'verifiability_score') THEN
    ALTER TABLE content_claims ADD COLUMN verifiability_score DECIMAL(5,2) DEFAULT NULL AFTER centrality_score;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'claim_order') THEN
    ALTER TABLE content_claims ADD COLUMN claim_order INT DEFAULT NULL AFTER verifiability_score;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'object_claim_text') THEN
    ALTER TABLE content_claims ADD COLUMN object_claim_text TEXT NULL AFTER claim_order;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'is_attribution') THEN
    ALTER TABLE content_claims ADD COLUMN is_attribution TINYINT(1) NULL AFTER object_claim_text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'speaker_entity') THEN
    ALTER TABLE content_claims ADD COLUMN speaker_entity VARCHAR(255) NULL AFTER is_attribution;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'article_stance') THEN
    ALTER TABLE content_claims ADD COLUMN article_stance VARCHAR(32) NULL AFTER speaker_entity;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'argument_function') THEN
    ALTER TABLE content_claims ADD COLUMN argument_function VARCHAR(64) NULL AFTER article_stance;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'score_transform') THEN
    ALTER TABLE content_claims ADD COLUMN score_transform VARCHAR(16) NULL AFTER argument_function;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'accountability_eligible') THEN
    ALTER TABLE content_claims ADD COLUMN accountability_eligible TINYINT(1) NULL AFTER score_transform;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'argument_mapping_confidence') THEN
    ALTER TABLE content_claims ADD COLUMN argument_mapping_confidence DECIMAL(5,4) NULL AFTER accountability_eligible;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_claims' AND COLUMN_NAME = 'argument_mapping_rationale') THEN
    ALTER TABLE content_claims ADD COLUMN argument_mapping_rationale TEXT NULL AFTER argument_mapping_confidence;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'identity_confidence') THEN
    ALTER TABLE publishers ADD COLUMN identity_confidence DECIMAL(5,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'source_type') THEN
    ALTER TABLE publishers ADD COLUMN source_type VARCHAR(64) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'source_type_confidence') THEN
    ALTER TABLE publishers ADD COLUMN source_type_confidence DECIMAL(5,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'independent_footprint_score') THEN
    ALTER TABLE publishers ADD COLUMN independent_footprint_score DECIMAL(6,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'conflict_of_interest_score') THEN
    ALTER TABLE publishers ADD COLUMN conflict_of_interest_score DECIMAL(6,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'reliability_signal_present') THEN
    ALTER TABLE publishers ADD COLUMN reliability_signal_present TINYINT(1) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'direct_reliability_score') THEN
    ALTER TABLE publishers ADD COLUMN direct_reliability_score DECIMAL(6,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'contextual_credibility_score') THEN
    ALTER TABLE publishers ADD COLUMN contextual_credibility_score DECIMAL(6,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'provenance_score') THEN
    ALTER TABLE publishers ADD COLUMN provenance_score DECIMAL(6,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'publication_legitimacy_score') THEN
    ALTER TABLE publishers ADD COLUMN publication_legitimacy_score DECIMAL(6,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'reliability_cap') THEN
    ALTER TABLE publishers ADD COLUMN reliability_cap VARCHAR(4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'reliability_cap_reason') THEN
    ALTER TABLE publishers ADD COLUMN reliability_cap_reason TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'reliability_signal_sources') THEN
    ALTER TABLE publishers ADD COLUMN reliability_signal_sources JSON NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publishers' AND COLUMN_NAME = 'last_enriched_at') THEN
    ALTER TABLE publishers ADD COLUMN last_enriched_at DATETIME NULL;
  END IF;
END$$
DELIMITER ;
CALL _prep_current_version_columns();
DROP PROCEDURE IF EXISTS _prep_current_version_columns;

-- ============================================================
-- 5. Required argument-mapping prompts
-- ============================================================

UPDATE llm_prompts
   SET is_active = FALSE
 WHERE prompt_name IN ('argument_mapping_system', 'argument_mapping_user');

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT COALESCE(MAX(prompt_id), 0) + 1,
       'argument_mapping_system',
       'system',
       'You map extracted case claims to their function inside the article''s argument.\n\nReturn strict JSON only. Do not include markdown or commentary.\n\nDecide whether the article endorses each claim, rejects it, reports it neutrally, or uses it as an opposing claim to refute.\n\nThis is not fact-checking. Do not use outside knowledge. Use only the article text and extracted claims.\n\nFor attribution claims like "X says Y", distinguish the attribution wrapper from the object claim Y.\n\nscoreTransform controls how evidence about the object claim should affect the article:\n- normal: evidence supporting the object claim supports the article; evidence refuting it weakens the article.\n- invert: evidence supporting the object claim weakens the article; evidence refuting it supports the article.\n- none: the claim should not directly affect the article score.\n- review: unclear; human review needed before scoring.\n\nUse invert when the article presents a claim mainly as an opponent/ad/source claim that the article is trying to discredit.\nUse none for attribution-only, neutral reporting, or background that does not carry the argument.',
       JSON_OBJECT(),
       (SELECT COALESCE(MAX(p.version), 0) + 1 FROM llm_prompts p WHERE p.prompt_name = 'argument_mapping_system'),
       TRUE
  FROM llm_prompts;

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT COALESCE(MAX(prompt_id), 0) + 1,
       'argument_mapping_user',
       'user',
       'Analyze this article excerpt and extracted claims.\n\nARTICLE EXCERPT:\n{{articleExcerpt}}\n\nEXTRACTED THESIS:\n{{articleThesis}}\n\nCLAIMS:\n{{claimsJson}}\n\nReturn JSON with exactly this structure:\n{\n  "articleThesis": "",\n  "claims": [\n    {\n      "claimId": 0,\n      "objectClaim": "",\n      "isAttribution": false,\n      "speakerEntity": "",\n      "articleStanceTowardObjectClaim": "endorses|rejects|neutral|unclear",\n      "argumentFunction": "thesis|supporting_premise|evidence|opposing_claim_to_refute|background|reported_neutral|unclear",\n      "scoreTransform": "normal|invert|none|review",\n      "accountabilityEligible": false,\n      "confidence": 0,\n      "rationale": ""\n    }\n  ]\n}\n\nRules:\n- Include one output item for every input claim.\n- objectClaim is the factual assertion evidence search should evaluate.\n- For "X said/stated/claimed/alleged that Y", objectClaim should be Y.\n- If the article uses Y as an example of what is wrong or false, use argumentFunction opposing_claim_to_refute and scoreTransform invert.\n- If the article uses Y to support its own thesis, use normal.\n- If the article merely says who said something and the object claim does not carry the article argument, use none.\n- Keep rationales short.',
       JSON_OBJECT(),
       (SELECT COALESCE(MAX(p.version), 0) + 1 FROM llm_prompts p WHERE p.prompt_name = 'argument_mapping_user'),
       TRUE
  FROM llm_prompts;

SELECT '2026-06-24 current-version schema prep complete' AS status;
