-- Add unique constraint to content_authors to prevent duplicates
-- This makes ON DUPLICATE KEY UPDATE work properly

-- Check if constraint already exists, add if not
ALTER TABLE content_authors
ADD UNIQUE KEY unique_content_author (content_id, author_id);
