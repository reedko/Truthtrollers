-- ============================================================================
-- Migration: TM4 Claim Package Persistence
-- ============================================================================
-- Persists the full TM4 pipeline output (Phase 1 raw visible claim
-- occurrences, Phase 1b reconciliation, Phase 2b selection, Phase 3 target
-- metadata) WITHOUT flooding Workspace:
--
--   * claims            (existing)  — canonical claim text, unchanged
--   * content_claims    (existing)  — Workspace-visible rows; ONLY Phase 2b
--                                     selectedEvaluationClaims are inserted
--                                     here (Option 1 safe model — raw claims
--                                     never enter this table)
--   * claim_evaluation_targets (existing) — engine-facing Phase 3 targets;
--                                     extended additively with TM4 columns
--   * tm4_claim_packages            (new) — run/package level record
--   * tm4_raw_claim_occurrences     (new) — ALL Phase 1 occurrences (~60),
--                                     persisted for audit/provenance, never
--                                     Workspace-visible
--   * tm4_claim_reconciliations     (new) — Phase 1b duplicate/stance groups
--   * tm4_selected_evaluation_claims (new) — the 8–12 product-facing claims,
--                                     anchored to content_claims.cc_id
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + information_schema-guarded
-- ALTERs (house pattern from add_claim_selection_lanes.sql).
-- No DROP, no RENAME, no destructive UPDATE.
-- ============================================================================

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- ============================================================================
-- SECTION 1: tm4_claim_packages — one row per TM4 pipeline run/package
-- ============================================================================
CREATE TABLE IF NOT EXISTS tm4_claim_packages (
  tm4_claim_package_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  content_id           INT NOT NULL COMMENT 'Task content this package was materialized into',
  run_id               VARCHAR(64) NOT NULL COMMENT 'e.g. tm4prev-2026-07-08T12-42-18',
  pipeline_version     VARCHAR(32) NULL,
  source_package_path  VARCHAR(512) NULL COMMENT 'Sidecar/readiness package file',
  source_package_hash  CHAR(64) NULL COMMENT 'sha256 of the persisted tm4 payload',
  fixture_name         VARCHAR(255) NULL,
  article_thesis       TEXT NULL,
  raw_claim_count      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  selected_claim_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  target_count         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  selection_summary_json JSON NULL,
  diagnostics_json     JSON NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tm4_claim_package_id),
  UNIQUE KEY uq_tm4_pkg_run (run_id),
  KEY idx_tm4_pkg_content (content_id),
  CONSTRAINT fk_tm4_pkg_content FOREIGN KEY (content_id)
    REFERENCES content (content_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='TM4 pipeline run/package records (one per materialized run)';

-- ============================================================================
-- SECTION 2: tm4_raw_claim_occurrences — ALL Phase 1 occurrences (audit/
-- provenance/background). NOT Workspace-visible; Workspace reads
-- content_claims, which only ever receives selected claims.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tm4_raw_claim_occurrences (
  tm4_raw_claim_occurrence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tm4_claim_package_id BIGINT UNSIGNED NOT NULL,
  content_id           INT NOT NULL,
  claim_id             INT NULL COMMENT 'canonical claims row; set only when this occurrence was selected/canonicalized',
  source_claim_id      VARCHAR(32) NOT NULL COMMENT 'TM4 occurrence id, e.g. S03-C2',
  occurrence_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  section_index        SMALLINT NULL,
  section_heading      VARCHAR(512) NULL,
  visible_claim_text   TEXT NOT NULL,
  canonical_excerpt    TEXT NULL,
  source_sentence_ids_json JSON NULL,
  claim_form           VARCHAR(64) NULL,
  article_use          VARCHAR(64) NULL,
  speaker_source       VARCHAR(255) NULL,
  embedded_substantive_claim TEXT NULL,
  warrant_context      VARCHAR(512) NULL COMMENT 'TM4 warrantHint',
  score_transform      VARCHAR(16) NULL,
  evaluation_lane_hint VARCHAR(32) NULL,
  pillar_id            VARCHAR(16) NULL,
  cluster_id           VARCHAR(16) NULL,
  phase2_role          VARCHAR(32) NULL,
  is_selected          TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = became a selectedEvaluationClaim',
  suppression_reason   VARCHAR(255) NULL COMMENT 'why Phase 2b did not select it',
  selection_score      DECIMAL(6,4) NULL,
  phase1_json          JSON NULL COMMENT 'full Phase 1/2 readiness entry (debug payload)',
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tm4_raw_claim_occurrence_id),
  UNIQUE KEY uq_tm4_raw_pkg_source (tm4_claim_package_id, source_claim_id),
  KEY idx_tm4_raw_content (content_id),
  KEY idx_tm4_raw_selected (tm4_claim_package_id, is_selected),
  CONSTRAINT fk_tm4_raw_pkg FOREIGN KEY (tm4_claim_package_id)
    REFERENCES tm4_claim_packages (tm4_claim_package_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='All TM4 Phase 1 raw visible claim occurrences (audit/provenance; never Workspace)';

-- ============================================================================
-- SECTION 3: tm4_claim_reconciliations — Phase 1b duplicate/stance groups
-- ============================================================================
CREATE TABLE IF NOT EXISTS tm4_claim_reconciliations (
  tm4_reconciliation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tm4_claim_package_id  BIGINT UNSIGNED NOT NULL,
  group_id              VARCHAR(32) NOT NULL,
  raw_occurrence_id     BIGINT UNSIGNED NOT NULL,
  source_claim_id       VARCHAR(32) NOT NULL,
  canonical_source_claim_id VARCHAR(32) NULL COMMENT 'occurrence Phase 1b kept as canonical',
  status                VARCHAR(32) NULL COMMENT 'reconciled | review | none',
  reconciliation_reason VARCHAR(512) NULL,
  reconciliation_json   JSON NULL COMMENT 'before/after stance, conflict reasons',
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tm4_reconciliation_id),
  KEY idx_tm4_recon_pkg_group (tm4_claim_package_id, group_id),
  CONSTRAINT fk_tm4_recon_pkg FOREIGN KEY (tm4_claim_package_id)
    REFERENCES tm4_claim_packages (tm4_claim_package_id) ON DELETE CASCADE,
  CONSTRAINT fk_tm4_recon_raw FOREIGN KEY (raw_occurrence_id)
    REFERENCES tm4_raw_claim_occurrences (tm4_raw_claim_occurrence_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='TM4 Phase 1b duplicate/stance reconciliation records';

-- ============================================================================
-- SECTION 4: tm4_selected_evaluation_claims — the 8–12 product-facing claims.
-- Anchored to content_claims.cc_id (the per-article claim occurrence anchor).
-- content_claim_id / claim_id are indexed plain columns (no FK) so the
-- existing delete_content_cascade procedure keeps working unchanged; rows are
-- removed via the package FK cascade when the content row is deleted.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tm4_selected_evaluation_claims (
  tm4_selected_evaluation_claim_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tm4_claim_package_id  BIGINT UNSIGNED NOT NULL,
  content_id            INT NOT NULL,
  content_claim_id      BIGINT UNSIGNED NULL COMMENT 'content_claims.cc_id of the Workspace-visible row',
  claim_id              INT NOT NULL COMMENT 'canonical claims.claim_id',
  source_raw_occurrence_id BIGINT UNSIGNED NULL,
  source_claim_id       VARCHAR(32) NOT NULL COMMENT 'TM4 occurrence id of the canonical occurrence',
  cluster_id            VARCHAR(16) NULL,
  pillar_id             VARCHAR(16) NULL,
  selection_rank        SMALLINT UNSIGNED NOT NULL,
  selection_score       DECIMAL(6,4) NULL,
  thesis_relevance_score DECIMAL(6,4) NULL,
  evidence_priority     SMALLINT UNSIGNED NULL COMMENT 'defaults to selection_rank',
  representative_claim_text TEXT NOT NULL,
  evaluation_question   TEXT NULL,
  selection_reason      TEXT NULL,
  selection_breakdown_json JSON NULL,
  source_raw_claim_ids_json JSON NULL COMMENT 'all occurrence ids collapsed into this claim',
  is_workspace_visible  TINYINT(1) NOT NULL DEFAULT 1,
  is_evidence_eligible  TINYINT(1) NOT NULL DEFAULT 1,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tm4_selected_evaluation_claim_id),
  UNIQUE KEY uq_tm4_sel_pkg_rank (tm4_claim_package_id, selection_rank),
  KEY idx_tm4_sel_content (content_id, is_evidence_eligible),
  KEY idx_tm4_sel_cc (content_claim_id),
  KEY idx_tm4_sel_claim (claim_id),
  CONSTRAINT fk_tm4_sel_pkg FOREIGN KEY (tm4_claim_package_id)
    REFERENCES tm4_claim_packages (tm4_claim_package_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='TM4 Phase 2b selectedEvaluationClaims — the only TM4 claims Workspace shows';

-- ============================================================================
-- SECTION 5: claim_evaluation_targets — additive TM4 columns.
-- This existing table is what the evidence engine already consumes
-- (loadClaimEvaluationTargets / dualWriteTargetEvidenceLinks), so Phase 3
-- target metadata extends it rather than duplicating it in a parallel table.
-- ============================================================================

-- source_claim_id
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claim_evaluation_targets' AND COLUMN_NAME = 'source_claim_id');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_evaluation_targets ADD COLUMN source_claim_id VARCHAR(32) NULL COMMENT "TM4 occurrence id (e.g. S03-C2)" AFTER mapping_rationale',
  'SELECT "Column source_claim_id already exists" AS Info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- target_key
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claim_evaluation_targets' AND COLUMN_NAME = 'target_key');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_evaluation_targets ADD COLUMN target_key VARCHAR(64) NULL COMMENT "TM4 targetId (stable within run)" AFTER source_claim_id',
  'SELECT "Column target_key already exists" AS Info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- primary_query_text
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claim_evaluation_targets' AND COLUMN_NAME = 'primary_query_text');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_evaluation_targets ADD COLUMN primary_query_text TEXT NULL COMMENT "TM4 queryHints.primaryQueryText" AFTER target_key',
  'SELECT "Column primary_query_text already exists" AS Info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- query_hints_json
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claim_evaluation_targets' AND COLUMN_NAME = 'query_hints_json');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_evaluation_targets ADD COLUMN query_hints_json JSON NULL COMMENT "TM4 queryHints" AFTER primary_query_text',
  'SELECT "Column query_hints_json already exists" AS Info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- bearing_criteria_json
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claim_evaluation_targets' AND COLUMN_NAME = 'bearing_criteria_json');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_evaluation_targets ADD COLUMN bearing_criteria_json JSON NULL COMMENT "TM4 bearingCriteria (mustMatch/rejectIfOnly/weak)" AFTER query_hints_json',
  'SELECT "Column bearing_criteria_json already exists" AS Info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- quality_status
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claim_evaluation_targets' AND COLUMN_NAME = 'quality_status');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_evaluation_targets ADD COLUMN quality_status VARCHAR(32) NULL COMMENT "TM4 quality audit: passing | flagged | acknowledged" AFTER bearing_criteria_json',
  'SELECT "Column quality_status already exists" AS Info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- quality_flags_json
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claim_evaluation_targets' AND COLUMN_NAME = 'quality_flags_json');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_evaluation_targets ADD COLUMN quality_flags_json JSON NULL AFTER quality_status',
  'SELECT "Column quality_flags_json already exists" AS Info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- weak_bearing
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claim_evaluation_targets' AND COLUMN_NAME = 'weak_bearing');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_evaluation_targets ADD COLUMN weak_bearing TINYINT(1) NOT NULL DEFAULT 0 COMMENT "TM4 bearingCriteria.weak — down-weight, never generic" AFTER quality_flags_json',
  'SELECT "Column weak_bearing already exists" AS Info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- needs_atomic_split
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claim_evaluation_targets' AND COLUMN_NAME = 'needs_atomic_split');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE claim_evaluation_targets ADD COLUMN needs_atomic_split TINYINT(1) NOT NULL DEFAULT 0 AFTER weak_bearing',
  'SELECT "Column needs_atomic_split already exists" AS Info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Gating index for the evidence candidate query
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claim_evaluation_targets' AND INDEX_NAME = 'idx_cet_content_claim_search');
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE claim_evaluation_targets ADD INDEX idx_cet_content_claim_search (content_id, claim_id, search_eligible, verdict_eligible)',
  'SELECT "Index idx_cet_content_claim_search already exists" AS Info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Done. Verify with:
--   SELECT COUNT(*) FROM tm4_claim_packages;
--   SHOW COLUMNS FROM claim_evaluation_targets LIKE '%query%';
-- ============================================================================
SELECT 'tm4_claim_package_persistence migration complete' AS Status;
