-- Migration: Add veracity scoring and auto-generation tracking to claim_links
-- Purpose: Enable AI-generated claim-to-claim links with veracity scores
-- Date: 2026-02-07

-- 1. ADD veracity_score column (0-1 truthfulness rating)
ALTER TABLE claim_links
ADD COLUMN IF NOT EXISTS veracity_score DECIMAL(5,2) DEFAULT NULL
COMMENT 'AI-generated veracity score 0-1 (truthfulness of reference claim)'
AFTER support_level;

-- 2. ADD confidence column (matching reference_claim_links schema)
ALTER TABLE claim_links
ADD COLUMN IF NOT EXISTS confidence DECIMAL(5,2) DEFAULT NULL
COMMENT 'AI confidence in this match 0.15-0.98'
AFTER veracity_score;

-- 3. ADD created_by_ai flag to distinguish auto-generated from user links
ALTER TABLE claim_links
ADD COLUMN IF NOT EXISTS created_by_ai TINYINT(1) DEFAULT 0
COMMENT '1 if auto-generated during reference scrape, 0 if user-created'
AFTER user_id;

-- 4. Add indices for GameSpace queries (claim-to-claim relationships)
CREATE INDEX IF NOT EXISTS idx_claim_links_target ON claim_links(target_claim_id, disabled);
CREATE INDEX IF NOT EXISTS idx_claim_links_source ON claim_links(source_claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_links_auto ON claim_links(created_by_ai, disabled);

-- 5. Update existing user-created links to have created_by_ai = 0 (if needed)
UPDATE claim_links
SET created_by_ai = 0
WHERE created_by_ai IS NULL;

-- Verification query (uncomment to check):
-- SELECT
--   COUNT(*) as total_links,
--   SUM(CASE WHEN created_by_ai = 1 THEN 1 ELSE 0 END) as ai_generated,
--   SUM(CASE WHEN created_by_ai = 0 THEN 1 ELSE 0 END) as user_created,
--   AVG(veracity_score) as avg_veracity,
--   AVG(confidence) as avg_confidence
-- FROM claim_links;
