-- Add reviewer tracking fields to user_claim_ratings
ALTER TABLE user_claim_ratings
ADD COLUMN IF NOT EXISTS reviewed_by_user_id INT NULL AFTER approval_status,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL AFTER reviewed_by_user_id,
ADD COLUMN IF NOT EXISTS reviewer_notes TEXT NULL AFTER reviewed_at;

-- Add foreign key for reviewer
ALTER TABLE user_claim_ratings
ADD CONSTRAINT fk_reviewer
FOREIGN KEY (reviewed_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- Add index for reviewed_by queries
CREATE INDEX IF NOT EXISTS idx_reviewed_by ON user_claim_ratings(reviewed_by_user_id);
