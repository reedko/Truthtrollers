-- ============================================================================
-- TEST: Check if user_sessions.ip_address is causing silent failures
-- ============================================================================

-- 1. Show current column definition
SELECT
  COLUMN_NAME,
  DATA_TYPE,
  CHARACTER_MAXIMUM_LENGTH as MAX_LENGTH,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'user_sessions'
  AND COLUMN_NAME = 'ip_address';

-- 2. Show recent user_sessions entries and their IP lengths
SELECT
  user_id,
  device_fingerprint,
  login_time,
  ip_address,
  LENGTH(ip_address) as ip_length,
  CHAR_LENGTH(ip_address) as ip_char_length
FROM user_sessions
ORDER BY login_time DESC
LIMIT 10;

-- 3. Find any IP addresses that are exactly 45 chars (truncated)
SELECT
  user_id,
  login_time,
  ip_address,
  LENGTH(ip_address) as ip_length
FROM user_sessions
WHERE LENGTH(ip_address) >= 45
ORDER BY login_time DESC;

-- ============================================================================
-- If MAX_LENGTH shows 45 above, run the expand-ip-address-fields.sql migration!
-- ============================================================================
