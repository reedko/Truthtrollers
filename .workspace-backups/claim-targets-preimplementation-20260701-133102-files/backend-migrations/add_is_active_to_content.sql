-- Add is_active column to content table
-- This allows soft deletion of tasks without actually removing data

ALTER TABLE content
ADD COLUMN is_active TINYINT DEFAULT 1 AFTER is_retracted;

-- Add index for faster filtering
CREATE INDEX idx_content_is_active ON content(is_active);
