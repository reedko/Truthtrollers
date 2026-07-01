-- Rename 'notes' to 'rationale' in claim_links table for consistency with reference_claim_task_links

ALTER TABLE claim_links
CHANGE COLUMN notes rationale TEXT
COMMENT 'Rationale or explanation for the link relationship';

-- Verification query
SELECT
  COLUMN_NAME,
  DATA_TYPE,
  COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'claim_links'
  AND COLUMN_NAME = 'rationale';
