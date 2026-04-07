-- ═══════════════════════════════════════════════════════════════════
-- Add registered_at and last_accessed_at to users table
-- Run this on production database
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Add the new columns
ALTER TABLE users
  ADD COLUMN registered_at DATETIME DEFAULT NULL AFTER email,
  ADD COLUMN last_accessed_at DATETIME DEFAULT NULL AFTER registered_at;

-- Step 2: Populate registered_at from registration_attempts table
-- Use the earliest successful registration attempt for each user
UPDATE users u
INNER JOIN (
  SELECT
    username,
    MIN(created_at) as first_registration
  FROM registration_attempts
  WHERE success = 1
  GROUP BY username
) ra ON u.username = ra.username
SET u.registered_at = ra.first_registration;

-- Step 3: Populate last_accessed_at from user_activities table
-- Use the most recent activity for each user
UPDATE users u
INNER JOIN (
  SELECT
    user_id,
    MAX(created_at) as last_activity
  FROM user_activities
  GROUP BY user_id
) ua ON u.user_id = ua.user_id
SET u.last_accessed_at = ua.last_activity;

-- Step 4: For users without registration data, set to NULL (already default)
-- For users without activity data, set to NULL (already default)

-- Step 5: Verify the results
SELECT
  user_id,
  username,
  email,
  registered_at,
  last_accessed_at,
  CASE
    WHEN registered_at IS NULL THEN 'Missing registration date'
    WHEN last_accessed_at IS NULL THEN 'Never accessed'
    ELSE 'OK'
  END as status
FROM users
ORDER BY registered_at DESC;

-- ═══════════════════════════════════════════════════════════════════
-- Notes:
-- - registered_at will be NULL for users not found in registration_attempts
-- - last_accessed_at will be NULL for users with no activities
-- - Both columns are nullable to handle these cases gracefully
-- ═══════════════════════════════════════════════════════════════════
