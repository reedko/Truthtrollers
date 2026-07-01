-- Add user scoping to claims table
-- This allows claims to be either global (NULL user_id) or user-specific

ALTER TABLE claims 
ADD COLUMN IF NOT EXISTS created_by_user_id INT NULL DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by_user_id INT NULL DEFAULT NULL,
ADD COLUMN IF NOT EXISTS is_user_override TINYINT(1) DEFAULT 0 COMMENT 'True if this claim overrides a global claim for a specific user',
ADD COLUMN IF NOT EXISTS overrides_claim_id INT NULL DEFAULT NULL COMMENT 'If is_user_override=1, this is the global claim_id being overridden';

-- Add index for efficient querying
ALTER TABLE claims
ADD INDEX idx_user_scoped (created_by_user_id, deleted_at),
ADD INDEX idx_override (overrides_claim_id, is_user_override);

-- Add foreign key constraints
ALTER TABLE claims
ADD CONSTRAINT fk_claims_created_by_user FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
ADD CONSTRAINT fk_claims_deleted_by_user FOREIGN KEY (deleted_by_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
ADD CONSTRAINT fk_claims_overrides FOREIGN KEY (overrides_claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE;
