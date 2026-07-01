-- ============================================================================
-- Add surrogate primary keys to junction tables with composite PKs
-- These tables currently use composite PKs but would benefit from consistency
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ────────────────────────────────────────────────────────────────────────────
-- user_roles (currently: user_id + role_id)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_roles
  ADD COLUMN user_role_id INT AUTO_INCREMENT FIRST,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (user_role_id),
  ADD UNIQUE KEY idx_user_role_unique (user_id, role_id);

SELECT 'Completed: user_roles' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- role_permissions (currently: role_id + permission_id)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE role_permissions
  ADD COLUMN role_permission_id INT AUTO_INCREMENT FIRST,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (role_permission_id),
  ADD UNIQUE KEY idx_role_permission_unique (role_id, permission_id);

SELECT 'Completed: role_permissions' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_permissions (currently: user_id + permission_id)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_permissions
  ADD COLUMN user_permission_id INT AUTO_INCREMENT FIRST,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (user_permission_id),
  ADD UNIQUE KEY idx_user_permission_unique (user_id, permission_id);

SELECT 'Completed: user_permissions' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- content_users (currently: content_id + user_id)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE content_users
  ADD COLUMN content_user_id INT AUTO_INCREMENT FIRST,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (content_user_id),
  ADD UNIQUE KEY idx_content_user_unique (content_id, user_id);

SELECT 'Completed: content_users' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_reference_visibility (currently: user_id + task_content_id + reference_content_id)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_reference_visibility
  ADD COLUMN user_reference_visibility_id INT AUTO_INCREMENT FIRST,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (user_reference_visibility_id),
  ADD UNIQUE KEY idx_user_ref_vis_unique (user_id, task_content_id, reference_content_id);

SELECT 'Completed: user_reference_visibility' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_veracity_ratings (currently: user_id + veracity_relation_id)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_veracity_ratings
  ADD COLUMN user_veracity_rating_id INT AUTO_INCREMENT FIRST,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (user_veracity_rating_id),
  ADD UNIQUE KEY idx_user_veracity_unique (user_id, veracity_relation_id);

SELECT 'Completed: user_veracity_ratings' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- bias_vectors (currently: entity_id + entity_type + topic_id)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE bias_vectors
  ADD COLUMN bias_vector_id INT AUTO_INCREMENT FIRST,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (bias_vector_id),
  ADD UNIQUE KEY idx_bias_vector_unique (entity_id, entity_type, topic_id);

SELECT 'Completed: bias_vectors' AS status;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- DONE - All junction tables now have surrogate primary keys
-- The old composite keys are preserved as unique constraints
-- ============================================================================

SELECT '✅ All junction tables updated with surrogate primary keys' AS final_status;
