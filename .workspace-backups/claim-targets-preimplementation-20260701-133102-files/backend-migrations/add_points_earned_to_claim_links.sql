-- Add points_earned column to claim_links table for GameSpace scoring
ALTER TABLE claim_links
ADD COLUMN points_earned DECIMAL(5,1) DEFAULT 0
COMMENT 'Points earned for this link in GameSpace (can be negative)';
