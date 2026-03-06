-- ============================================================================
-- Add single-column primary keys to tables
-- Generated: 2026-02-25T08:33:22.023Z
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- author_affiliations
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE author_affiliations
  ADD COLUMN author_affiliations_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE author_affiliations
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE author_affiliations
  ADD PRIMARY KEY (author_affiliations_id);

SELECT 'Completed: author_affiliations' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- author_ratings
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE author_ratings
  ADD COLUMN author_ratings_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE author_ratings
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE author_ratings
  ADD PRIMARY KEY (author_ratings_id);

SELECT 'Completed: author_ratings' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- authors
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE authors
  ADD COLUMN authors_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE authors
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE authors
  ADD PRIMARY KEY (authors_id);

SELECT 'Completed: authors' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- bias_topic_properties
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE bias_topic_properties
  ADD COLUMN bias_topic_properties_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE bias_topic_properties
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE bias_topic_properties
  ADD PRIMARY KEY (bias_topic_properties_id);

SELECT 'Completed: bias_topic_properties' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- bias_vectors
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE bias_vectors
  ADD COLUMN bias_vectors_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE bias_vectors
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE bias_vectors
  ADD PRIMARY KEY (bias_vectors_id);

-- Step 4: Add unique constraint on old PK columns to maintain uniqueness
ALTER TABLE bias_vectors
  ADD UNIQUE KEY idx_bias_vectors_unique (entity_id, entity_type, topic_id);

SELECT 'Completed: bias_vectors' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- chat_messages
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE chat_messages
  ADD COLUMN chat_messages_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE chat_messages
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE chat_messages
  ADD PRIMARY KEY (chat_messages_id);

SELECT 'Completed: chat_messages' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- claim_links
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE claim_links
  ADD COLUMN claim_links_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE claim_links
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE claim_links
  ADD PRIMARY KEY (claim_links_id);

SELECT 'Completed: claim_links' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- claim_sources
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE claim_sources
  ADD COLUMN claim_sources_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE claim_sources
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE claim_sources
  ADD PRIMARY KEY (claim_sources_id);

SELECT 'Completed: claim_sources' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- claims
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE claims
  ADD COLUMN claims_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE claims
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE claims
  ADD PRIMARY KEY (claims_id);

SELECT 'Completed: claims' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- content_authors
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE content_authors
  ADD COLUMN content_authors_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE content_authors
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE content_authors
  ADD PRIMARY KEY (content_authors_id);

SELECT 'Completed: content_authors' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- content_claims
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE content_claims
  ADD COLUMN content_claims_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE content_claims
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE content_claims
  ADD PRIMARY KEY (content_claims_id);

SELECT 'Completed: content_claims' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- content_publishers
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE content_publishers
  ADD COLUMN content_publishers_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE content_publishers
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE content_publishers
  ADD PRIMARY KEY (content_publishers_id);

SELECT 'Completed: content_publishers' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- content_relations
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE content_relations
  ADD COLUMN content_relations_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE content_relations
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE content_relations
  ADD PRIMARY KEY (content_relations_id);

SELECT 'Completed: content_relations' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- content_scores
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE content_scores
  ADD COLUMN content_scores_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE content_scores
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE content_scores
  ADD PRIMARY KEY (content_scores_id);

SELECT 'Completed: content_scores' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- content_source_quality
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE content_source_quality
  ADD COLUMN content_source_quality_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE content_source_quality
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE content_source_quality
  ADD PRIMARY KEY (content_source_quality_id);

SELECT 'Completed: content_source_quality' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- content_testimonials
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE content_testimonials
  ADD COLUMN content_testimonials_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE content_testimonials
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE content_testimonials
  ADD PRIMARY KEY (content_testimonials_id);

SELECT 'Completed: content_testimonials' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- content_users
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE content_users
  ADD COLUMN content_users_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE content_users
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE content_users
  ADD PRIMARY KEY (content_users_id);

-- Step 4: Add unique constraint on old PK columns to maintain uniqueness
ALTER TABLE content_users
  ADD UNIQUE KEY idx_content_users_unique (content_id, user_id);

