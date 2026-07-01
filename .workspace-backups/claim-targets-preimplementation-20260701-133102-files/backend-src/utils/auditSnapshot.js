/**
 * Audit Snapshot Utility
 *
 * Creates canonical JSON snapshots of claim_link records for blockchain timestamping.
 * Generates deterministic, order-independent JSON that produces consistent SHA-256 hashes.
 */

import crypto from 'crypto';
import { pool } from '../db/pool.js';

async function getClaimContentMetadata(connection, claimIds) {
  const normalizedClaimIds = [...new Set(claimIds.filter(Boolean).map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0);

  if (normalizedClaimIds.length === 0) {
    return {};
  }

  const placeholders = normalizedClaimIds.map(() => '?').join(',');
  const [rows] = await connection.query(`
    SELECT
      cc.claim_id,
      cc.content_id,
      cc.relationship_type,
      cc.claim_role,
      cc.claim_depth,
      cc.claim_order,
      c.content_name,
      c.url,
      c.media_source,
      c.content_type,
      GROUP_CONCAT(DISTINCT p.publisher_name ORDER BY p.publisher_name SEPARATOR '; ') AS publishers,
      GROUP_CONCAT(
        DISTINCT NULLIF(TRIM(CONCAT(IFNULL(a.author_first_name, ''), ' ', IFNULL(a.author_last_name, ''))), '')
        ORDER BY a.author_first_name, a.author_last_name
        SEPARATOR '; '
      ) AS authors
    FROM content_claims cc
    LEFT JOIN content c
      ON cc.content_id = c.content_id
    LEFT JOIN content_publishers cp
      ON cc.content_id = cp.content_id
    LEFT JOIN publishers p
      ON cp.publisher_id = p.publisher_id
    LEFT JOIN content_authors ca
      ON cc.content_id = ca.content_id
    LEFT JOIN authors a
      ON ca.author_id = a.author_id
    WHERE cc.claim_id IN (${placeholders})
    GROUP BY
      cc.claim_id,
      cc.content_id,
      cc.relationship_type,
      cc.claim_role,
      cc.claim_depth,
      cc.claim_order,
      c.content_name,
      c.url,
      c.media_source,
      c.content_type
    ORDER BY cc.claim_id, cc.content_id
  `, normalizedClaimIds);

  return rows.reduce((acc, row) => {
    if (!acc[row.claim_id]) acc[row.claim_id] = [];
    acc[row.claim_id].push({
      content_id: row.content_id,
      content_name: row.content_name,
      url: row.url,
      media_source: row.media_source,
      content_type: row.content_type,
      relationship_type: row.relationship_type,
      claim_role: row.claim_role,
      claim_depth: row.claim_depth,
      claim_order: row.claim_order,
      publishers: row.publishers ? row.publishers.split('; ') : [],
      authors: row.authors ? row.authors.split('; ') : []
    });
    return acc;
  }, {});
}

/**
 * Creates a canonical JSON snapshot of a claim_link and its related data
 *
 * @param {number} claimLinkId - The claim_link_id to snapshot
 * @returns {Promise<Object>} Canonical snapshot object
 */
export async function createClaimLinkSnapshot(claimLinkId) {
  const connection = await pool.getConnection();

  try {
    // Fetch the claim_link with all relevant data
    const [claimLinks] = await connection.query(`
      SELECT
        cl.claim_link_id,
        cl.source_claim_id,
        cl.target_claim_id,
        cl.user_id,
        cl.support_level,
        cl.veracity_score,
        cl.confidence,
        cl.created_by_ai,
        cl.points_earned,
        cl.disabled,
        cl.created_at,

        -- Source claim data
        sc.claim_text as source_claim_text,
        sc.veracity_score as source_veracity_score,
        sc.confidence_level as source_confidence_level,

        -- Target claim data
        tc.claim_text as target_claim_text,
        tc.veracity_score as target_veracity_score,
        tc.confidence_level as target_confidence_level,

        -- User who created the link (if manual)
        u.username,
        u.email

      FROM claim_links cl
      LEFT JOIN claims sc ON cl.source_claim_id = sc.claim_id
      LEFT JOIN claims tc ON cl.target_claim_id = tc.claim_id
      LEFT JOIN users u ON cl.user_id = u.user_id
      WHERE cl.claim_link_id = ?
    `, [claimLinkId]);

    if (claimLinks.length === 0) {
      throw new Error(`Claim link ${claimLinkId} not found`);
    }

    const claimLink = claimLinks[0];
    const contentMetadata = await getClaimContentMetadata(connection, [
      claimLink.source_claim_id,
      claimLink.target_claim_id
    ]);

    // Create canonical snapshot with sorted keys
    // This ensures the same data always produces the same JSON string
    const snapshot = {
      audit_version: '1.1',
      timestamp: new Date().toISOString(),

      claim_link: {
        claim_link_id: claimLink.claim_link_id,
        source_claim_id: claimLink.source_claim_id,
        target_claim_id: claimLink.target_claim_id,
        support_level: claimLink.support_level,
        veracity_score: claimLink.veracity_score ? parseFloat(claimLink.veracity_score) : null,
        confidence: claimLink.confidence ? parseFloat(claimLink.confidence) : null,
        created_by_ai: Boolean(claimLink.created_by_ai),
        points_earned: claimLink.points_earned ? parseFloat(claimLink.points_earned) : null,
        disabled: Boolean(claimLink.disabled),
        created_at: claimLink.created_at ? claimLink.created_at.toISOString() : null,
        user_id: claimLink.user_id,
        username: claimLink.username || null,
        user_email: claimLink.email || null
      },

      source_claim: {
        claim_id: claimLink.source_claim_id,
        claim_text: claimLink.source_claim_text,
        veracity_score: claimLink.source_veracity_score ? parseFloat(claimLink.source_veracity_score) : null,
        confidence_level: claimLink.source_confidence_level,
        content_sources: contentMetadata[claimLink.source_claim_id] || []
      },

      target_claim: {
        claim_id: claimLink.target_claim_id,
        claim_text: claimLink.target_claim_text,
        veracity_score: claimLink.target_veracity_score ? parseFloat(claimLink.target_veracity_score) : null,
        confidence_level: claimLink.target_confidence_level,
        content_sources: contentMetadata[claimLink.target_claim_id] || []
      }
    };

    return snapshot;

  } finally {
    connection.release();
  }
}

/**
 * Converts an object to canonical JSON string
 * Sorts all keys recursively to ensure deterministic output
 *
 * @param {Object} obj - Object to canonicalize
 * @returns {string} Canonical JSON string
 */
export function toCanonicalJSON(obj) {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }

  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(item => toCanonicalJSON(item)).join(',') + ']';
  }

  // Sort object keys alphabetically
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => {
    return JSON.stringify(key) + ':' + toCanonicalJSON(obj[key]);
  });

  return '{' + pairs.join(',') + '}';
}

