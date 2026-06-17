CREATE TABLE IF NOT EXISTS verimeter_weighting_config (
  config_key VARCHAR(100) PRIMARY KEY,
  config_value JSON NOT NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (is_active),
  INDEX idx_updated_by (updated_by)
);

INSERT INTO verimeter_weighting_config (config_key, config_value, description, is_active)
VALUES
  (
    'version',
    '1',
    'Verimeter scoring policy version.',
    1
  ),
  (
    'components',
    JSON_OBJECT(
      'source_crest', JSON_OBJECT('enabled', true, 'multiplier', 1.0),
      'reviewer_reputation', JSON_OBJECT('enabled', true, 'multiplier', 0.25),
      'publisher_rating', JSON_OBJECT('enabled', false, 'multiplier', 0.25),
      'author_rating', JSON_OBJECT('enabled', false, 'multiplier', 0.15)
    ),
    'Enabled scoring components and multipliers. Publisher and author ratings start disabled because those ratings may themselves be user-rated and reputation-weighted.',
    1
  ),
  (
    'source_crest',
    JSON_OBJECT(
      'letter', JSON_OBJECT('A', 1.20, 'B', 1.10, 'C', 1.00, 'D', 0.85, 'E', 0.65, 'F', 0.50, 'Ø', 1.00),
      'number', JSON_OBJECT('1', 1.10, '2', 1.05, '3', 1.00, '4', 0.90, '5', 0.80, '6', 0.70, 'Ø', 1.00)
    ),
    'SourceCrest / Admiralty code mappings. Missing or unknown values are neutral.',
    1
  ),
  (
    'missing',
    JSON_OBJECT(
      'source_crest', 1.0,
      'reviewer_reputation', 1.0,
      'publisher_rating', 1.0,
      'author_rating', 1.0
    ),
    'Neutral fallback factors for missing data. No rating should not tank the score.',
    1
  )
ON DUPLICATE KEY UPDATE
  config_value = VALUES(config_value),
  description = VALUES(description),
  is_active = VALUES(is_active),
  updated_at = NOW();
