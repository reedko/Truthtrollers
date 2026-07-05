-- Run manually after reviewing. Additive only: no legacy columns or links are removed.
START TRANSACTION;

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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (evaluation_target_id),
  UNIQUE KEY uq_claim_evaluation_target_order (content_id, claim_id, target_order),
  KEY idx_evaluation_target_claim (claim_id, content_id),
  KEY idx_evaluation_target_type_status (target_type, resolution_status),
  KEY idx_evaluation_target_parent (parent_target_id),
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
  UNIQUE KEY uq_target_reference_claim (evaluation_target_id, reference_content_id, reference_claim_id),
  KEY idx_target_evidence_reference (reference_content_id, reference_claim_id),
  CONSTRAINT fk_target_evidence_target FOREIGN KEY (evaluation_target_id)
    REFERENCES claim_evaluation_targets (evaluation_target_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO claim_evaluation_targets
  (content_id, claim_id, target_type, target_text, object_text, article_stance,
   score_transform, search_eligible, verdict_eligible, resolution_status,
   target_order, mapping_confidence, mapping_rationale)
SELECT cc.content_id, cc.claim_id, 'substantive', cc.object_claim_text,
       cc.object_claim_text, COALESCE(cc.article_stance, 'unclear'),
       COALESCE(cc.score_transform, 'review'),
       CASE WHEN COALESCE(cc.score_transform, 'review') = 'none' THEN 0 ELSE 1 END,
       CASE WHEN COALESCE(cc.score_transform, 'review') = 'none' THEN 0 ELSE 1 END,
       'mapped', 0, cc.argument_mapping_confidence, cc.argument_mapping_rationale
FROM content_claims cc
WHERE NULLIF(TRIM(cc.object_claim_text), '') IS NOT NULL
ON DUPLICATE KEY UPDATE
  target_text = VALUES(target_text),
  object_text = VALUES(object_text),
  article_stance = VALUES(article_stance),
  score_transform = VALUES(score_transform),
  mapping_confidence = VALUES(mapping_confidence),
  mapping_rationale = VALUES(mapping_rationale),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO evidence_search_config (config_key, config_value, description, updated_at)
VALUES (
  'search_gateway_config',
  '{"enabled":true,"mode":"single","provider":"tavily","providers":["tavily","brave","serper"],"fallbacks":["brave","serper","tavily"],"retrievalStrategy":"best_bearing_pool","minHighBearingClaimsPerTarget":5,"maxResultsPerQuery":10,"providerBudgetPerTargetUsd":0.05,"maxProvidersPerTarget":7,"maxSourcesToScrapePerTarget":10,"captureProviderMetadata":true,"metadataInSnippetFallback":false,"providerEnabled":{"tavily":true,"brave":false,"serper":false,"bing":false}}',
  'Provider-neutral evidence retrieval gateway configuration',
  NOW()
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

COMMIT;
