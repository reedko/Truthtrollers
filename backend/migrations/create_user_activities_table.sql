-- Create user_activities table to track all user engagement
-- Supports: evidence runs, claim link actions, claim evaluations, task views

CREATE TABLE IF NOT EXISTS user_activities (
  activity_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  username VARCHAR(255) NULL,  -- Fallback for guest users
  activity_type ENUM(
    'evidence_run',
    'claim_link_add',
    'claim_link_evaluate',
    'task_view',
    'discussion_post'
  ) NOT NULL,
  content_id INT NULL,  -- Task/content being interacted with
  claim_id INT NULL,    -- Specific claim (for claim-related activities)
  link_id INT NULL,     -- Specific link (for link evaluations)
  metadata JSON NULL,   -- Additional context (e.g., textpad content length, evaluation details)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user_id (user_id),
  INDEX idx_username (username),
  INDEX idx_activity_type (activity_type),
  INDEX idx_content_id (content_id),
  INDEX idx_created_at (created_at),

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES content(content_id) ON DELETE CASCADE,
  FOREIGN KEY (claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Note: link_id foreign key omitted as there are multiple link tables (reference_claim_links, reference_claim_task_links)
