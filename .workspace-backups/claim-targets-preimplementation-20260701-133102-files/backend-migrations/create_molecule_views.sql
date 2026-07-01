-- Create molecule views tables for managing tabbed views with pinned/hidden cards

-- Main views table: stores tabs for each user+task combination
CREATE TABLE IF NOT EXISTS molecule_views (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  content_id INT NOT NULL,  -- The task/content this view is for
  name VARCHAR(255) NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  display_mode VARCHAR(50) DEFAULT 'mr_cards',  -- Display mode: 'mr_cards', 'circles', 'compact'
  last_viewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Ensure unique view names per user+task
  UNIQUE KEY unique_view_name (user_id, content_id, name),

  -- Foreign keys
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,

  -- Index for fast lookups
  INDEX idx_user_content (user_id, content_id),
  INDEX idx_last_viewed (last_viewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pins table: stores which reference cards are pinned/hidden in each view
CREATE TABLE IF NOT EXISTS molecule_view_pins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  view_id INT NOT NULL,
  reference_content_id INT NOT NULL,  -- The reference content being pinned/hidden
  is_pinned BOOLEAN DEFAULT TRUE,  -- TRUE = pinned/visible, FALSE = hidden
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Ensure one entry per reference per view
  UNIQUE KEY unique_pin (view_id, reference_content_id),

  -- Foreign keys
  FOREIGN KEY (view_id) REFERENCES molecule_views(id) ON DELETE CASCADE,
  FOREIGN KEY (reference_content_id) REFERENCES content(content_id) ON DELETE CASCADE,

  -- Index for fast lookups
  INDEX idx_view_id (view_id),
  INDEX idx_reference_content (reference_content_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
