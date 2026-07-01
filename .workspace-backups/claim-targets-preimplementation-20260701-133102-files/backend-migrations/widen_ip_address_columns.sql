-- Widen ip_address columns to handle long IPv6 addresses and proxy chains
-- IPv6 can be up to 45 chars, but x-forwarded-for can contain multiple IPs
-- Example: "2601:600:9082:9c0:59ca:c0a4:68bf:f830, 108.162.245.39" = 59 chars

-- Update login_events table
ALTER TABLE login_events
MODIFY COLUMN ip_address VARCHAR(100)
COMMENT 'Client IP address (extracted from x-forwarded-for or socket)';

-- Update login_attempts table (if needed)
ALTER TABLE login_attempts
MODIFY COLUMN ip_address VARCHAR(100)
COMMENT 'Client IP address (extracted from x-forwarded-for or socket)';

-- Update registration_attempts table (if needed)
ALTER TABLE registration_attempts
MODIFY COLUMN ip_address VARCHAR(100)
COMMENT 'Client IP address (extracted from x-forwarded-for or socket)';

-- Verify changes
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  COLUMN_TYPE,
  CHARACTER_MAXIMUM_LENGTH
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME = 'ip_address'
  AND TABLE_NAME IN ('login_events', 'login_attempts', 'registration_attempts');
