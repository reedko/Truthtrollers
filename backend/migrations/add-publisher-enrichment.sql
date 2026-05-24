-- ============================================================
-- Publisher Enrichment Migration
-- Run once. All CREATE TABLE statements are idempotent.
-- The ALTER TABLE block uses a helper procedure to skip columns
-- that already exist, so it is also safe to re-run.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART 1: Extend publisher_ratings with enrichment columns
-- ────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS _tt_add_col;

DELIMITER //
CREATE PROCEDURE _tt_add_col(
  IN p_table VARCHAR(64),
  IN p_col   VARCHAR(64),
  IN p_def   TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = p_table
      AND column_name  = p_col
  ) THEN
    SET @_sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_def);
    PREPARE _stmt FROM @_sql;
    EXECUTE _stmt;
    DEALLOCATE PREPARE _stmt;
  END IF;
END //
DELIMITER ;

-- rating_label: e.g. "Lean Left", "Center", "Lean Right"
CALL _tt_add_col('publisher_ratings', 'rating_label',
  "rating_label VARCHAR(100) NULL AFTER source");

-- rating_type: what kind of rating this row represents
CALL _tt_add_col('publisher_ratings', 'rating_type',
  "rating_type ENUM('bias','reliability','veracity','profile','ownership','unknown') DEFAULT 'unknown' AFTER rating_label");

-- confidence: how confident we are in the extracted value
CALL _tt_add_col('publisher_ratings', 'confidence',
  "confidence ENUM('high','medium','low','unknown') DEFAULT 'unknown' AFTER notes");

-- extraction_method: how the value was obtained
CALL _tt_add_col('publisher_ratings', 'extraction_method',
  "extraction_method ENUM('licensed_api','tavily_search','tavily_extract','llm_extraction','manual','community','unknown') DEFAULT 'unknown' AFTER confidence");

-- evidence_quote: verbatim text that supports the rating (≤500 chars)
CALL _tt_add_col('publisher_ratings', 'evidence_quote',
  "evidence_quote VARCHAR(500) NULL AFTER extraction_method");

-- raw_provider_payload: full JSON audit payload from the enrichment run
-- Using LONGTEXT instead of JSON for broadest MySQL version compatibility
CALL _tt_add_col('publisher_ratings', 'raw_provider_payload',
  "raw_provider_payload LONGTEXT NULL AFTER evidence_quote");

DROP PROCEDURE IF EXISTS _tt_add_col;

-- ────────────────────────────────────────────────────────────
-- PART 2: publisher_profiles — narrative/profile context
-- One row per publisher per source (upsert on re-enrichment)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS publisher_profiles (
  publisher_profile_id  INT NOT NULL AUTO_INCREMENT,
  publisher_id          INT NOT NULL,
  source                VARCHAR(100) NOT NULL,          -- 'Wikipedia', 'AllSides', etc.
  profile_url           TEXT NULL,
  description           TEXT NULL,
  ownership_notes       TEXT NULL,
  funding_notes         TEXT NULL,
  credibility_notes     TEXT NULL,
  political_notes       TEXT NULL,
  source_type           VARCHAR(100) NULL,              -- 'newspaper', 'nonprofit', 'think tank', etc.
  country               VARCHAR(100) NULL,
  evidence_quote        VARCHAR(500) NULL,
  confidence            ENUM('high','medium','low','unknown') DEFAULT 'unknown',
  extraction_method     ENUM('tavily_search','tavily_extract','llm_extraction','manual','community','unknown') DEFAULT 'unknown',
  last_checked          DATETIME NULL,
  raw_provider_payload  LONGTEXT NULL,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (publisher_profile_id),
  KEY publisher_id (publisher_id),
  KEY idx_pp_lookup (publisher_id, source, last_checked),
  CONSTRAINT publisher_profiles_ibfk_1
    FOREIGN KEY (publisher_id) REFERENCES publishers (publisher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────
-- PART 3: publisher_enrichment_runs — audit log
-- One row per provider attempt, never deleted
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS publisher_enrichment_runs (
  enrichment_run_id         INT NOT NULL AUTO_INCREMENT,
  publisher_id              INT NOT NULL,
  domain                    VARCHAR(255) NULL,
  provider                  VARCHAR(100) NOT NULL,      -- 'AllSides', 'Ad Fontes', 'Wikipedia'
  search_query              TEXT NULL,
  candidate_url             TEXT NULL,
  status                    ENUM('found','not_found','ambiguous','error','skipped_recent') DEFAULT 'found',
  extracted_rating_label    VARCHAR(100) NULL,
  extracted_bias_score      DECIMAL(5,2) NULL,
  extracted_veracity_score  DECIMAL(5,2) NULL,
  extracted_reliability_score DECIMAL(5,2) NULL,
  evidence_quote            VARCHAR(500) NULL,
  confidence                ENUM('high','medium','low','unknown') DEFAULT 'unknown',
  error_message             TEXT NULL,
  raw_result_json           LONGTEXT NULL,
  created_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (enrichment_run_id),
  KEY idx_per_publisher  (publisher_id),
  KEY idx_per_provider   (provider),
  KEY idx_per_pub_prov   (publisher_id, provider, created_at),
  CONSTRAINT publisher_enrichment_runs_ibfk_1
    FOREIGN KEY (publisher_id) REFERENCES publishers (publisher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ────────────────────────────────────────────────────────────
-- PART 4: Helpful composite index on publisher_ratings
-- (publisher_id + source + rating_type + last_checked for freshness queries)
-- ────────────────────────────────────────────────────────────

-- Conditional index creation via stored procedure + information_schema check.
DROP PROCEDURE IF EXISTS _tt_add_idx;

DELIMITER //
CREATE PROCEDURE _tt_add_idx(
  IN p_table VARCHAR(64),
  IN p_idx   VARCHAR(64),
  IN p_def   TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = p_table
      AND index_name   = p_idx
  ) THEN
    SET @_sql = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_idx, '` ', p_def);
    PREPARE _stmt FROM @_sql;
    EXECUTE _stmt;
    DEALLOCATE PREPARE _stmt;
  END IF;
END //
DELIMITER ;

CALL _tt_add_idx('publisher_ratings', 'idx_pr_enrichment',
  '(publisher_id, source, rating_type, last_checked)');

DROP PROCEDURE IF EXISTS _tt_add_idx;