SELECT 'Completed: content_users' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- content_versions
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE content_versions
  ADD COLUMN content_versions_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE content_versions
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE content_versions
  ADD PRIMARY KEY (content_versions_id);

SELECT 'Completed: content_versions' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- discussion_entries
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE discussion_entries
  ADD COLUMN discussion_entries_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE discussion_entries
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE discussion_entries
  ADD PRIMARY KEY (discussion_entries_id);

SELECT 'Completed: discussion_entries' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- extension_instances
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE extension_instances
  ADD COLUMN extension_instances_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE extension_instances
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE extension_instances
  ADD PRIMARY KEY (extension_instances_id);

SELECT 'Completed: extension_instances' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- last_visited
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE last_visited
  ADD COLUMN last_visited_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE last_visited
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE last_visited
  ADD PRIMARY KEY (last_visited_id);

SELECT 'Completed: last_visited' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- llm_prompts
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE llm_prompts
  ADD COLUMN llm_prompts_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE llm_prompts
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE llm_prompts
  ADD PRIMARY KEY (llm_prompts_id);

SELECT 'Completed: llm_prompts' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- login_events
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE login_events
  ADD COLUMN login_events_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE login_events
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE login_events
  ADD PRIMARY KEY (login_events_id);

SELECT 'Completed: login_events' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- molecule_view_pins
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE molecule_view_pins
  ADD COLUMN molecule_view_pins_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE molecule_view_pins
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE molecule_view_pins
  ADD PRIMARY KEY (molecule_view_pins_id);

SELECT 'Completed: molecule_view_pins' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- molecule_views
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE molecule_views
  ADD COLUMN molecule_views_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE molecule_views
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE molecule_views
  ADD PRIMARY KEY (molecule_views_id);

SELECT 'Completed: molecule_views' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- password_reset_tokens
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE password_reset_tokens
  ADD COLUMN password_reset_tokens_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE password_reset_tokens
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE password_reset_tokens
  ADD PRIMARY KEY (password_reset_tokens_id);

SELECT 'Completed: password_reset_tokens' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- permissions
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE permissions
  ADD COLUMN permissions_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE permissions
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE permissions
  ADD PRIMARY KEY (permissions_id);

SELECT 'Completed: permissions' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- publisher_ratings
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE publisher_ratings
  ADD COLUMN publisher_ratings_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE publisher_ratings
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE publisher_ratings
  ADD PRIMARY KEY (publisher_ratings_id);

SELECT 'Completed: publisher_ratings' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- publishers
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE publishers
  ADD COLUMN publishers_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE publishers
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE publishers
  ADD PRIMARY KEY (publishers_id);

SELECT 'Completed: publishers' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- push_subscriptions
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE push_subscriptions
  ADD COLUMN push_subscriptions_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE push_subscriptions
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE push_subscriptions
  ADD PRIMARY KEY (push_subscriptions_id);

SELECT 'Completed: push_subscriptions' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- reference_claim_links
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE reference_claim_links
  ADD COLUMN reference_claim_links_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE reference_claim_links
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE reference_claim_links
  ADD PRIMARY KEY (reference_claim_links_id);

SELECT 'Completed: reference_claim_links' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- registration_attempts
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE registration_attempts
  ADD COLUMN registration_attempts_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE registration_attempts
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE registration_attempts
  ADD PRIMARY KEY (registration_attempts_id);

SELECT 'Completed: registration_attempts' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- role_permissions
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE role_permissions
  ADD COLUMN role_permissions_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE role_permissions
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE role_permissions
  ADD PRIMARY KEY (role_permissions_id);

-- Step 4: Add unique constraint on old PK columns to maintain uniqueness
ALTER TABLE role_permissions
  ADD UNIQUE KEY idx_role_permissions_unique (role_id, permission_id);

SELECT 'Completed: role_permissions' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- roles
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE roles
  ADD COLUMN roles_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE roles
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE roles
  ADD PRIMARY KEY (roles_id);

SELECT 'Completed: roles' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- scrape_jobs
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE scrape_jobs
  ADD COLUMN scrape_jobs_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE scrape_jobs
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE scrape_jobs
  ADD PRIMARY KEY (scrape_jobs_id);

