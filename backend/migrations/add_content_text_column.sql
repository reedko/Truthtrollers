-- Add content_text column to store full cleaned text for quality analysis
-- This allows on-demand quality scoring without re-fetching URLs

ALTER TABLE content
ADD COLUMN content_text TEXT DEFAULT NULL
COMMENT 'Full cleaned text (up to 65KB) for quality analysis. LLM scoring uses first 2000 chars. NULL for old content.';

-- Optional: Add fulltext index for future search functionality
-- Uncomment if needed:
-- ALTER TABLE content ADD FULLTEXT INDEX idx_content_text (content_text);
