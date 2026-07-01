-- Migration: Create claim_link_audit table for blockchain timestamping
-- Purpose: Track tamper-evident snapshots of finalized evidence chains with OpenTimestamp proofs

CREATE TABLE IF NOT EXISTS claim_link_audit (
  audit_id INT AUTO_INCREMENT PRIMARY KEY,

  -- Reference to the claim_link being audited
  claim_link_id INT NOT NULL,

  -- Canonical snapshot of the claim_link at time of finalization
  snapshot_json TEXT NOT NULL,

  -- SHA-256 hash of the canonical JSON
  content_hash VARCHAR(64) NOT NULL,

  -- OpenTimestamps proof data (binary .ots file content)
  ots_proof LONGBLOB NULL,

  -- Bitcoin block number where timestamp was anchored (populated after verification)
  bitcoin_block INT NULL,

  -- Timestamp when the record was finalized (immediately)
  finalized_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Timestamp when the OTS proof was verified against Bitcoin blockchain
  verified_at TIMESTAMP NULL,

  -- Status tracking: 'pending' -> 'submitted' -> 'verified'
  -- pending: Hash created, waiting for OTS submission
  -- submitted: OTS proof requested, waiting for Bitcoin confirmation
  -- verified: Proof confirmed in Bitcoin blockchain
  status ENUM('pending', 'submitted', 'verified') NOT NULL DEFAULT 'pending',

  -- Who finalized this record
  finalized_by_user_id INT NULL,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Foreign keys
  FOREIGN KEY (claim_link_id) REFERENCES claim_links(claim_link_id) ON DELETE CASCADE,
  FOREIGN KEY (finalized_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,

  -- Indexes for efficient lookups
  INDEX idx_claim_link (claim_link_id),
  INDEX idx_content_hash (content_hash),
  INDEX idx_status (status),
  INDEX idx_finalized_at (finalized_at),
  INDEX idx_verified_at (verified_at),

  -- Ensure each claim_link can only be finalized once
  UNIQUE KEY unique_claim_link (claim_link_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add comment for documentation
ALTER TABLE claim_link_audit COMMENT = 'Tamper-evident audit trail for finalized evidence chain links with Bitcoin-backed OpenTimestamp proofs';