SELECT 'Completed: scrape_jobs' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- testimonials
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE testimonials
  ADD COLUMN testimonials_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE testimonials
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE testimonials
  ADD PRIMARY KEY (testimonials_id);

SELECT 'Completed: testimonials' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- topics
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE topics
  ADD COLUMN topics_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE topics
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE topics
  ADD PRIMARY KEY (topics_id);

SELECT 'Completed: topics' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_claim_ratings
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE user_claim_ratings
  ADD COLUMN user_claim_ratings_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE user_claim_ratings
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE user_claim_ratings
  ADD PRIMARY KEY (user_claim_ratings_id);

SELECT 'Completed: user_claim_ratings' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_permissions
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE user_permissions
  ADD COLUMN user_permissions_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE user_permissions
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE user_permissions
  ADD PRIMARY KEY (user_permissions_id);

-- Step 4: Add unique constraint on old PK columns to maintain uniqueness
ALTER TABLE user_permissions
  ADD UNIQUE KEY idx_user_permissions_unique (user_id, permission_id);

SELECT 'Completed: user_permissions' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_reference_visibility
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE user_reference_visibility
  ADD COLUMN user_reference_visibility_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE user_reference_visibility
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE user_reference_visibility
  ADD PRIMARY KEY (user_reference_visibility_id);

-- Step 4: Add unique constraint on old PK columns to maintain uniqueness
ALTER TABLE user_reference_visibility
  ADD UNIQUE KEY idx_user_reference_visibility_unique (user_id, task_content_id, reference_content_id);

SELECT 'Completed: user_reference_visibility' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_reputation
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE user_reputation
  ADD COLUMN user_reputation_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE user_reputation
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE user_reputation
  ADD PRIMARY KEY (user_reputation_id);

SELECT 'Completed: user_reputation' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_roles
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE user_roles
  ADD COLUMN user_roles_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE user_roles
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE user_roles
  ADD PRIMARY KEY (user_roles_id);

-- Step 4: Add unique constraint on old PK columns to maintain uniqueness
ALTER TABLE user_roles
  ADD UNIQUE KEY idx_user_roles_unique (user_id, role_id);

SELECT 'Completed: user_roles' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_sessions
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE user_sessions
  ADD COLUMN user_sessions_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE user_sessions
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE user_sessions
  ADD PRIMARY KEY (user_sessions_id);

SELECT 'Completed: user_sessions' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_veracity_ratings
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE user_veracity_ratings
  ADD COLUMN user_veracity_ratings_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE user_veracity_ratings
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE user_veracity_ratings
  ADD PRIMARY KEY (user_veracity_ratings_id);

-- Step 4: Add unique constraint on old PK columns to maintain uniqueness
ALTER TABLE user_veracity_ratings
  ADD UNIQUE KEY idx_user_veracity_ratings_unique (user_id, veracity_relation_id);

SELECT 'Completed: user_veracity_ratings' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- user_verimeter_scores
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE user_verimeter_scores
  ADD COLUMN user_verimeter_scores_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE user_verimeter_scores
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE user_verimeter_scores
  ADD PRIMARY KEY (user_verimeter_scores_id);

SELECT 'Completed: user_verimeter_scores' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- users
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE users
  ADD COLUMN users_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE users
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE users
  ADD PRIMARY KEY (users_id);

SELECT 'Completed: users' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- veracity_history
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE veracity_history
  ADD COLUMN veracity_history_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE veracity_history
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE veracity_history
  ADD PRIMARY KEY (veracity_history_id);

SELECT 'Completed: veracity_history' AS status;


-- ────────────────────────────────────────────────────────────────────────────
-- veracity_relations
-- ────────────────────────────────────────────────────────────────────────────

-- Step 1: Add new auto-increment primary key column
ALTER TABLE veracity_relations
  ADD COLUMN veracity_relations_id INT AUTO_INCREMENT UNIQUE FIRST;

-- Step 2: Drop old composite primary key
ALTER TABLE veracity_relations
  DROP PRIMARY KEY;

-- Step 3: Set new column as primary key
ALTER TABLE veracity_relations
  ADD PRIMARY KEY (veracity_relations_id);

SELECT 'Completed: veracity_relations' AS status;


-- ============================================================================
-- DONE
-- ============================================================================
