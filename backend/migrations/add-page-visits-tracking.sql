-- Create table for tracking page visits and analytics

CREATE TABLE IF NOT EXISTS page_visits (
  visit_id INT AUTO_INCREMENT PRIMARY KEY,
  page VARCHAR(100) NOT NULL,
  referrer VARCHAR(500),
  user_agent TEXT,
  screen_resolution VARCHAR(50),
  language VARCHAR(20),
  ip_address VARCHAR(100),
  visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_page (page),
  INDEX idx_visited_at (visited_at),
  INDEX idx_ip_address (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add some comments
ALTER TABLE page_visits
  MODIFY COLUMN page VARCHAR(100) NOT NULL COMMENT 'Page identifier (e.g., landing, about, login)',
  MODIFY COLUMN referrer VARCHAR(500) COMMENT 'HTTP referrer or "direct"',
  MODIFY COLUMN user_agent TEXT COMMENT 'Browser user agent string',
  MODIFY COLUMN screen_resolution VARCHAR(50) COMMENT 'Screen resolution (e.g., 1920x1080)',
  MODIFY COLUMN language VARCHAR(20) COMMENT 'Browser language preference',
  MODIFY COLUMN ip_address VARCHAR(100) COMMENT 'Visitor IP address';
