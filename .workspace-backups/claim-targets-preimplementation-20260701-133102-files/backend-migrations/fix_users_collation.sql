-- Check users table collation
SELECT
    COLUMN_NAME,
    COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'truthtrollers'
  AND TABLE_NAME = 'users'
  AND COLLATION_NAME IS NOT NULL;
