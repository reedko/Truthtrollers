-- Add reviewer tracking fields to user_claim_ratings (skip if exists)
ALTER TABLE user_claim_ratings
ADD COLUMN reviewed_by_user_id INT NULL AFTER approval_status,
ADD COLUMN reviewed_at TIMESTAMP NULL AFTER reviewed_by_user_id,
ADD COLUMN reviewer_notes TEXT NULL AFTER reviewed_at;
