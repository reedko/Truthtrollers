-- CFX Phase 3: one governed primary semantic execution per immutable identity.
-- Requires 2026-07-31-01 and 2026-08-01-01.

CREATE TABLE IF NOT EXISTS cfx_document_semantic_executions (
  document_semantic_execution_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id VARCHAR(191) NOT NULL,
  canonical_document_id BIGINT UNSIGNED NOT NULL,
  selected_text_version_id BIGINT UNSIGNED NOT NULL,
  target_inventory_sha256 CHAR(64) NOT NULL,
  prompt_sha256 CHAR(64) NOT NULL,
  schema_sha256 CHAR(64) NOT NULL,
  execution_status ENUM('claimed','accepted','rejected','provider_failed') NOT NULL,
  processing_token CHAR(36) NULL,
  processing_started_at DATETIME(6) NULL,
  attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  accepted_targeted_bearing_run_id BIGINT UNSIGNED NULL,
  last_error TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (document_semantic_execution_id),
  UNIQUE KEY uq_cfx_document_semantic_identity
    (run_id,canonical_document_id,selected_text_version_id,
     target_inventory_sha256,prompt_sha256,schema_sha256),
  KEY idx_cfx_document_semantic_status (execution_status,processing_started_at),
  KEY idx_cfx_document_semantic_text (selected_text_version_id),
  KEY idx_cfx_document_semantic_accepted_run (accepted_targeted_bearing_run_id),
  CONSTRAINT fk_cfx_document_semantic_document
    FOREIGN KEY (canonical_document_id)
    REFERENCES cfx_canonical_documents (canonical_document_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_document_semantic_text
    FOREIGN KEY (selected_text_version_id)
    REFERENCES cfx_evidence_text_versions (acquired_text_version_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_document_semantic_accepted_run
    FOREIGN KEY (accepted_targeted_bearing_run_id)
    REFERENCES cfx_targeted_bearing_runs (targeted_bearing_run_id)
    ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
