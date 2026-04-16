/**
 * OpenTimestamps Service
 *
 * Provides Bitcoin-backed cryptographic timestamping for evidence chain records.
 * Uses OpenTimestamps protocol to create verifiable, immutable proofs of existence.
 */

import OpenTimestamps from 'opentimestamp';
import { pool } from '../db/pool.js';
import { createAuditSnapshot, verifySnapshotHash } from '../utils/auditSnapshot.js';

/**
 * Finalizes a claim_link by creating a cryptographic audit record
 * and submitting it to OpenTimestamps for Bitcoin anchoring
 *
 * @param {number} claimLinkId - The claim_link_id to finalize
 * @param {number} userId - The user who is finalizing the record
 * @returns {Promise<Object>} Audit record with timestamp info
 */
export async function finalizeClaimLink(claimLinkId, userId) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Check if already finalized
    const [existing] = await connection.query(
      'SELECT audit_id FROM claim_link_audit WHERE claim_link_id = ?',
      [claimLinkId]
    );

    if (existing.length > 0) {
      throw new Error(`Claim link ${claimLinkId} is already finalized`);
    }

    // Create canonical snapshot and hash
    const { snapshot, canonicalJSON, hash } = await createAuditSnapshot(claimLinkId);

    // Create OTS proof from the hash
    const hashBuffer = Buffer.from(hash, 'hex');
    const detached = OpenTimestamps.DetachedTimestampFile.fromHash(
      new OpenTimestamps.Ops.OpSHA256(),
      hashBuffer
    );

    // Submit to OpenTimestamps calendars for Bitcoin anchoring
    // This is asynchronous - the proof will be completed when Bitcoin confirms
    await OpenTimestamps.stamp(detached);

    // Serialize the OTS proof to binary format
    const otsProof = detached.serializeToBytes();

    // Insert audit record
    const [result] = await connection.query(`
      INSERT INTO claim_link_audit (
        claim_link_id,
        snapshot_json,
        content_hash,
        ots_proof,
        status,
        finalized_by_user_id,
        finalized_at
      ) VALUES (?, ?, ?, ?, 'submitted', ?, NOW())
    `, [
      claimLinkId,
      canonicalJSON,
      hash,
      otsProof,
      userId
    ]);

    const auditId = result.insertId;

    // Optionally mark the claim_link as disabled (finalized)
    // Uncomment if you want finalized links to be excluded from active queries
    // await connection.query(
    //   'UPDATE claim_links SET disabled = 1 WHERE claim_link_id = ?',
    //   [claimLinkId]
    // );

    await connection.commit();

    return {
      audit_id: auditId,
      claim_link_id: claimLinkId,
      content_hash: hash,
      status: 'submitted',
      snapshot: snapshot,
      message: 'Claim link finalized and submitted to Bitcoin blockchain via OpenTimestamps'
    };

  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Verifies an OpenTimestamps proof against the Bitcoin blockchain
 * Updates the audit record with verification timestamp and block number
 *
 * @param {number} auditId - The audit_id to verify
 * @returns {Promise<Object>} Verification result
 */
export async function verifyTimestamp(auditId) {
  const connection = await pool.getConnection();

  try {
    // Fetch the audit record
    const [audits] = await connection.query(`
      SELECT
        audit_id,
        claim_link_id,
        snapshot_json,
        content_hash,
        ots_proof,
        status,
        finalized_at,
        verified_at,
        bitcoin_block
      FROM claim_link_audit
      WHERE audit_id = ?
    `, [auditId]);

    if (audits.length === 0) {
      throw new Error(`Audit record ${auditId} not found`);
    }

    const audit = audits[0];

    if (!audit.ots_proof) {
      throw new Error('No OTS proof found for this audit record');
    }

    // Deserialize the OTS proof
    const detached = OpenTimestamps.DetachedTimestampFile.deserialize(audit.ots_proof);

    // Attempt to upgrade the proof with Bitcoin confirmations
    // This queries OpenTimestamps calendars for blockchain confirmations
    const upgraded = await OpenTimestamps.upgrade(detached);

    if (!upgraded) {
      // Proof is not yet confirmed in Bitcoin blockchain
      return {
        audit_id: auditId,
        verified: false,
        status: 'pending',
        message: 'Timestamp not yet confirmed in Bitcoin blockchain. Typically takes 1-6 hours.'
      };
    }

    // Verify the proof
    const hashBuffer = Buffer.from(audit.content_hash, 'hex');
    const verifyResult = OpenTimestamps.verify(detached, hashBuffer);

    if (verifyResult === undefined) {
      return {
        audit_id: auditId,
        verified: false,
        status: 'pending',
        message: 'Timestamp verification in progress'
      };
    }

    // Extract Bitcoin block height from verification result
    let bitcoinBlock = null;
    if (verifyResult && verifyResult.timestamp) {
      // The timestamp contains attestations with block heights
      bitcoinBlock = extractBitcoinBlock(detached);
    }

    // Update audit record with verification data
    await connection.query(`
      UPDATE claim_link_audit
      SET
        status = 'verified',
        verified_at = NOW(),
        bitcoin_block = ?,
        ots_proof = ?
      WHERE audit_id = ?
    `, [
      bitcoinBlock,
      detached.serializeToBytes(),
      auditId
    ]);

    return {
      audit_id: auditId,
      verified: true,
      status: 'verified',
      bitcoin_block: bitcoinBlock,
      verified_at: new Date(),
      message: `Timestamp verified in Bitcoin block ${bitcoinBlock}`
    };

  } finally {
    connection.release();
  }
}

