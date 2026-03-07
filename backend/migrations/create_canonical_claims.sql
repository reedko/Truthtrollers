-- Migration: Create canonical claims and claim variants tables
-- This enables normalization of claim text variants into canonical disputed claims

-- Table to store major disputed claims across topics
CREATE TABLE IF NOT EXISTS canonical_claims (
  canonical_claim_id INT AUTO_INCREMENT PRIMARY KEY,
  claim_text TEXT NOT NULL,
  topic VARCHAR(255),
  controversy_score DECIMAL(3,2) DEFAULT 0.50, -- 0.00 to 1.00, higher = more disputed
  stakes_score DECIMAL(3,2) DEFAULT 0.50, -- 0.00 to 1.00, higher = more important/impactful
  canonical_priority INT DEFAULT 50, -- 1-100, how central this claim is to the topic
  claim_type ENUM('supporting', 'opposing', 'neutral') DEFAULT 'neutral',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_topic (topic),
  INDEX idx_controversy (controversy_score),
  INDEX idx_priority (canonical_priority)
);

-- Table to map actual claims to canonical claims (claim families)
CREATE TABLE IF NOT EXISTS claim_variants (
  variant_id INT AUTO_INCREMENT PRIMARY KEY,
  claim_id INT NOT NULL,
  canonical_claim_id INT NOT NULL,
  similarity_score DECIMAL(3,2) DEFAULT 0.50, -- 0.00 to 1.00, how close the match is
  mapped_by ENUM('ai', 'manual', 'auto') DEFAULT 'auto',
  mapped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_claim_id (claim_id),
  INDEX idx_canonical_claim_id (canonical_claim_id),
  FOREIGN KEY (claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE,
  FOREIGN KEY (canonical_claim_id) REFERENCES canonical_claims(canonical_claim_id) ON DELETE CASCADE,
  UNIQUE KEY unique_claim_mapping (claim_id, canonical_claim_id)
);
