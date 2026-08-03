-- CFX production-schema reconciliation migration
-- Date: 2026-07-31
-- Status: VERIFIED FOR PRODUCTION after disposable real-MySQL apply/reapply/rollback.
--
-- Verified parent types:
--   scrape_jobs.scrape_job_id                         BIGINT (signed)
--   content.content_id                               INT (signed)
--   claims.claim_id                                  INT (signed)
--   claim_sources.claim_source_id                    INT (signed)
--   reference_claim_task_links.reference_claim_task_links_id INT (signed)
--
-- This migration creates correlation, forensic, and run-provenance records only.
-- It does not duplicate claims, content, claim provenance, AI suggestion links,
-- user-finalized links, or immutable final audits.

CREATE TABLE IF NOT EXISTS cfx_evidence_acquisition_bindings (
  binding_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scrape_job_id BIGINT NULL,
  task_content_id INT NOT NULL,
  target_claim_id INT NOT NULL,
  reference_content_id INT NULL,
  run_id VARCHAR(191) NOT NULL,
  proposition_id VARCHAR(191) NOT NULL,
  candidate_id VARCHAR(191) NOT NULL,
  acquisition_artifact_id VARCHAR(191) NOT NULL,
  s2_artifact_path VARCHAR(512) NOT NULL,
  s2_artifact_sha256 CHAR(64) NOT NULL,
  grounding_unit_ids_json JSON NOT NULL,
  requested_url TEXT NOT NULL,
  opened_tab_id BIGINT NULL,
  extension_instance_id VARCHAR(191) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (binding_id),
  UNIQUE KEY uq_cfx_acq_scrape_job (scrape_job_id),
  UNIQUE KEY uq_cfx_acq_artifact (acquisition_artifact_id),
  UNIQUE KEY uq_cfx_acq_candidate (run_id, proposition_id, candidate_id),
  KEY idx_cfx_acq_task_claim (task_content_id, target_claim_id),
  KEY idx_cfx_acq_reference (reference_content_id),
  CONSTRAINT fk_cfx_acq_scrape_job FOREIGN KEY (scrape_job_id)
    REFERENCES scrape_jobs (scrape_job_id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_acq_task_content FOREIGN KEY (task_content_id)
    REFERENCES content (content_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_acq_target_claim FOREIGN KEY (target_claim_id)
    REFERENCES claims (claim_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_acq_reference_content FOREIGN KEY (reference_content_id)
    REFERENCES content (content_id) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfx_evidence_acquisition_attempts (
  acquisition_attempt_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  binding_id BIGINT UNSIGNED NOT NULL,
  attempt_ordinal SMALLINT UNSIGNED NOT NULL,
  acquisition_lane ENUM(
    'structured_api', 'direct_http', 'production_scrape', 'archive',
    'user_assisted', 'snippet', 'metadata'
  ) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  request_url TEXT NOT NULL,
  resolved_url TEXT NULL,
  outcome ENUM(
    'acquired', 'blocked', 'failed', 'unavailable',
    'snippet_only', 'metadata_only'
  ) NOT NULL,
  http_status SMALLINT UNSIGNED NULL,
  provider_request_id VARCHAR(191) NULL,
  error_code VARCHAR(128) NULL,
  error_message TEXT NULL,
  raw_response LONGTEXT NULL,
  raw_response_sha256 CHAR(64) NULL,
  response_metadata_json JSON NULL,
  started_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (acquisition_attempt_id),
  UNIQUE KEY uq_cfx_acq_attempt_order (binding_id, attempt_ordinal),
  KEY idx_cfx_acq_attempt_outcome (outcome, completed_at),
  CONSTRAINT fk_cfx_acq_attempt_binding FOREIGN KEY (binding_id)
    REFERENCES cfx_evidence_acquisition_bindings (binding_id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfx_evidence_text_versions (
  acquired_text_version_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  binding_id BIGINT UNSIGNED NOT NULL,
  acquisition_attempt_id BIGINT UNSIGNED NULL,
  reference_content_id INT NOT NULL,
  access_level ENUM('full_text', 'substantial_excerpt', 'abstract', 'snippet', 'metadata_only') NOT NULL,
  extraction_method VARCHAR(80) NOT NULL,
  source_url TEXT NOT NULL,
  resolved_url TEXT NULL,
  redirect_chain_json JSON NULL,
  cleaned_text LONGTEXT NOT NULL,
  cleaned_text_sha256 CHAR(64) NOT NULL,
  character_count INT UNSIGNED NOT NULL,
  word_count INT UNSIGNED NOT NULL,
  selected_for_bearing TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (acquired_text_version_id),
  UNIQUE KEY uq_cfx_text_version_hash
    (binding_id, reference_content_id, access_level, cleaned_text_sha256),
  KEY idx_cfx_text_selected (binding_id, selected_for_bearing),
  KEY idx_cfx_text_reference (reference_content_id),
  KEY idx_cfx_text_attempt (acquisition_attempt_id),
  CONSTRAINT fk_cfx_text_binding FOREIGN KEY (binding_id)
    REFERENCES cfx_evidence_acquisition_bindings (binding_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_text_attempt FOREIGN KEY (acquisition_attempt_id)
    REFERENCES cfx_evidence_acquisition_attempts (acquisition_attempt_id)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_text_content FOREIGN KEY (reference_content_id)
    REFERENCES content (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfx_targeted_bearing_runs (
  targeted_bearing_run_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  binding_id BIGINT UNSIGNED NOT NULL,
  acquired_text_version_id BIGINT UNSIGNED NOT NULL,
  target_claim_id INT NOT NULL,
  run_id VARCHAR(191) NOT NULL,
  prompt_sha256 CHAR(64) NOT NULL,
  schema_sha256 CHAR(64) NOT NULL,
  model VARCHAR(128) NOT NULL,
  exact_request_json JSON NOT NULL,
  raw_response_json JSON NULL,
  parsed_response_json JSON NULL,
  provider_response_id VARCHAR(191) NULL,
  validation_status ENUM('accepted', 'rejected', 'provider_failed') NOT NULL,
  validation_diagnostics_json JSON NOT NULL,
  input_tokens INT UNSIGNED NULL,
  output_tokens INT UNSIGNED NULL,
  latency_ms INT UNSIGNED NULL,
  started_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (targeted_bearing_run_id),
  UNIQUE KEY uq_cfx_bearing_run (run_id),
  KEY idx_cfx_bearing_binding (binding_id),
  KEY idx_cfx_bearing_text (acquired_text_version_id),
  KEY idx_cfx_bearing_target (target_claim_id),
  CONSTRAINT fk_cfx_bearing_binding FOREIGN KEY (binding_id)
    REFERENCES cfx_evidence_acquisition_bindings (binding_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_bearing_text FOREIGN KEY (acquired_text_version_id)
    REFERENCES cfx_evidence_text_versions (acquired_text_version_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_bearing_target FOREIGN KEY (target_claim_id)
    REFERENCES claims (claim_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS reference_claim_task_link_provenance (
  reference_claim_task_link_provenance_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference_claim_task_links_id INT NOT NULL,
  targeted_bearing_run_id BIGINT UNSIGNED NOT NULL,
  acquired_text_version_id BIGINT UNSIGNED NOT NULL,
  claim_source_id INT NOT NULL,
  validation_status ENUM('accepted', 'rejected') NOT NULL,
  access_level ENUM('full_text', 'substantial_excerpt', 'abstract', 'snippet', 'metadata_only') NOT NULL,
  excerpt_start INT UNSIGNED NULL,
  excerpt_end INT UNSIGNED NULL,
  excerpt_locator_json JSON NULL,
  quote_sha256 CHAR(64) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (reference_claim_task_link_provenance_id),
  UNIQUE KEY uq_rctl_provenance_run
    (reference_claim_task_links_id, targeted_bearing_run_id),
  KEY idx_rctl_provenance_text (acquired_text_version_id),
  KEY idx_rctl_provenance_source (claim_source_id),
  CONSTRAINT fk_rctl_provenance_link FOREIGN KEY (reference_claim_task_links_id)
    REFERENCES reference_claim_task_links (reference_claim_task_links_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_rctl_provenance_run FOREIGN KEY (targeted_bearing_run_id)
    REFERENCES cfx_targeted_bearing_runs (targeted_bearing_run_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_rctl_provenance_text FOREIGN KEY (acquired_text_version_id)
    REFERENCES cfx_evidence_text_versions (acquired_text_version_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_rctl_provenance_source FOREIGN KEY (claim_source_id)
    REFERENCES claim_sources (claim_source_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfx_evidence_terminal_outbox (
  outbox_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  binding_id BIGINT UNSIGNED NOT NULL,
  scrape_job_id BIGINT NOT NULL,
  terminal_status ENUM('completed', 'failed', 'expired') NOT NULL,
  result_content_id INT NULL,
  error_message TEXT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  processing_started_at DATETIME(6) NULL,
  processing_token VARCHAR(64) NULL,
  consumed_at DATETIME(6) NULL,
  consumer_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_consumer_error TEXT NULL,
  PRIMARY KEY (outbox_id),
  UNIQUE KEY uq_cfx_terminal_job (scrape_job_id),
  KEY idx_cfx_terminal_unconsumed (consumed_at, processing_started_at, created_at),
  KEY idx_cfx_terminal_binding (binding_id),
  KEY idx_cfx_terminal_result (result_content_id),
  CONSTRAINT fk_cfx_terminal_binding FOREIGN KEY (binding_id)
    REFERENCES cfx_evidence_acquisition_bindings (binding_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_terminal_scrape_job FOREIGN KEY (scrape_job_id)
    REFERENCES scrape_jobs (scrape_job_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_terminal_content FOREIGN KEY (result_content_id)
    REFERENCES content (content_id)
    ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
