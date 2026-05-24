-- Check collations for ALL ttlive tables
SELECT
    TABLE_NAME,
    COLUMN_NAME,
    CHARACTER_SET_NAME,
    COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'truthtrollers'
  AND TABLE_NAME LIKE 'ttlive_%'
  AND COLUMN_NAME LIKE '%thread_id%'
ORDER BY TABLE_NAME, COLUMN_NAME;
