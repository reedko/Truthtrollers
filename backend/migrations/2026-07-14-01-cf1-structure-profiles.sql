-- Inert CF1 StructureProfile version storage. No activation or live-path wiring.

CREATE TABLE IF NOT EXISTS cf1_structure_profiles (
  profile_id VARCHAR(64) NOT NULL PRIMARY KEY,
  profile_key VARCHAR(96) NOT NULL,
  profile_version INT UNSIGNED NOT NULL,
  schema_version VARCHAR(64) NOT NULL,
  source_family VARCHAR(96) NOT NULL,
  scope_json JSON NOT NULL,
  rules_json JSON NOT NULL,
  profile_hash CHAR(64) NOT NULL,
  review_status VARCHAR(24) NOT NULL DEFAULT 'draft',
  supersedes_profile_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  retired_at TIMESTAMP NULL,
  UNIQUE KEY uq_cf1_structure_profile_version (profile_key, profile_version),
  UNIQUE KEY uq_cf1_structure_profile_hash (profile_hash),
  KEY idx_cf1_structure_profile_family_status (source_family, review_status),
  CONSTRAINT fk_cf1_structure_profile_supersedes FOREIGN KEY (supersedes_profile_id)
    REFERENCES cf1_structure_profiles(profile_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
