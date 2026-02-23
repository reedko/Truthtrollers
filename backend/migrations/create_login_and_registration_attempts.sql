-- ============================================================================
-- CREATE LOGIN AND REGISTRATION ATTEMPT LOGGING TABLES
-- Following OWASP security logging best practices
-- IMPORTANT: NEVER log passwords - only log usernames and failure reasons
-- ============================================================================

-- Login attempts table (for failed AND successful login tracking)
CREATE TABLE IF NOT EXISTS login_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL COMMENT 'Username or email attempted (NOT the password)',
  success BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address VARCHAR(45) NOT NULL COMMENT 'IPv4 or IPv6 address',
  user_agent TEXT COMMENT 'Browser/device identification',
  reason VARCHAR(50) COMMENT 'Failure reason: user_not_found, invalid_password, captcha_failed, beta_access_denied, account_locked, rate_limited',
  fingerprint VARCHAR(255) COMMENT 'Device fingerprint for session tracking',
  user_id INT NULL COMMENT 'Resolved user_id if user exists (NULL if user not found)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_username (username),
  INDEX idx_ip_address (ip_address),
  INDEX idx_created_at (created_at),
  INDEX idx_success (success),
  INDEX idx_reason (reason),
  INDEX idx_fingerprint (fingerprint),
  INDEX idx_user_id (user_id),

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT 'Tracks all login attempts for security monitoring and debugging. NEVER stores passwords!';

-- Registration attempts table
CREATE TABLE IF NOT EXISTS registration_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) COMMENT 'Attempted username',
  email VARCHAR(255) NOT NULL COMMENT 'Attempted email',
  success BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address VARCHAR(45) NOT NULL COMMENT 'IPv4 or IPv6 address',
  message TEXT COMMENT 'Detailed error or success message',
  user_agent TEXT COMMENT 'Browser/device identification',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_email (email),
  INDEX idx_ip_address (ip_address),
  INDEX idx_created_at (created_at),
  INDEX idx_success (success)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT 'Tracks all registration attempts for security monitoring and debugging';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT
  'login_attempts table' AS Status,
  COUNT(*) AS 'Column Count'
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'login_attempts';

SELECT
  'registration_attempts table' AS Status,
  COUNT(*) AS 'Column Count'
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'registration_attempts';

-- Show table structures
DESCRIBE login_attempts;
DESCRIBE registration_attempts;
