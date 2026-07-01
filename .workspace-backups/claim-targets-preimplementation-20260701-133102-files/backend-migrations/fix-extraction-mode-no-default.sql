-- Remove DEFAULT 'edge' from extraction_mode column
-- This ensures new content doesn't auto-inherit 'edge'
-- Instead, NULL = use global default, non-NULL = explicit override (from rerun modal)

ALTER TABLE content
MODIFY COLUMN extraction_mode VARCHAR(50) DEFAULT NULL
COMMENT 'Extraction mode override (set by evidence rerun modal): edge, ranked, comprehensive. NULL = use global default';

-- Clear existing 'edge' values that were auto-set by old DEFAULT
-- (Keep non-edge values, those were explicitly set by users)
UPDATE content
SET extraction_mode = NULL
WHERE extraction_mode = 'edge';

SELECT '✅ Removed extraction_mode DEFAULT and cleared auto-set edge values' AS status;
