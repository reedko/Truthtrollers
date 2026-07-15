-- CF1 immutable package persistence. Additive and safe to re-run.
-- TM4 and Workspace claim tables are deliberately untouched.

CREATE TABLE IF NOT EXISTS claim_foundry_runs (
  run_id VARCHAR(48) NOT NULL PRIMARY KEY,
  consumer_key VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  input_hash CHAR(64) NOT NULL,
  options_hash CHAR(64) NOT NULL,
  pipeline_version VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  package_id VARCHAR(48) NULL,
  error_code VARCHAR(100) NULL,
  error_json JSON NULL,
  usage_json JSON NULL,
  artifact_root VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  UNIQUE KEY uq_cf1_run_idempotency (consumer_key, idempotency_key),
  KEY idx_cf1_run_status_created (status, created_at),
  KEY idx_cf1_run_package (package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS claim_foundry_packages (
  package_id VARCHAR(48) NOT NULL PRIMARY KEY,
  lineage_id VARCHAR(48) NOT NULL,
  package_version INT UNSIGNED NOT NULL,
  supersedes_package_id VARCHAR(48) NULL,
  run_id VARCHAR(48) NOT NULL,
  schema_version VARCHAR(64) NOT NULL,
  pipeline_version VARCHAR(32) NOT NULL,
  input_hash CHAR(64) NOT NULL,
  package_hash CHAR(64) NOT NULL,
  package_json JSON NOT NULL,
  selected_claim_count SMALLINT UNSIGNED NOT NULL,
  target_count SMALLINT UNSIGNED NOT NULL,
  card_count SMALLINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL,
  verified_at TIMESTAMP NOT NULL,
  UNIQUE KEY uq_cf1_package_run (run_id),
  UNIQUE KEY uq_cf1_package_lineage_version (lineage_id, package_version),
  UNIQUE KEY uq_cf1_package_hash (package_hash),
  CONSTRAINT fk_cf1_package_run FOREIGN KEY (run_id)
    REFERENCES claim_foundry_runs(run_id),
  CONSTRAINT fk_cf1_package_supersedes FOREIGN KEY (supersedes_package_id)
    REFERENCES claim_foundry_packages(package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS claim_foundry_package_bindings (
  binding_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  package_id VARCHAR(48) NOT NULL,
  consumer_key VARCHAR(64) NOT NULL,
  consumer_content_ref VARCHAR(200) NULL,
  consumer_content_ref_key VARCHAR(200)
    GENERATED ALWAYS AS (COALESCE(consumer_content_ref, '')) STORED,
  content_id INT NULL,
  projection_status VARCHAR(32) NOT NULL DEFAULT 'not_requested',
  projection_error_json JSON NULL,
  projected_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cf1_binding (package_id, consumer_key, consumer_content_ref_key),
  KEY idx_cf1_binding_content_status (content_id, projection_status),
  CONSTRAINT fk_cf1_binding_package FOREIGN KEY (package_id)
    REFERENCES claim_foundry_packages(package_id) ON DELETE CASCADE,
  CONSTRAINT fk_cf1_binding_content FOREIGN KEY (content_id)
    REFERENCES content(content_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS cf1_add_run_package_fk;
DELIMITER $$
CREATE PROCEDURE cf1_add_run_package_fk()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_cf1_run_package'
  ) THEN
    ALTER TABLE claim_foundry_runs ADD CONSTRAINT fk_cf1_run_package
      FOREIGN KEY (package_id) REFERENCES claim_foundry_packages(package_id);
  END IF;
END$$
DELIMITER ;
CALL cf1_add_run_package_fk();
DROP PROCEDURE cf1_add_run_package_fk;

DROP TRIGGER IF EXISTS claim_foundry_packages_immutable;
DELIMITER $$
CREATE TRIGGER claim_foundry_packages_immutable
BEFORE UPDATE ON claim_foundry_packages FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CF1 packages are immutable';
END$$
DELIMITER ;
