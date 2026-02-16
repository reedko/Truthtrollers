-- ============================================================================
-- Migration: Add Task Completion Tracking
-- Adds per-user completion tracking to content_users table
-- ============================================================================

-- Add completed_at column if it doesn't exist
-- Note: If column exists, this will produce a warning but won't fail
ALTER TABLE content_users
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP NULL DEFAULT NULL;

-- Add index on completed_at for better query performance
-- Note: If index exists, this will produce an error, so we check first
CREATE INDEX IF NOT EXISTS idx_completed ON content_users(completed_at);

-- Verification
SELECT 'Migration completed successfully!' AS Status;

-- Show column structure
DESCRIBE content_users;
