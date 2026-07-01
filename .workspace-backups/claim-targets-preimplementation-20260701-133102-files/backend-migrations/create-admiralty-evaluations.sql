-- backend/migrations/create-admiralty-evaluations.sql
-- Admiralty-style source/evidence evaluation table.
-- A-F = source reliability letter  |  1-6 = claim credibility number

CREATE TABLE IF NOT EXISTS admiralty_evaluations (
  admiralty_evaluation_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- What is being evaluated
  target_type ENUM(
    'publisher','content','source','claim','claim_link','source_claim'
  ) NOT NULL,
  target_id      INT UNSIGNED NOT NULL,
  source_url     VARCHAR(2048),
  publisher_id   INT UNSIGNED,

  -- The Admiralty code
  source_reliability_letter CHAR(1),           -- A-F
  claim_credibility_number  TINYINT UNSIGNED,  -- 1-6
  admiralty_code            VARCHAR(3),        -- e.g. "D4"

  -- Confidence and status
  confidence         ENUM('high','medium','low')                                            DEFAULT 'low',
  evaluation_status  ENUM(
    'machine_suggested','human_confirmed','community_reviewed','needs_review','insufficient_data'
  )                                                                                          DEFAULT 'machine_suggested',

  -- Rationale text
  source_reliability_rationale TEXT,
  claim_credibility_rationale  TEXT,

  -- Structured signals stored as JSON
  source_signals_json     JSON,
  claim_signals_json      JSON,
  warnings_json           JSON,
  recommended_actions_json JSON,

  -- Audit
  created_by  ENUM('system','user','admin') DEFAULT 'system',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  reviewed_by_user_id INT UNSIGNED,
  reviewed_at TIMESTAMP NULL,

  INDEX idx_target   (target_type, target_id),
  INDEX idx_publisher(publisher_id),
  INDEX idx_status   (evaluation_status),
  INDEX idx_code     (admiralty_code)
);
