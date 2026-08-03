-- CFX Phase 2: exact document aggregation and one acquisition per run/document.
-- Apply after 2026-07-31-01-cfx-evidence-scrape-bindings.sql.
-- This migration adds identity, discovery, and immutable-version lineage only.
-- It does not add semantic extraction or evidence-bearing state.

CREATE TABLE IF NOT EXISTS cfx_canonical_documents (
  canonical_document_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id VARCHAR(191) NOT NULL,
  document_key VARCHAR(64) NOT NULL,
  canonical_identity_kind ENUM('pmid','doi','canonical_url','resolved_url') NOT NULL,
  canonical_identity_value TEXT NOT NULL,
  canonical_identity_sha256 CHAR(64) NOT NULL,
  pmid VARCHAR(32) NULL,
  doi VARCHAR(255) NULL,
  canonical_url TEXT NULL,
  normalized_resolved_url TEXT NULL,
  representative_candidate_id VARCHAR(191) NOT NULL,
  reference_content_id INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (canonical_document_id),
  UNIQUE KEY uq_cfx_document_run_identity (run_id, canonical_identity_sha256),
  UNIQUE KEY uq_cfx_document_run_key (run_id, document_key),
  KEY idx_cfx_document_reference (reference_content_id),
  CONSTRAINT fk_cfx_document_reference FOREIGN KEY (reference_content_id)
    REFERENCES content (content_id) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfx_canonical_document_identities (
  canonical_document_identity_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_document_id BIGINT UNSIGNED NOT NULL,
  run_id VARCHAR(191) NOT NULL,
  identity_kind ENUM('pmid','doi','canonical_url','resolved_url') NOT NULL,
  identity_value TEXT NOT NULL,
  identity_sha256 CHAR(64) NOT NULL,
  identity_match_sha256 CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (canonical_document_identity_id),
  UNIQUE KEY uq_cfx_document_exact_alias (run_id, identity_match_sha256),
  KEY idx_cfx_document_alias_parent (canonical_document_id),
  CONSTRAINT fk_cfx_document_alias_parent FOREIGN KEY (canonical_document_id)
    REFERENCES cfx_canonical_documents (canonical_document_id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cfx_document_discovery_assignments (
  discovery_assignment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  canonical_document_id BIGINT UNSIGNED NOT NULL,
  run_id VARCHAR(191) NOT NULL,
  proposition_id VARCHAR(191) NOT NULL,
  target_claim_id INT NOT NULL,
  candidate_id VARCHAR(191) NOT NULL,
  query_id VARCHAR(16) NOT NULL,
  query_intent ENUM(
    'canonical','entity_predicate','source_identity','independent_evidence',
    'counterevidence','qualification'
  ) NOT NULL,
  query_text TEXT NOT NULL,
  provider VARCHAR(80) NOT NULL,
  retrieval_rank INT UNSIGNED NULL,
  provider_request_id VARCHAR(191) NOT NULL,
  assignment_sha256 CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (discovery_assignment_id),
  UNIQUE KEY uq_cfx_discovery_assignment (run_id, assignment_sha256),
  KEY idx_cfx_discovery_document (canonical_document_id),
  KEY idx_cfx_discovery_target (target_claim_id),
  KEY idx_cfx_discovery_intent (query_intent),
  CONSTRAINT fk_cfx_discovery_document FOREIGN KEY (canonical_document_id)
    REFERENCES cfx_canonical_documents (canonical_document_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_cfx_discovery_target FOREIGN KEY (target_claim_id)
    REFERENCES claims (claim_id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE cfx_evidence_acquisition_bindings
  ADD COLUMN canonical_document_id BIGINT UNSIGNED NULL AFTER binding_id,
  ADD UNIQUE KEY uq_cfx_one_acquisition_per_document
    (run_id, canonical_document_id),
  ADD KEY idx_cfx_acq_canonical_document (canonical_document_id),
  ADD CONSTRAINT fk_cfx_acq_canonical_document
    FOREIGN KEY (canonical_document_id)
    REFERENCES cfx_canonical_documents (canonical_document_id)
    ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE cfx_evidence_text_versions
  ADD COLUMN supersedes_text_version_id BIGINT UNSIGNED NULL
    AFTER acquired_text_version_id,
  ADD KEY idx_cfx_text_supersedes (supersedes_text_version_id),
  ADD CONSTRAINT fk_cfx_text_supersedes
    FOREIGN KEY (supersedes_text_version_id)
    REFERENCES cfx_evidence_text_versions (acquired_text_version_id)
    ON DELETE SET NULL ON UPDATE RESTRICT;
