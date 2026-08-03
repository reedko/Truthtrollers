-- CFX source-assertion occurrence provenance and AI-suggestion audit.
--
-- `claims`, `claim_sources`, and `reference_claim_task_links` remain the
-- authoritative production records. This table preserves the extraction
-- occurrence identity and makes an AI suggestion distinguishable from a
-- human-verified/final link without introducing a parallel claim/link model.

CREATE TABLE IF NOT EXISTS cfx_source_assertion_provenance (
  source_assertion_id VARCHAR(32) NOT NULL,
  claim_id INT NOT NULL,
  claim_source_id INT NOT NULL,
  case_assertion_id VARCHAR(32) NOT NULL,
  task_claim_id INT NOT NULL,
  source_document_id VARCHAR(64) NOT NULL,
  reference_content_id INT NOT NULL,
  exact_excerpt LONGTEXT NOT NULL,
  excerpt_start INT UNSIGNED NOT NULL,
  excerpt_end INT UNSIGNED NOT NULL,
  source_block_ids_json JSON NOT NULL,
  source_packet_ids_json JSON NOT NULL,
  extraction_run_id VARCHAR(191) NOT NULL,
  extraction_model_call_id VARCHAR(64) NOT NULL,
  extraction_prompt_sha256 CHAR(64) NOT NULL,
  extraction_schema_sha256 CHAR(64) NOT NULL,
  reference_claim_task_links_id INT NULL,
  suggestion_run_id VARCHAR(191) NULL,
  suggestion_model_call_id VARCHAR(64) NULL,
  suggestion_prompt_sha256 CHAR(64) NULL,
  suggestion_schema_sha256 CHAR(64) NULL,
  suggestion_model VARCHAR(128) NULL,
  suggested_stance ENUM('support','refute','nuance','insufficient') NULL,
  suggested_score DECIMAL(4,3) NULL,
  suggestion_rationale TEXT NULL,
  suggestion_status ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (source_assertion_id),
  KEY idx_cfx_sa_claim (claim_id),
  KEY idx_cfx_sa_claim_source (claim_source_id),
  KEY idx_cfx_sa_task (task_claim_id),
  KEY idx_cfx_sa_reference (reference_content_id),
  KEY idx_cfx_sa_link (reference_claim_task_links_id),
  KEY idx_cfx_sa_suggestion_run (suggestion_run_id, suggestion_status),
  CONSTRAINT chk_cfx_sa_offsets CHECK (excerpt_end >= excerpt_start),
  CONSTRAINT chk_cfx_sa_suggested_score CHECK (
    suggested_score IS NULL OR (suggested_score >= 0 AND suggested_score <= 1)
  ),
  CONSTRAINT fk_cfx_sa_claim FOREIGN KEY (claim_id)
    REFERENCES claims (claim_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_sa_claim_source FOREIGN KEY (claim_source_id)
    REFERENCES claim_sources (claim_source_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_sa_task FOREIGN KEY (task_claim_id)
    REFERENCES claims (claim_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_sa_reference FOREIGN KEY (reference_content_id)
    REFERENCES content (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_sa_link FOREIGN KEY (reference_claim_task_links_id)
    REFERENCES reference_claim_task_links (reference_claim_task_links_id)
    ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
