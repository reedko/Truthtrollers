-- Create user_claim_visibility table for per-user claim hiding
-- Mirrors the pattern used in user_reference_visibility

CREATE TABLE IF NOT EXISTS user_claim_visibility (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  claim_id INT NOT NULL,
  is_hidden BOOLEAN DEFAULT FALSE,
  hidden_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_claim (user_id, claim_id),
  INDEX idx_user_id (user_id),
  INDEX idx_claim_id (claim_id),
  INDEX idx_is_hidden (is_hidden),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
