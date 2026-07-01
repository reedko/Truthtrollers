/**
 * Audit Routes
 *
 * API endpoints for blockchain timestamping and audit trail verification
 */

import { Router } from 'express';
import {
  finalizeClaimLink,
  verifyTimestamp,
  getAuditRecord,
  getAuditRecords,
  downloadOTSProof
} from '../../services/timestampService.js';
import { authenticateToken } from '../../middleware/auth.js';

export default function createAuditRouter({ query, pool }) {
  const router = Router();

/**
 * POST /api/audit/finalize/:claimLinkId
 * Finalizes a claim_link and submits it to OpenTimestamps for Bitcoin anchoring
 *
 * Requires authentication
 */
router.post('/finalize/:claimLinkId', authenticateToken, async (req, res) => {
  try {
    const claimLinkId = parseInt(req.params.claimLinkId);
    const userId = req.user.user_id;

    if (isNaN(claimLinkId)) {
      return res.status(400).json({ error: 'Invalid claim_link_id' });
    }

    const result = await finalizeClaimLink(claimLinkId, userId);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error finalizing claim link:', error);
    res.status(500).json({
      error: error.message || 'Failed to finalize claim link'
    });
  }
});

/**
 * GET /api/audit/verify/:auditId
 * Verifies an OpenTimestamps proof against the Bitcoin blockchain
 *
 * Public endpoint - verification is cryptographically verifiable by anyone
 */
router.get('/verify/:auditId', async (req, res) => {
  try {
    const auditId = parseInt(req.params.auditId);

    if (isNaN(auditId)) {
      return res.status(400).json({ error: 'Invalid audit_id' });
    }

    const result = await verifyTimestamp(auditId);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error verifying timestamp:', error);
    res.status(500).json({
      error: error.message || 'Failed to verify timestamp'
    });
  }
});

/**
 * GET /api/audit/claim-link/:claimLinkId
 * Retrieves audit record for a specific claim_link
 *
 * Public endpoint - audit records are publicly verifiable
 */
router.get('/claim-link/:claimLinkId', async (req, res) => {
  try {
    const claimLinkId = parseInt(req.params.claimLinkId);

    if (isNaN(claimLinkId)) {
      return res.status(400).json({ error: 'Invalid claim_link_id' });
    }

    const audit = await getAuditRecord(claimLinkId);

    if (!audit) {
      return res.status(404).json({
        error: 'No audit record found for this claim link'
      });
    }

    res.json({
      success: true,
      data: audit
    });

  } catch (error) {
    console.error('Error fetching audit record:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch audit record'
    });
  }
});

/**
 * GET /api/audit/records
 * Retrieves all audit records with optional filtering
 *
 * Query params:
 *   - status: Filter by status (pending, submitted, verified)
 *   - limit: Max records to return (default 50)
 *   - offset: Pagination offset (default 0)
 *
 * Public endpoint
 */
router.get('/records', async (req, res) => {
  try {
    const options = {
      status: req.query.status,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0
    };

    // Validate status if provided
    if (options.status && !['pending', 'submitted', 'verified'].includes(options.status)) {
      return res.status(400).json({
        error: 'Invalid status. Must be: pending, submitted, or verified'
      });
    }

    const audits = await getAuditRecords(options);

    res.json({
      success: true,
      data: audits,
      meta: {
        limit: options.limit,
        offset: options.offset,
        count: audits.length
      }
    });

  } catch (error) {
    console.error('Error fetching audit records:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch audit records'
    });
  }
});

/**
 * GET /api/audit/download-proof/:auditId
 * Downloads the OpenTimestamps .ots proof file
 *
 * Public endpoint - proof files can be independently verified using OTS tools
 */
router.get('/download-proof/:auditId', async (req, res) => {
  try {
    const auditId = parseInt(req.params.auditId);

    if (isNaN(auditId)) {
      return res.status(400).json({ error: 'Invalid audit_id' });
    }

    const otsProof = await downloadOTSProof(auditId);

    // Set headers for binary file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="claim_link_${auditId}.ots"`);

    res.send(otsProof);

  } catch (error) {
    console.error('Error downloading OTS proof:', error);
    res.status(500).json({
      error: error.message || 'Failed to download proof'
    });
  }
});

  return router;
}
