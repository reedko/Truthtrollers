-- ============================================================================
-- Create tutorial_videos table
-- ============================================================================
-- Stores video tutorials that can be uploaded by super_admins
-- and viewed by all users
-- ============================================================================

USE truthtrollers;

CREATE TABLE IF NOT EXISTS tutorial_videos (
  tutorial_video_id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  video_url VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500),
  duration_seconds INT,
  order_index INT DEFAULT 0,
  category VARCHAR(100),
  uploaded_by_user_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,

  INDEX idx_category (category),
  INDEX idx_order (order_index),
  INDEX idx_active (is_active),
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '✅ tutorial_videos table created successfully' AS Status;
