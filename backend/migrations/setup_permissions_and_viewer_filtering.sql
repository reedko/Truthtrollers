-- ============================================================================
-- PERMISSIONS & VIEWER-FILTERING SYSTEM
-- Completes existing roles/permissions tables + adds viewer-specific data
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. COMPLETE PERMISSION SYSTEM (missing tables)
-- ────────────────────────────────────────────────────────────────────────────

-- Permissions table (defines what permissions exist)
CREATE TABLE IF NOT EXISTS permissions (
  permission_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE COMMENT 'e.g., delete_system_references, manage_users',
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User-to-role mapping (users can have multiple roles)
CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. INSERT DEFAULT ROLES & PERMISSIONS
-- ────────────────────────────────────────────────────────────────────────────

-- Roles
INSERT IGNORE INTO roles (role_id, name) VALUES
  (1, 'super_admin'),
  (2, 'admin'),
  (3, 'moderator'),
  (4, 'user');

-- Permissions
INSERT IGNORE INTO permissions (name, description) VALUES
  ('delete_system_references', 'Can permanently delete evidence engine references'),
  ('delete_any_user_reference', 'Can delete references added by any user'),
  ('manage_users', 'Can edit user accounts, ban users, etc.'),
  ('manage_permissions', 'Can assign roles and permissions'),
  ('view_all_data', 'Can view all users'' claim links, ratings, etc.'),
  ('moderate_content', 'Can hide/flag inappropriate content');

-- Assign permissions to roles
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE
  -- Super Admin gets everything
  (r.name = 'super_admin') OR
  -- Admin gets most things
  (r.name = 'admin' AND p.name IN ('delete_any_user_reference', 'manage_users', 'view_all_data', 'moderate_content')) OR
  -- Moderator gets moderation powers
  (r.name = 'moderator' AND p.name IN ('moderate_content', 'view_all_data'));

-- ────────────────────────────────────────────────────────────────────────────
-- 3. REFERENCE VISIBILITY SYSTEM
-- ────────────────────────────────────────────────────────────────────────────

-- Track reference source and system status
ALTER TABLE content_relations
ADD COLUMN IF NOT EXISTS added_by_user_id INT NULL
  COMMENT 'NULL = evidence engine (system), otherwise user who added it',
ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE
  COMMENT 'TRUE = evidence engine ref (cannot be deleted by regular users)',
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD INDEX idx_added_by_user (added_by_user_id),
ADD FOREIGN KEY (added_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- Mark all existing evidence engine refs as system refs
UPDATE content_relations
SET is_system = TRUE, added_by_user_id = NULL
WHERE added_by_user_id IS NULL;

-- Per-user reference visibility (hide without deleting)
CREATE TABLE IF NOT EXISTS user_reference_visibility (
  user_id INT NOT NULL,
  task_content_id INT NOT NULL COMMENT 'The task/content being evaluated',
  reference_content_id INT NOT NULL COMMENT 'The reference to show/hide',
  is_hidden BOOLEAN DEFAULT FALSE,
  hidden_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, task_content_id, reference_content_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (task_content_id) REFERENCES content(content_id) ON DELETE CASCADE,
  FOREIGN KEY (reference_content_id) REFERENCES content(content_id) ON DELETE CASCADE,
  INDEX idx_user_task (user_id, task_content_id),
  INDEX idx_hidden (is_hidden)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT 'Tracks which references each user has hidden (soft-delete per user)';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. VIEWER-FILTERED DATA (ratings, comments)
-- ────────────────────────────────────────────────────────────────────────────

-- Add user_id to existing rating tables if not present
-- (Assuming you have author_ratings, publisher_ratings, claim_ratings, etc.)

-- Check if author_ratings needs user_id
SET @has_user_col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'author_ratings'
    AND COLUMN_NAME = 'user_id'
);

-- Add to author_ratings if missing
SET @sql_author = IF(@has_user_col = 0,
  'ALTER TABLE author_ratings ADD COLUMN user_id INT NOT NULL AFTER author_rating_id, ADD INDEX idx_user (user_id)',
  'SELECT "author_ratings.user_id already exists" AS Info'
);
PREPARE stmt FROM @sql_author;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Same for publisher_ratings
SET @has_user_col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'publisher_ratings'
    AND COLUMN_NAME = 'user_id'
);

SET @sql_pub = IF(@has_user_col = 0,
  'ALTER TABLE publisher_ratings ADD COLUMN user_id INT NOT NULL AFTER publisher_rating_id, ADD INDEX idx_user (user_id)',
  'SELECT "publisher_ratings.user_id already exists" AS Info'
);
PREPARE stmt FROM @sql_pub;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. VERIFICATION
-- ────────────────────────────────────────────────────────────────────────────

SELECT 'Setup complete!' AS Status;

SELECT 'Roles:' AS Check, COUNT(*) AS Count FROM roles;
SELECT 'Permissions:' AS Check, COUNT(*) AS Count FROM permissions;
SELECT 'Role Permissions:' AS Check, COUNT(*) AS Count FROM role_permissions;

SELECT r.name AS Role, GROUP_CONCAT(p.name SEPARATOR ', ') AS Permissions
FROM roles r
LEFT JOIN role_permissions rp ON r.role_id = rp.role_id
LEFT JOIN permissions p ON rp.permission_id = p.permission_id
GROUP BY r.role_id, r.name
ORDER BY r.role_id;
