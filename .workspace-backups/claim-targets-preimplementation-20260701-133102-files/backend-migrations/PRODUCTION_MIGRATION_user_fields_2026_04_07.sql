-- ═══════════════════════════════════════════════════════════════════
-- Production Migration: Add User Management Fields
-- Date: 2026-04-07
-- Description: Add registered_at, last_accessed_at, and enabled fields
-- Compatible with: MySQL 5.7+, MySQL 8.0+, MariaDB 10.0+
-- Run this on production database (MySQL Workbench or MariaDB client)
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Add the new columns
ALTER TABLE users
  ADD COLUMN registered_at DATETIME DEFAULT NULL AFTER email,
  ADD COLUMN last_accessed_at DATETIME DEFAULT NULL AFTER registered_at,
  ADD COLUMN enabled TINYINT(1) DEFAULT 1 AFTER last_accessed_at;

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

-- Step 4: Ensure all existing users are enabled (default value)
-- This is already done by DEFAULT 1 in the ALTER TABLE, but let's be explicit
UPDATE users SET enabled = 1 WHERE enabled IS NULL;

-- Step 5: Verify the results
SELECT
  user_id,
  username,
  email,
  registered_at,
  last_accessed_at,
  enabled,
  CASE
    WHEN registered_at IS NULL THEN 'Missing registration date'
    WHEN last_accessed_at IS NULL THEN 'Never accessed'
    WHEN enabled = 0 THEN 'Disabled user'
    ELSE 'OK'
  END as status
FROM users
ORDER BY registered_at DESC;

-- ═══════════════════════════════════════════════════════════════════
-- Notes:
-- - registered_at: Set on user registration, populated from registration_attempts
-- - last_accessed_at: Updated on each login, populated from user_activities
-- - enabled: 1 = active user, 0 = disabled (for subscription management)
-- - registered_at will be NULL for users not found in registration_attempts
-- - last_accessed_at will be NULL for users with no activities
-- - All columns are nullable to handle edge cases gracefully
-- - enabled defaults to 1 (enabled) for all new and existing users
-- ═══════════════════════════════════════════════════════════════════
