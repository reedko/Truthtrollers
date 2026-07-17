-- Shared CF1/ER1 claim-selection and evaluation-target schema.
-- No TM4 tables, identifiers, prompts, package rows, or backfill.
-- Additive and safe to re-run on MySQL 8 and MariaDB 10.5.

CREATE TABLE IF NOT EXISTS claim_evaluation_targets (
  evaluation_target_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  content_id INT NOT NULL,
  claim_id INT NOT NULL,
  parent_target_id BIGINT UNSIGNED NULL,
  target_type VARCHAR(32) NOT NULL,
  target_text TEXT NOT NULL,
  subject_entity VARCHAR(500) NULL,
  predicate_text VARCHAR(500) NULL,
  object_text TEXT NULL,
  alleged_action VARCHAR(500) NULL,
  study_title TEXT NULL,
  study_authors TEXT NULL,
  study_year SMALLINT NULL,
  study_identifier VARCHAR(255) NULL,
  population_scope TEXT NULL,
  source_excerpt TEXT NULL,
  article_stance VARCHAR(32) NOT NULL DEFAULT 'unclear',
  score_transform VARCHAR(32) NOT NULL DEFAULT 'review',
  search_eligible TINYINT(1) NOT NULL DEFAULT 1,
  verdict_eligible TINYINT(1) NOT NULL DEFAULT 1,
  resolution_status VARCHAR(32) NOT NULL DEFAULT 'unresolved',
  target_order SMALLINT NOT NULL DEFAULT 0,
  mapping_confidence DECIMAL(5,4) NULL,
  mapping_rationale TEXT NULL,
  primary_query_text TEXT NULL COMMENT 'Preferred initial evidence query',
  query_hints_json JSON NULL COMMENT 'Portable query guidance for evidence discovery',
  bearing_criteria_json JSON NULL COMMENT 'Must-match and non-bearing rejection guidance',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (evaluation_target_id),
  UNIQUE KEY uq_claim_evaluation_target_order (content_id, claim_id, target_order),
  KEY idx_evaluation_target_claim (claim_id, content_id),
  KEY idx_evaluation_target_type_status (target_type, resolution_status),
  KEY idx_evaluation_target_parent (parent_target_id),
  KEY idx_cet_content_claim_search
    (content_id, claim_id, search_eligible, verdict_eligible),
  CONSTRAINT fk_evaluation_target_parent FOREIGN KEY (parent_target_id)
    REFERENCES claim_evaluation_targets (evaluation_target_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluation_target_evidence_links (
  evaluation_target_evidence_link_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  evaluation_target_id BIGINT UNSIGNED NOT NULL,
  reference_content_id INT NULL,
  reference_claim_id INT NULL,
  stance VARCHAR(32) NOT NULL DEFAULT 'insufficient',
  bearing_score DECIMAL(6,5) NOT NULL DEFAULT 0,
  confidence DECIMAL(6,5) NOT NULL DEFAULT 0,
  rationale TEXT NULL,
  quote_text TEXT NULL,
  provider VARCHAR(64) NULL,
  provider_provenance JSON NULL,
  created_by_ai TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (evaluation_target_evidence_link_id),
  UNIQUE KEY uq_target_reference_claim
    (evaluation_target_id, reference_content_id, reference_claim_id),
  KEY idx_target_evidence_reference (reference_content_id, reference_claim_id),
  CONSTRAINT fk_target_evidence_target FOREIGN KEY (evaluation_target_id)
    REFERENCES claim_evaluation_targets (evaluation_target_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS cf1_er1_add_column;
DELIMITER $$
CREATE PROCEDURE cf1_er1_add_column(
  IN table_value VARCHAR(64), IN column_value VARCHAR(64), IN ddl_value TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = table_value
      AND COLUMN_NAME = column_value
  ) THEN
    SET @shared_ddl = ddl_value;
    PREPARE shared_stmt FROM @shared_ddl;
    EXECUTE shared_stmt;
    DEALLOCATE PREPARE shared_stmt;
  END IF;
END$$
DELIMITER ;

CALL cf1_er1_add_column('content_claims', 'selected_for_evaluation',
  'ALTER TABLE content_claims ADD COLUMN selected_for_evaluation TINYINT(1) DEFAULT 0');
CALL cf1_er1_add_column('content_claims', 'evaluation_eligible',
  'ALTER TABLE content_claims ADD COLUMN evaluation_eligible TINYINT(1) DEFAULT 1');
CALL cf1_er1_add_column('content_claims', 'verdict_eligible',
  'ALTER TABLE content_claims ADD COLUMN verdict_eligible TINYINT(1) DEFAULT 1');
CALL cf1_er1_add_column('content_claims', 'search_eligible',
  'ALTER TABLE content_claims ADD COLUMN search_eligible TINYINT(1) DEFAULT 1');
CALL cf1_er1_add_column('content_claims', 'source_eligible',
  'ALTER TABLE content_claims ADD COLUMN source_eligible TINYINT(1) DEFAULT 1');
CALL cf1_er1_add_column('content_claims', 'visibility',
  'ALTER TABLE content_claims ADD COLUMN visibility VARCHAR(32) DEFAULT ''workspace''');
CALL cf1_er1_add_column('content_claims', 'selected_for_background',
  'ALTER TABLE content_claims ADD COLUMN selected_for_background TINYINT(1) DEFAULT 0');
CALL cf1_er1_add_column('content_claims', 'source_usefulness',
  'ALTER TABLE content_claims ADD COLUMN source_usefulness ENUM(''high'',''medium'',''low'') DEFAULT NULL');
CALL cf1_er1_add_column('claim_evaluation_targets', 'primary_query_text',
  'ALTER TABLE claim_evaluation_targets ADD COLUMN primary_query_text TEXT NULL');
CALL cf1_er1_add_column('claim_evaluation_targets', 'query_hints_json',
  'ALTER TABLE claim_evaluation_targets ADD COLUMN query_hints_json JSON NULL');
CALL cf1_er1_add_column('claim_evaluation_targets', 'bearing_criteria_json',
  'ALTER TABLE claim_evaluation_targets ADD COLUMN bearing_criteria_json JSON NULL');

DROP PROCEDURE IF EXISTS cf1_er1_add_column;

DROP PROCEDURE IF EXISTS cf1_er1_add_index;
DELIMITER $$
CREATE PROCEDURE cf1_er1_add_index(
  IN table_value VARCHAR(64), IN index_value VARCHAR(64), IN ddl_value TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = table_value
      AND INDEX_NAME = index_value
  ) THEN
    SET @shared_ddl = ddl_value;
    PREPARE shared_stmt FROM @shared_ddl;
    EXECUTE shared_stmt;
    DEALLOCATE PREPARE shared_stmt;
  END IF;
END$$
DELIMITER ;

CALL cf1_er1_add_index('content_claims', 'idx_evaluation_lane',
  'ALTER TABLE content_claims ADD INDEX idx_evaluation_lane (selected_for_evaluation, evaluation_eligible, verdict_eligible)');
CALL cf1_er1_add_index('content_claims', 'idx_background_lane',
  'ALTER TABLE content_claims ADD INDEX idx_background_lane (selected_for_background, source_usefulness)');
CALL cf1_er1_add_index('content_claims', 'idx_visibility',
  'ALTER TABLE content_claims ADD INDEX idx_visibility (visibility)');
CALL cf1_er1_add_index('claim_evaluation_targets', 'idx_cet_content_claim_search',
  'ALTER TABLE claim_evaluation_targets ADD INDEX idx_cet_content_claim_search (content_id, claim_id, search_eligible, verdict_eligible)');

DROP PROCEDURE IF EXISTS cf1_er1_add_index;

SELECT 'CF1/ER1 shared claim schema ready; no TM4 objects created' AS status;
