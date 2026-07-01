// backend/src/routes/claims/claims.edit.routes.js
// ──────────────────────────────────────────────────────────────────
// SINGLE CLAIM EDITING WITH EVIDENCE RE-RUN
// Wrapper around incremental update system for editing individual claims
// ──────────────────────────────────────────────────────────────────

import { Router } from "express";
import logger from "../../utils/logger.js";
import { performIncrementalUpdate } from "../content/content.incremental.routes.js";

export default function createClaimEditRoutes({ query, pool }) {
  const router = Router();

  /**
   * PUT /api/claims/:claimId/edit
   *
   * Edit a single claim and optionally re-run evidence for it
   *
   * Body:
   * {
   *   newText: "Updated claim text",
   *   runEvidence: true,  // Whether to re-run evidence engine
   *   userId: 123         // User making the edit (for tracking)
   * }
   *
   * Returns:
   * {
   *   success: true,
   *   claim: { claim_id, claim_text, ... },
   *   evidenceRun: true,
   *   summary: { added: 0, removed: 1, ... }
   * }
   */
  router.put("/api/claims/:claimId/edit", async (req, res) => {
    const claimId = parseInt(req.params.claimId);
    const { newText, runEvidence = true, userId } = req.body;

    if (!claimId || isNaN(claimId)) {
      return res.status(400).json({ error: "Invalid claim ID" });
    }

    if (!newText || typeof newText !== "string") {
      return res.status(400).json({ error: "newText is required and must be a string" });
    }

    try {
      logger.log(`\n${'='.repeat(80)}`);
      logger.log(`✏️  [/api/claims/${claimId}/edit] EDIT CLAIM`);
      logger.log(`   New text: "${newText.substring(0, 60)}${newText.length > 60 ? '...' : ''}"`);
      logger.log(`   Run evidence: ${runEvidence}`);
      logger.log(`   User: ${userId || 'unknown'}`);
      logger.log(`${'='.repeat(80)}\n`);

      // -----------------------------------------------------------------
      // 1. Get content_id and all claims for this content
      // -----------------------------------------------------------------
      const claimRows = await query(
        `SELECT cc.content_id, c.claim_text, c.claim_id
         FROM content_claims cc
         JOIN claims c ON cc.claim_id = c.claim_id
         WHERE cc.content_id = (
           SELECT content_id FROM content_claims WHERE claim_id = ? LIMIT 1
         )
         AND cc.relationship_type IN ('task', 'content')
         ORDER BY cc.created_at ASC`,
        [claimId]
      );

      if (claimRows.length === 0) {
        return res.status(404).json({ error: "Claim not found" });
      }

      const contentId = claimRows[0].content_id;
      logger.log(`📋 [Edit] Found ${claimRows.length} claims for content_id=${contentId}`);

      // -----------------------------------------------------------------
      // 2. Build updated claims array (replace the edited claim)
      // -----------------------------------------------------------------
      const updatedClaims = claimRows.map(row =>
        row.claim_id === claimId ? newText : row.claim_text
      );

      logger.log(`🔄 [Edit] Replacing claim_id=${claimId} with new text`);

      // -----------------------------------------------------------------
      // 3. Call incremental update endpoint logic
      // -----------------------------------------------------------------
      if (!runEvidence) {
        // Just update the claim text directly (no evidence re-run)
        logger.log(`⏭️  [Edit] Skipping evidence re-run (runEvidence=false)`);

        await query(
          `UPDATE claims SET claim_text = ? WHERE claim_id = ?`,
          [newText, claimId]
        );

        const updatedClaim = await query(
          `SELECT * FROM claims WHERE claim_id = ?`,
          [claimId]
        );

        logger.log(`✅ [Edit] Updated claim text only\n`);

        return res.json({
          success: true,
          claim: updatedClaim[0],
          evidenceRun: false,
          summary: {
            added: 0,
            removed: 0,
            unchanged: claimRows.length,
            total: claimRows.length
          }
        });
      }

      // -----------------------------------------------------------------
      // 4. Use incremental update system (runs evidence for changes)
      // -----------------------------------------------------------------
      logger.log(`🔍 [Edit] Running incremental update with evidence...`);

      // Call the incremental update logic
      const result = await performIncrementalUpdate(query, contentId, updatedClaims);

      logger.log(`✅ [Edit] Incremental update complete`);
      logger.log(`${'='.repeat(80)}\n`);

      return res.json({
        success: true,
        claim: {
          claim_id: claimId,
          claim_text: newText
        },
        evidenceRun: true,
        summary: result.summary,
        evidence: result.evidence
      });

    } catch (err) {
      logger.error("❌ Error in /api/claims/:claimId/edit:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Internal server error"
      });
    }
  });

  return router;
}
