-- ============================================================================
-- EXPAND ip_address FIELDS TO HANDLE LONGER IPv6 ADDRESSES
-- Increases from VARCHAR(45) to VARCHAR(100) to handle edge cases
-- with IPv6, proxies, and x-forwarded-for edge cases
-- ============================================================================

-- Expand login_attempts ip_address field
ALTER TABLE login_attempts
MODIFY COLUMN ip_address VARCHAR(100) NOT NULL COMMENT 'IPv4 or IPv6 address (expanded for proxy edge cases)';

-- Expand registration_attempts ip_address field
ALTER TABLE registration_attempts
MODIFY COLUMN ip_address VARCHAR(100) NOT NULL COMMENT 'IPv4 or IPv6 address (expanded for proxy edge cases)';

-- Expand user_sessions ip_address field (if it exists)
-- NOTE: This is the CRITICAL one - successful logins write here FIRST!
ALTER TABLE user_sessions
MODIFY COLUMN ip_address VARCHAR(100) DEFAULT NULL COMMENT 'IPv4 or IPv6 address (expanded for proxy edge cases)';

-- Verify changes
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  CHARACTER_MAXIMUM_LENGTH
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('login_attempts', 'registration_attempts', 'user_sessions')
  AND COLUMN_NAME = 'ip_address';
