-- Canonical SourceCrest sash/alignment store. One table replaces SQL/React
-- reconstruction of GOV, IND, SOC, EDU, and future explicit markers.

CREATE TABLE IF NOT EXISTS source_alignments (
  alignment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  target_type ENUM('publisher','content') NOT NULL,
  target_id INT NOT NULL,
  alignment_scope ENUM('organizational','distribution') NOT NULL,
  alignment_type VARCHAR(64) NOT NULL,
  marker VARCHAR(12) NOT NULL,
  label VARCHAR(120) NOT NULL,
  risk_score DECIMAL(6,2) NULL,
  confidence DECIMAL(5,4) NULL,
  status ENUM('machine_suggested','human_confirmed','community_reviewed','needs_review') NOT NULL DEFAULT 'machine_suggested',
  source_method VARCHAR(80) NOT NULL,
  explanation TEXT NULL,
  evidence_json JSON NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (alignment_id),
  UNIQUE KEY uq_source_alignment (target_type, target_id, alignment_scope, alignment_type),
  KEY idx_source_alignment_target (target_type, target_id, is_primary),
  KEY idx_source_alignment_marker (marker)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill explicit publisher-level industry markers from retained evidence.
INSERT INTO source_alignments
  (target_type, target_id, alignment_scope, alignment_type, marker, label,
   risk_score, confidence, status, source_method, explanation, evidence_json, is_primary)
SELECT 'publisher', pes.publisher_id, 'organizational', 'industry_trade_association',
       'IND', 'Industry aligned', p.conflict_of_interest_score,
       MAX(COALESCE(pes.match_confidence, 0.8)), 'machine_suggested',
       'own_site_org_status', MAX(pes.explanation), JSON_ARRAYAGG(pes.raw_value), 1
  FROM publisher_external_signals pes
  JOIN publishers p ON p.publisher_id = pes.publisher_id
 WHERE pes.provider = 'own_site_org_status'
   AND JSON_SEARCH(pes.flags, 'one', 'material_industry_interest') IS NOT NULL
 GROUP BY pes.publisher_id
ON DUPLICATE KEY UPDATE risk_score = VALUES(risk_score), confidence = VALUES(confidence),
  explanation = VALUES(explanation), evidence_json = VALUES(evidence_json), is_primary = 1;

-- Backfill explicit publisher-level government markers.
INSERT INTO source_alignments
  (target_type, target_id, alignment_scope, alignment_type, marker, label,
   risk_score, confidence, status, source_method, explanation, evidence_json, is_primary)
SELECT 'publisher', pes.publisher_id, 'organizational', 'government_organization',
       'GOV', 'Government source', 0,
       MAX(COALESCE(pes.match_confidence, 0.9)), 'machine_suggested',
       'own_site_org_status', MAX(pes.explanation), JSON_ARRAYAGG(pes.raw_value), 1
  FROM publisher_external_signals pes
 WHERE pes.provider = 'own_site_org_status'
   AND JSON_UNQUOTE(JSON_EXTRACT(pes.raw_value, '$.normalized.publisher_type')) = 'government_organization'
 GROUP BY pes.publisher_id
ON DUPLICATE KEY UPDATE risk_score = VALUES(risk_score), confidence = VALUES(confidence),
  explanation = VALUES(explanation), evidence_json = VALUES(evidence_json), is_primary = 1;

-- Backfill content-level social distribution markers from explicit context.
INSERT INTO source_alignments
  (target_type, target_id, alignment_scope, alignment_type, marker, label,
   risk_score, confidence, status, source_method, explanation, evidence_json, is_primary)
SELECT 'content', cpc.content_id, 'distribution', 'social_distribution',
       'SOC', 'Social / community distribution', NULL,
       CASE cpc.extraction_confidence WHEN 'high' THEN 0.9 WHEN 'medium' THEN 0.7 ELSE 0.5 END,
       'machine_suggested', COALESCE(cpc.extraction_method, 'content_publishing_context'),
       'Content was explicitly persisted with social distribution context.',
       JSON_OBJECT('platform', cpc.platform, 'distribution_channel', cpc.distribution_channel), 1
  FROM content_publishing_context cpc
 WHERE cpc.context_type = 'social'
ON DUPLICATE KEY UPDATE confidence = VALUES(confidence), evidence_json = VALUES(evidence_json), is_primary = 1;

SELECT marker, alignment_type, alignment_scope, COUNT(*) AS records
  FROM source_alignments GROUP BY marker, alignment_type, alignment_scope ORDER BY marker;
