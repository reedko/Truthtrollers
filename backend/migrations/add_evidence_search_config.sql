-- ============================================================================
-- EVIDENCE SEARCH CONFIGURATION
-- Switchable search modes for balanced evidence discovery
-- ============================================================================

CREATE TABLE IF NOT EXISTS evidence_search_config (
  config_id INT AUTO_INCREMENT PRIMARY KEY,
  config_key VARCHAR(50) NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT DEFAULT NULL,
  FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default configuration (only insert if not exists, don't overwrite existing values)
INSERT INTO evidence_search_config (config_key, config_value, description) VALUES
(
  'search_mode',
  'fringe_on_support',
  'Evidence search strategy: high_quality_only | fringe_on_support | balanced_all_claims'
),
(
  'mode_config',
  '{"high_quality_only":{"description":"Search only high-quality sources (Tavily + Bing)","queriesPerClaim":6,"maxEvidenceCandidates":4,"enableFringeSearch":false},"fringe_on_support":{"description":"High-quality sources + fringe sources when strong support found","queriesPerClaim":6,"maxEvidenceCandidates":4,"enableFringeSearch":true,"fringeTrigger":"support","fringeConfidenceThreshold":0.7,"topKFringeQueries":3,"topKFringeCandidates":3,"maxFringeEvidenceCandidates":2},"balanced_all_claims":{"description":"For every claim: 2-3 support, 2-3 refute, 2-3 nuance sources","queriesPerClaim":9,"supportQueries":3,"refuteQueries":3,"nuanceQueries":3,"maxEvidenceCandidates":9,"targetSupport":3,"targetRefute":3,"targetNuance":3,"enableBalancedSearch":true}}',
  'Configuration parameters for each search mode'
)
ON DUPLICATE KEY UPDATE
  config_key = config_key;
