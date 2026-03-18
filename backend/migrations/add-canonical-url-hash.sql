-- Add canonical_url_hash column and index for fast lookups
-- This enables hash-based queries without exposing raw URLs

ALTER TABLE content
ADD COLUMN canonical_url_hash VARCHAR(64) NULL
COMMENT 'SHA-256 hash of canonical URL for privacy-preserving lookups';

-- Add index on hash for fast lookups
CREATE INDEX idx_content_canonical_url_hash
ON content(canonical_url_hash);

-- Add canonical_url column to store the normalized URL
ALTER TABLE content
ADD COLUMN canonical_url VARCHAR(2048) NULL
COMMENT 'Canonicalized version of URL (normalized, tracking params removed)';

-- Optionally, add index on canonical_url for exact match queries
CREATE INDEX idx_content_canonical_url
ON content(canonical_url(255));