/**
 * Generates SHA-256 hash of canonical JSON
 *
 * @param {string} canonicalJSON - Canonical JSON string
 * @returns {string} Hex-encoded SHA-256 hash
 */
export function generateHash(canonicalJSON) {
  return crypto
    .createHash('sha256')
    .update(canonicalJSON, 'utf8')
    .digest('hex');
}

/**
 * Creates a complete audit snapshot with hash
 *
 * @param {number} claimLinkId - The claim_link_id to snapshot
 * @returns {Promise<{snapshot: Object, canonicalJSON: string, hash: string}>}
 */
export async function createAuditSnapshot(claimLinkId) {
  const snapshot = await createClaimLinkSnapshot(claimLinkId);
  const canonicalJSON = toCanonicalJSON(snapshot);
  const hash = generateHash(canonicalJSON);

  return {
    snapshot,
    canonicalJSON,
    hash
  };
}

/**
 * Verifies that a snapshot matches its claimed hash
 *
 * @param {Object} snapshot - The snapshot object
 * @param {string} claimedHash - The hash to verify against
 * @returns {boolean} True if hash matches
 */
export function verifySnapshotHash(snapshot, claimedHash) {
  const canonicalJSON = toCanonicalJSON(snapshot);
  const computedHash = generateHash(canonicalJSON);
  return computedHash === claimedHash;
}
