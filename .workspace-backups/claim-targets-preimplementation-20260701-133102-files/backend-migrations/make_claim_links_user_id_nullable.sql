-- Migration: Make user_id nullable in claim_links
-- Purpose: Allow AI-generated claim links without requiring a user_id
-- AI-generated links are identified by created_by_ai=1
-- Date: 2026-02-10

ALTER TABLE claim_links
MODIFY COLUMN user_id INT NULL
COMMENT 'User who created the link. NULL for AI-generated links (created_by_ai=1)';