/**
 * Extracts Bitcoin block height from OTS proof attestations
 *
 * @param {Object} detached - OpenTimestamps DetachedTimestampFile
 * @returns {number|null} Bitcoin block height or null
 */
function extractBitcoinBlock(detached) {
  try {
    // Navigate the OTS proof tree to find Bitcoin attestations
    const timestamp = detached.timestamp;
    if (!timestamp || !timestamp.attestations) {
      return null;
    }

    for (const attestation of timestamp.attestations) {
      // Bitcoin attestations contain block height
      if (attestation.constructor.name === 'BitcoinBlockHeaderAttestation') {
        return attestation.height;
      }
    }

    // Recursively search through timestamp operations
    if (timestamp.ops) {
      for (const [op, nextTimestamp] of timestamp.ops.entries()) {
        const blockFromChild = extractBitcoinBlock({ timestamp: nextTimestamp });
        if (blockFromChild) {
          return blockFromChild;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error extracting Bitcoin block:', error);
    return null;
  }
}

/**
 * Retrieves audit record for a claim_link
 *
 * @param {number} claimLinkId - The claim_link_id
 * @returns {Promise<Object|null>} Audit record or null if not finalized
 */
export async function getAuditRecord(claimLinkId) {
  const connection = await pool.getConnection();

  try {
    const [audits] = await connection.query(`
      SELECT
        audit_id,
        claim_link_id,
        snapshot_json,
        content_hash,
        status,
        bitcoin_block,
        finalized_at,
        verified_at,
        finalized_by_user_id,
        (SELECT username FROM users WHERE user_id = finalized_by_user_id) as finalized_by_username
      FROM claim_link_audit
      WHERE claim_link_id = ?
    `, [claimLinkId]);

    if (audits.length === 0) {
      return null;
    }

    const audit = audits[0];

    return {
      audit_id: audit.audit_id,
      claim_link_id: audit.claim_link_id,
      snapshot: JSON.parse(audit.snapshot_json),
      content_hash: audit.content_hash,
      status: audit.status,
      bitcoin_block: audit.bitcoin_block,
      finalized_at: audit.finalized_at,
      verified_at: audit.verified_at,
      finalized_by: {
        user_id: audit.finalized_by_user_id,
        username: audit.finalized_by_username
      }
    };

  } finally {
    connection.release();
  }
}

/**
 * Gets all audit records with optional filtering
 *
 * @param {Object} options - Query options
 * @param {string} options.status - Filter by status: 'pending', 'submitted', 'verified'
 * @param {number} options.limit - Max records to return
 * @param {number} options.offset - Pagination offset
 * @returns {Promise<Array>} Array of audit records
 */
export async function getAuditRecords(options = {}) {
  const connection = await pool.getConnection();

  try {
    let query = `
      SELECT
        a.audit_id,
        a.claim_link_id,
        a.content_hash,
        a.status,
        a.bitcoin_block,
        a.finalized_at,
        a.verified_at,
        a.finalized_by_user_id,
        u.username as finalized_by_username,
        cl.source_claim_id,
        cl.target_claim_id
      FROM claim_link_audit a
      LEFT JOIN users u ON a.finalized_by_user_id = u.user_id
      LEFT JOIN claim_links cl ON a.claim_link_id = cl.claim_link_id
    `;

    const params = [];

    if (options.status) {
      query += ' WHERE a.status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY a.finalized_at DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const [audits] = await connection.query(query, params);

    return audits.map(audit => ({
      audit_id: audit.audit_id,
      claim_link_id: audit.claim_link_id,
      content_hash: audit.content_hash,
      status: audit.status,
      bitcoin_block: audit.bitcoin_block,
      finalized_at: audit.finalized_at,
      verified_at: audit.verified_at,
      finalized_by: {
        user_id: audit.finalized_by_user_id,
        username: audit.finalized_by_username
      },
      claim_link: {
        source_claim_id: audit.source_claim_id,
        target_claim_id: audit.target_claim_id
      }
    }));

  } finally {
    connection.release();
  }
}

/**
 * Downloads the OTS proof file for a given audit record
 *
 * @param {number} auditId - The audit_id
 * @returns {Promise<Buffer>} OTS proof file binary data
 */
export async function downloadOTSProof(auditId) {
  const connection = await pool.getConnection();

  try {
    const [audits] = await connection.query(
      'SELECT ots_proof FROM claim_link_audit WHERE audit_id = ?',
      [auditId]
    );

    if (audits.length === 0 || !audits[0].ots_proof) {
      throw new Error('OTS proof not found');
    }

    return audits[0].ots_proof;

  } finally {
    connection.release();
  }
}
