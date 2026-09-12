-- Additive, feature-flagged Layer 3 seam. This does not alter the evidence pipeline.

CREATE TABLE IF NOT EXISTS provenance_trace_support (
  trace_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  trace_run_id CHAR(36) NOT NULL,
  root_content_id INT NOT NULL,
  parent_reference_content_id INT NOT NULL,
  evidence_claim_id INT NOT NULL,
  supporting_reference_content_id INT NULL,
  source_ordinal SMALLINT NOT NULL DEFAULT 1,
  depth TINYINT NOT NULL DEFAULT 1,
  resolution_status VARCHAR(32) NOT NULL,
  source_label VARCHAR(1000) NULL,
  source_url VARCHAR(2048) NULL,
  doi VARCHAR(255) NULL,
  pmid VARCHAR(32) NULL,
  citation_text TEXT NULL,
  locator_json JSON NULL,
  explanation TEXT NULL,
  publication_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  status_source VARCHAR(64) NULL,
  context_fingerprint CHAR(64) NOT NULL,
  created_by_user_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pts_root_content FOREIGN KEY (root_content_id)
    REFERENCES content(content_id) ON DELETE CASCADE,
  CONSTRAINT fk_pts_parent_content FOREIGN KEY (parent_reference_content_id)
    REFERENCES content(content_id) ON DELETE CASCADE,
  CONSTRAINT fk_pts_evidence_claim FOREIGN KEY (evidence_claim_id)
    REFERENCES claims(claim_id) ON DELETE CASCADE,
  CONSTRAINT fk_pts_supporting_content FOREIGN KEY (supporting_reference_content_id)
    REFERENCES content(content_id) ON DELETE SET NULL,
  UNIQUE KEY uq_pts_run_ordinal (trace_run_id, source_ordinal),
  INDEX idx_pts_subject (root_content_id, parent_reference_content_id, evidence_claim_id),
  INDEX idx_pts_parent (parent_reference_content_id),
  INDEX idx_pts_evidence_claim (evidence_claim_id),
  INDEX idx_pts_supporting_content (supporting_reference_content_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS apply_20260909_trace_support_prompt;
DELIMITER $$
CREATE PROCEDURE apply_20260909_trace_support_prompt()
BEGIN
  DECLARE collision_count INT DEFAULT 0;
  SELECT COUNT(*) INTO collision_count
    FROM llm_prompts
   WHERE prompt_id = 447
     AND prompt_name <> 'evidence_assertion_trace_support_user';
  IF collision_count <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Trace Support prompt_id 447 collision';
  END IF;

  UPDATE llm_prompts SET is_active = 0
   WHERE prompt_name = 'evidence_assertion_trace_support_user';

  INSERT INTO llm_prompts (
    prompt_id, prompt_name, prompt_type, prompt_text, parameters,
    version, is_active, max_claims, min_sources, max_sources
  ) VALUES (
    447,
    'evidence_assertion_trace_support_user',
    'user',
    'Based on the document context, what source or sources does this document rely on as evidence for the assertion below?\n\nIdentify them and briefly explain the link. Treat direct PDF links in assertion-relevant citation text as source candidates even when the link does not expose a DOI or journal landing page. Do not assume that a hosted PDF is the canonical scholarly record. If the context does not show one, say so.\n\nASSERTION:\n{{assertion}}\n\nDOCUMENT CONTEXT:\n{{documentContext}}',
    '{}', 2, 1, 6, 0, 6
  ) ON DUPLICATE KEY UPDATE
    prompt_name = VALUES(prompt_name), prompt_type = VALUES(prompt_type),
    prompt_text = VALUES(prompt_text), parameters = VALUES(parameters),
    version = VALUES(version), is_active = VALUES(is_active),
    max_claims = VALUES(max_claims), min_sources = VALUES(min_sources),
    max_sources = VALUES(max_sources);
END$$
DELIMITER ;
CALL apply_20260909_trace_support_prompt();
DROP PROCEDURE IF EXISTS apply_20260909_trace_support_prompt;
