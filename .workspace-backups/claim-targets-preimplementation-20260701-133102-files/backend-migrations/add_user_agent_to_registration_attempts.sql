-- Add user_agent column to registration_attempts table

-- Check if column exists and add it if it doesn't
SET @dbname = DATABASE();
SET @tablename = "registration_attempts";
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = 'user_agent'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE registration_attempts ADD COLUMN user_agent TEXT COMMENT ''Browser/device identification'' AFTER message',
  'SELECT ''Column user_agent already exists'' AS Info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify
SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'registration_attempts'
  AND COLUMN_NAME = 'user_agent';
