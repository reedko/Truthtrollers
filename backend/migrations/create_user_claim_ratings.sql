-- Migration: Create user_claim_ratings table
-- Tracks user assessments of reference claim quality (for honesty scoring)

CREATE TABLE IF NOT EXISTS user_claim_ratings (
  user_claim_rating_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  reference_claim_id INT NOT NULL,
  task_claim_id INT NOT NULL,

  -- User's assessment of evidence quality
  user_quality_rating INT NOT NULL,  -- 0-120 (user's honest assessment)

  -- AI's assessment (for comparison)
  ai_quality_rating INT,  -- 0-120 (from reference_claim_task_links)
  ai_stance ENUM('support', 'refute', 'nuance', 'insufficient'),

  -- Scoring
  honesty_score INT,  -- How close user rating was to AI (100 - abs(user - ai))

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (reference_claim_id) REFERENCES claims(claim_id),
  FOREIGN KEY (task_claim_id) REFERENCES claims(claim_id),

  INDEX idx_user (user_id),
  INDEX idx_task_claim (task_claim_id),
  UNIQUE KEY unique_user_claim_pair (user_id, reference_claim_id, task_claim_id)
);
