-- CF6 Milestone 2: additive persisted agent state, append-only tool events, immutable final packages.
CREATE TABLE IF NOT EXISTS cf6_claim_foundry_run_states (
  run_id VARCHAR(96) NOT NULL PRIMARY KEY,
  content_id VARCHAR(96) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  source_unit_manifest_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  state_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  next_event_sequence BIGINT UNSIGNED NOT NULL DEFAULT 1,
  state_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cf6_run_status_updated (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cf6_claim_foundry_tool_events (
  event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(96) NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL,
  tool_name VARCHAR(64) NOT NULL,
  tool_schema_version VARCHAR(64) NOT NULL,
  arguments_hash CHAR(64) NOT NULL,
  result_hash CHAR(64) NULL,
  result_json JSON NULL,
  before_state_hash CHAR(64) NOT NULL,
  after_state_hash CHAR(64) NOT NULL,
  duration_ms INT UNSIGNED NOT NULL,
  event_status VARCHAR(16) NOT NULL,
  error_json JSON NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cf6_event_sequence (run_id, sequence),
  UNIQUE KEY uq_cf6_event_idempotency (run_id, tool_name, idempotency_key),
  CONSTRAINT fk_cf6_event_run FOREIGN KEY (run_id)
    REFERENCES cf6_claim_foundry_run_states(run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cf6_claim_foundry_final_packages (
  package_id VARCHAR(96) NOT NULL PRIMARY KEY,
  run_id VARCHAR(96) NOT NULL,
  package_hash CHAR(64) NOT NULL,
  package_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cf6_final_run (run_id),
  UNIQUE KEY uq_cf6_final_hash (package_hash),
  CONSTRAINT fk_cf6_final_run FOREIGN KEY (run_id)
    REFERENCES cf6_claim_foundry_run_states(run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cf6_claim_foundry_model_requests (
  request_row_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(96) NOT NULL,
  model_turn INT UNSIGNED NOT NULL,
  response_id VARCHAR(128) NULL,
  request_id VARCHAR(128) NULL,
  input_tokens INT UNSIGNED NOT NULL,
  cached_input_tokens INT UNSIGNED NOT NULL,
  uncached_input_tokens INT UNSIGNED NOT NULL,
  output_tokens INT UNSIGNED NOT NULL,
  total_tokens INT UNSIGNED NOT NULL,
  model VARCHAR(128) NOT NULL,
  tools_exposed_json JSON NOT NULL,
  tool_selected VARCHAR(64) NULL,
  model_visible_input_hash CHAR(64) NOT NULL,
  estimated_input_tokens INT UNSIGNED NOT NULL,
  payload_class_tokens_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL,
  UNIQUE KEY uq_cf6_model_request_turn (run_id, model_turn),
  UNIQUE KEY uq_cf6_model_response_id (response_id),
  CONSTRAINT fk_cf6_model_request_run FOREIGN KEY (run_id)
    REFERENCES cf6_claim_foundry_run_states(run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TRIGGER IF EXISTS cf6_tool_events_no_update;
DROP TRIGGER IF EXISTS cf6_tool_events_no_delete;
DROP TRIGGER IF EXISTS cf6_final_packages_immutable;
DROP TRIGGER IF EXISTS cf6_final_packages_no_delete;
DROP TRIGGER IF EXISTS cf6_model_requests_no_update;
DROP TRIGGER IF EXISTS cf6_model_requests_no_delete;
DELIMITER $$
CREATE TRIGGER cf6_tool_events_no_update BEFORE UPDATE ON cf6_claim_foundry_tool_events
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CF6 tool events are append-only'; END$$
CREATE TRIGGER cf6_tool_events_no_delete BEFORE DELETE ON cf6_claim_foundry_tool_events
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CF6 tool events are append-only'; END$$
CREATE TRIGGER cf6_final_packages_immutable BEFORE UPDATE ON cf6_claim_foundry_final_packages
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CF6 final packages are immutable'; END$$
CREATE TRIGGER cf6_final_packages_no_delete BEFORE DELETE ON cf6_claim_foundry_final_packages
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CF6 final packages are immutable'; END$$
CREATE TRIGGER cf6_model_requests_no_update BEFORE UPDATE ON cf6_claim_foundry_model_requests
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CF6 model requests are append-only'; END$$
CREATE TRIGGER cf6_model_requests_no_delete BEFORE DELETE ON cf6_claim_foundry_model_requests
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CF6 model requests are append-only'; END$$
DELIMITER ;
