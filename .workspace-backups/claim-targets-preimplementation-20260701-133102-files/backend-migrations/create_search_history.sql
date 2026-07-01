-- Migration: Create search history and analysis tables
-- This stores user searches and AI-generated thematic analysis

-- Table to store search queries and their results
CREATE TABLE IF NOT EXISTS search_history (
  search_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  query TEXT NOT NULL,
  result_count INT DEFAULT 0,
  result_content_ids TEXT, -- JSON array of content_ids returned
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Table to store thematic analysis of search results
CREATE TABLE IF NOT EXISTS search_themes (
  theme_id INT AUTO_INCREMENT PRIMARY KEY,
  search_id INT NOT NULL,
  theme_rank INT NOT NULL, -- 1-5 for top 5 themes
  theme_text TEXT NOT NULL,
  theme_type ENUM('supporting', 'opposing', 'neutral') DEFAULT 'supporting',
  confidence DECIMAL(3,2), -- 0.00 to 1.00
  supporting_claim_ids TEXT, -- JSON array of claim_ids that support this theme
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_search_id (search_id),
  INDEX idx_theme_rank (theme_rank),
  FOREIGN KEY (search_id) REFERENCES search_history(search_id) ON DELETE CASCADE
);
