-- Create claim_scores table if it doesn't exist
-- This table stores verimeter scores for individual claims (not content-level scores)

CREATE TABLE IF NOT EXISTS claim_scores (
  claim_score_id INT AUTO_INCREMENT PRIMARY KEY,
  claim_id INT NOT NULL,
  content_id INT NOT NULL,
  user_id INT NULL, -- NULL for aggregate scores, specific user_id for per-user scores
  verimeter_score DECIMAL(5,4) NULL, -- Range: -1.0000 to 1.0000
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_claim_user (claim_id, content_id, user_id),
  KEY idx_content_user (content_id, user_id),
  KEY idx_claim (claim_id),

  FOREIGN KEY (claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
