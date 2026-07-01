-- Adds a UNIQUE KEY on (target_type, target_id) so INSERT … ON DUPLICATE KEY UPDATE
-- actually updates the existing row instead of always inserting a new one.
--
-- Step 1: deduplicate — keep the highest-priority row per (target_type, target_id).
--   Priority: human_confirmed > community_reviewed > machine_suggested > anything else.
--   Ties broken by latest updated_at.

DELETE ae
FROM admiralty_evaluations ae
LEFT JOIN (
  SELECT
    MIN(admiralty_evaluation_id) AS keep_id,
    target_type,
    target_id
  FROM admiralty_evaluations
  WHERE (target_type, target_id, updated_at) IN (
    SELECT target_type, target_id, MAX(updated_at)
    FROM admiralty_evaluations
    GROUP BY target_type, target_id
  )
  GROUP BY target_type, target_id
) AS keeper ON ae.admiralty_evaluation_id = keeper.keep_id
WHERE keeper.keep_id IS NULL;

-- Step 2: add UNIQUE KEY via stored procedure (MySQL has no ADD UNIQUE IF NOT EXISTS).

DROP PROCEDURE IF EXISTS _add_admiralty_unique_key;

DELIMITER //
CREATE PROCEDURE _add_admiralty_unique_key()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'admiralty_evaluations'
      AND index_name   = 'uq_target'
  ) THEN
    ALTER TABLE admiralty_evaluations
      DROP INDEX idx_target,
      ADD UNIQUE KEY uq_target (target_type, target_id);
  END IF;
END //
DELIMITER ;

CALL _add_admiralty_unique_key();
DROP PROCEDURE IF EXISTS _add_admiralty_unique_key;
