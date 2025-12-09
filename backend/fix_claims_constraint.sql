-- Fix claims table: Remove unique constraint on claim_text
-- Reason: Same claim text can appear in different content contexts
-- Example: "The vaccine is effective" means different things in different articles

USE truthtrollers_db;

-- Check current indexes
SHOW INDEX FROM claims WHERE Key_name = 'unique_claim_text';

-- Drop the unique constraint
ALTER TABLE claims
DROP INDEX unique_claim_text;

-- Verify it's gone
SHOW INDEX FROM claims;

-- Optional: Add a regular (non-unique) index for performance
-- This helps with searching claims by text without enforcing uniqueness
ALTER TABLE claims
ADD INDEX idx_claim_text (claim_text(255));

SELECT 'Migration complete: claim_text is no longer unique' AS status;
