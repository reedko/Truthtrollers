-- ============================================================================
-- Migration: Add Claim Selection Lanes (Evaluation & Background)
-- ============================================================================
-- Adds support for two persisted claim lanes:
-- 1. selectedEvaluationClaims - Claims selected for workspace evaluation
-- 2. selectedSourceBackgroundClaims - Claims selected as background source material
--
-- Safe to re-run: Uses information_schema checks for idempotency
-- ============================================================================

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- ============================================================================
-- SECTION 1: Lane Selection Columns
-- ============================================================================

-- Lane 1: Evaluation Lane Columns
-- Check and add selected_for_evaluation
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND COLUMN_NAME = 'selected_for_evaluation'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE content_claims ADD COLUMN selected_for_evaluation TINYINT(1) DEFAULT 0 COMMENT "Marks claim as selected for workspace evaluation lane" AFTER argument_function',
  'SELECT "Column selected_for_evaluation already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add evaluation_eligible
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND COLUMN_NAME = 'evaluation_eligible'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE content_claims ADD COLUMN evaluation_eligible TINYINT(1) DEFAULT 1 COMMENT "Tracks if claim is eligible for evaluation (post-triage assessment)" AFTER selected_for_evaluation',
  'SELECT "Column evaluation_eligible already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add verdict_eligible
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND COLUMN_NAME = 'verdict_eligible'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE content_claims ADD COLUMN verdict_eligible TINYINT(1) DEFAULT 1 COMMENT "Tracks if claim can receive verdict judgments" AFTER evaluation_eligible',
  'SELECT "Column verdict_eligible already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add search_eligible
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND COLUMN_NAME = 'search_eligible'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE content_claims ADD COLUMN search_eligible TINYINT(1) DEFAULT 1 COMMENT "Tracks if claim is searchable in current content evaluation" AFTER verdict_eligible',
  'SELECT "Column search_eligible already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add source_eligible
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND COLUMN_NAME = 'source_eligible'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE content_claims ADD COLUMN source_eligible TINYINT(1) DEFAULT 1 COMMENT "Tracks if claim is eligible for future source use" AFTER search_eligible',
  'SELECT "Column source_eligible already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add visibility (global visibility level)
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND COLUMN_NAME = 'visibility'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE content_claims ADD COLUMN visibility VARCHAR(32) DEFAULT "workspace" COMMENT "Global visibility level: workspace, workspace_eval, workspace_background, source_only, public, private" AFTER source_eligible',
  'SELECT "Column visibility already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- SECTION 2: Background Lane Columns
-- ============================================================================

-- Add selected_for_background
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND COLUMN_NAME = 'selected_for_background'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE content_claims ADD COLUMN selected_for_background TINYINT(1) DEFAULT 0 COMMENT "Marks claim as selected for background source material lane" AFTER visibility',
  'SELECT "Column selected_for_background already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add source_usefulness
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND COLUMN_NAME = 'source_usefulness'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE content_claims ADD COLUMN source_usefulness ENUM("high", "medium", "low") DEFAULT NULL COMMENT "Usefulness rating for source material: high, medium, low" AFTER selected_for_background',
  'SELECT "Column source_usefulness already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- SECTION 3: Create Composite Indexes for Lane Filtering
-- ============================================================================

-- Index for evaluation lane filtering
SET @index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND INDEX_NAME = 'idx_evaluation_lane'
);
SET @sql = IF(@index_exists = 0,
  'ALTER TABLE content_claims ADD INDEX idx_evaluation_lane (selected_for_evaluation, evaluation_eligible, verdict_eligible)',
  'SELECT "Index idx_evaluation_lane already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Index for background lane filtering
SET @index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND INDEX_NAME = 'idx_background_lane'
);
SET @sql = IF(@index_exists = 0,
  'ALTER TABLE content_claims ADD INDEX idx_background_lane (selected_for_background, source_usefulness)',
  'SELECT "Index idx_background_lane already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Index for visibility filtering
SET @index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'content_claims'
    AND INDEX_NAME = 'idx_visibility'
);
SET @sql = IF(@index_exists = 0,
  'ALTER TABLE content_claims ADD INDEX idx_visibility (visibility)',
  'SELECT "Index idx_visibility already exists" AS Info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- SECTION 4: Summary Output
-- ============================================================================

SELECT '
================================================================================
Migration: Add Claim Selection Lanes - COMPLETE
================================================================================

New columns added to content_claims:
  1. selected_for_evaluation (TINYINT(1)) - Lane 1 selector
  2. evaluation_eligible (TINYINT(1)) - Lane 1 eligibility flag
  3. verdict_eligible (TINYINT(1)) - Verdict judgment eligibility
  4. search_eligible (TINYINT(1)) - Current evaluation search eligibility
  5. source_eligible (TINYINT(1)) - Future source use eligibility
  6. visibility (VARCHAR(32)) - Global visibility level
  7. selected_for_background (TINYINT(1)) - Lane 2 selector
  8. source_usefulness (ENUM) - Lane 2 usefulness rating

New indexes created:
  - idx_evaluation_lane (selected_for_evaluation, evaluation_eligible, verdict_eligible)
  - idx_background_lane (selected_for_background, source_usefulness)
  - idx_visibility (visibility)

Lane 1 (selectedEvaluationClaims) Configuration:
  - selected_for_evaluation = 1
  - evaluation_eligible = 1
  - verdict_eligible = 1
  - search_eligible = 1
  - source_eligible = 1
  - visibility = "workspace_eval"
  - argument_function = "evaluation"
  - accountability_eligible = 1 (optional)

Lane 2 (selectedSourceBackgroundClaims) Configuration:
  - claim_role = "background"
  - argument_function = "background"
  - selected_for_background = 1
  - selected_for_evaluation = 0
  - evaluation_eligible = 0
  - verdict_eligible = 0
  - search_eligible = 0
  - source_eligible = 1
  - source_usefulness IN ("high", "medium", "low")
  - visibility IN ("workspace_background", "source_only")

Reusable Fields (already exist):
  - claim_role (ENUM: thesis, pillar, pillar_support, evidence, background, fallibility_critical)
  - argument_function (VARCHAR)
  - accountability_eligible (TINYINT(1))
  - parent_claim_id, claim_depth (for hierarchy)
  - centrality_score, verifiability_score (for triage)

================================================================================
' AS migration_summary;
