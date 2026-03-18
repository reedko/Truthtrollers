// backend/src/routes/content/content.incremental.routes.js
// ──────────────────────────────────────────────────────────────────
// INCREMENTAL EVIDENCE UPDATES
// Allows editing claims and only running evidence for new/changed claims
// ──────────────────────────────────────────────────────────────────

import { Router } from "express";
import crypto from "crypto";
import logger from "../../utils/logger.js";
import { persistClaims } from "../../storage/persistClaims.js";
import { runEvidenceEngine } from "../../core/runEvidenceEngine.js";
import { persistAIResults } from "../../storage/persistAIResults.js";
import { processTaskClaims } from "../../core/processTaskClaims.js";
import { matchClaimsToTaskClaims } from "../../core/matchClaims.js";
import { openAiLLM } from "../../core/openAiLLM.js";

/**
 * Generate a stable hash for a claim text (for change detection)
 */
function hashClaim(claimText) {
  return crypto
    .createHash('sha256')
    .update(claimText.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16); // 16 chars is enough for uniqueness
}

/**
 * Core incremental update logic (reusable)
 * Exported so it can be used by other routes (e.g., single-claim edit)
 */
export async function performIncrementalUpdate(query, contentId, newClaims, fullText = null) {
  logger.log(`\n${'='.repeat(80)}`);
  logger.log(`🔄 [Incremental Update] content_id=${contentId}`);
  logger.log(`   New claims: ${newClaims.length}`);
  logger.log(`${'='.repeat(80)}\n`);

  // -----------------------------------------------------------------
  // 1. Fetch existing claims for this content
  // -----------------------------------------------------------------
  const existingClaimsRows = await query(
    `SELECT c.claim_id, c.claim_text
     FROM content_claims cc
     JOIN claims c ON cc.claim_id = c.claim_id
     WHERE cc.content_id = ?
     AND cc.relationship_type IN ('task', 'content')
     ORDER BY cc.created_at ASC`,
    [contentId]
  );

  const existingClaims = existingClaimsRows.map(row => ({
    id: row.claim_id,
    text: row.claim_text,
    hash: hashClaim(row.claim_text)
  }));

  logger.log(`📋 [Incremental] Found ${existingClaims.length} existing claims`);

  // -----------------------------------------------------------------
  // 2. Compute diff: added, removed, unchanged
  // -----------------------------------------------------------------
  const newClaimsWithHash = newClaims.map(text => ({
    text: text.trim(),
    hash: hashClaim(text)
  }));

  const existingHashSet = new Set(existingClaims.map(c => c.hash));
  const newHashSet = new Set(newClaimsWithHash.map(c => c.hash));

  // Added: in new but not in existing
  const addedClaims = newClaimsWithHash.filter(c => !existingHashSet.has(c.hash));

  // Removed: in existing but not in new
  const removedClaims = existingClaims.filter(c => !newHashSet.has(c.hash));

  // Unchanged: in both
  const unchangedClaims = existingClaims.filter(c => newHashSet.has(c.hash));

  logger.log(`\n📊 [Incremental] Diff summary:`);
  logger.log(`   ✅ Added: ${addedClaims.length} claims`);
  logger.log(`   ❌ Removed: ${removedClaims.length} claims`);
  logger.log(`   ⏺️  Unchanged: ${unchangedClaims.length} claims\n`);

  // -----------------------------------------------------------------
  // 3. Remove deleted claims (and their evidence)
  // -----------------------------------------------------------------
  if (removedClaims.length > 0) {
    logger.log(`🗑️  [Incremental] Removing ${removedClaims.length} claims...`);

    const removedClaimIds = removedClaims.map(c => c.id);

    // Delete reference_claim_task_links (evidence links)
    await query(
      `DELETE FROM reference_claim_task_links WHERE task_claim_id IN (?)`,
      [removedClaimIds]
    );

    // Delete content_claims junction
    await query(
      `DELETE FROM content_claims WHERE claim_id IN (?) AND content_id = ?`,
      [removedClaimIds, contentId]
    );

    // Delete claims themselves (if not used by other content)
    for (const claimId of removedClaimIds) {
      const usageCheck = await query(
        `SELECT COUNT(*) as count FROM content_claims WHERE claim_id = ?`,
        [claimId]
      );
      if (usageCheck[0].count === 0) {
        await query(`DELETE FROM claims WHERE claim_id = ?`, [claimId]);
      }
    }

    logger.log(`✅ [Incremental] Removed ${removedClaims.length} claims and their evidence`);
  }

  // -----------------------------------------------------------------
  // 4. Add new claims (and persist them)
  // -----------------------------------------------------------------
  let newClaimIds = [];
  if (addedClaims.length > 0) {
    logger.log(`➕ [Incremental] Adding ${addedClaims.length} new claims...`);

    newClaimIds = await persistClaims(
      query,
      contentId,
      addedClaims.map(c => c.text),
      "task", // relationshipType
      "task"  // claimType
    );

    logger.log(`✅ [Incremental] Added ${newClaimIds.length} new claims`);
  }

  // -----------------------------------------------------------------
  // 5. Run evidence engine ONLY for new claims (if any)
  // -----------------------------------------------------------------
  let evidenceResults = null;
  if (newClaimIds.length > 0) {
    logger.log(`\n🔍 [Incremental] Running evidence engine for ${newClaimIds.length} NEW claims only...`);

    // Get text for evidence engine (use provided fullText or fetch from DB)
    let readableText = fullText;
    if (!readableText) {
      const contentRow = await query(
        `SELECT details FROM content WHERE content_id = ?`,
        [contentId]
      );
      readableText = contentRow[0]?.details || "";
    }

    // Run evidence engine for NEW claims only
    const { aiReferences, failedCandidates, claimConfidenceMap } = await runEvidenceEngine({
      taskContentId: contentId,
      claimIds: newClaimIds,
      readableText,
    });

    logger.log(`✅ [Incremental] Evidence engine found ${aiReferences.length} references for new claims`);

    // Persist AI results (evidence links)
    const aiRefs = await persistAIResults(query, {
      contentId: contentId,
      evidenceRefs: aiReferences,
      claimIds: newClaimIds,
      claimConfidenceMap,
    });

    // -----------------------------------------------------------------
    // 6. Process references (extract claims and match)
    // -----------------------------------------------------------------
    const validReferences = aiReferences.filter((ref) => {
      if (!ref.referenceContentId) return false;
      if (ref.referenceContentId === contentId) return false;
      if (ref.cleanText && ref.cleanText.length < 500) return false;
      return true;
    });

    logger.log(`🔄 [Incremental] Processing ${validReferences.length} references in batches of 3`);

    // Get ALL task claims (for context when extracting reference claims)
    const allTaskClaimsRows = await query(
      `SELECT c.claim_id, c.claim_text
       FROM content_claims cc
       JOIN claims c ON cc.claim_id = c.claim_id
       WHERE cc.content_id = ?
       AND cc.relationship_type IN ('task', 'content')`,
      [contentId]
    );
    const allTaskClaims = allTaskClaimsRows.map(row => ({
      id: row.claim_id,
      text: row.claim_text
    }));

    // Process references in batches of 3
    const BATCH_SIZE = 3;
    let processedSuccessfully = 0;

    const processReference = async (ref) => {
      try {
        // Create snippet claim
        if (ref.quote) {
          await persistClaims(
            query,
            ref.referenceContentId,
            [ref.quote],
            "snippet",
            "snippet"
          );
        }

        // Extract reference claims
        if (ref.cleanText) {
          const extractedClaims = await processTaskClaims({
            query,
            taskContentId: ref.referenceContentId,
            text: ref.cleanText,
            claimType: "reference",
            taskClaimsContext: allTaskClaims.map((c) => c.text),
          });

          // Match reference claims to ALL task claims (including old ones)
          if (extractedClaims.length > 0) {
            const claimMatches = await matchClaimsToTaskClaims({
              referenceClaims: extractedClaims,
              taskClaims: allTaskClaims,
              llm: openAiLLM
            });

            // Batch insert matches
            if (claimMatches.length > 0) {
              const values = claimMatches.map(match => {
                let mappedStance = match.stance;
                if (match.stance === 'supports') mappedStance = 'support';
                else if (match.stance === 'refutes') mappedStance = 'refute';
                else if (match.stance === 'related') mappedStance = 'nuance';

                return [
                  match.referenceClaimId,
                  match.taskClaimId,
                  mappedStance,
                  Math.round((match.veracityScore || 0.5) * 100),
                  match.confidence,
                  match.supportLevel,
                  match.rationale,
                  null,
                  1
                ];
              });

              const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
              const flatValues = values.flat();

              await query(
                `INSERT INTO reference_claim_task_links
                 (reference_claim_id, task_claim_id, stance, score, confidence, support_level, rationale, quote, created_by_ai)
                 VALUES ${placeholders}`,
                flatValues
              );
            }
          }
        }

        processedSuccessfully++;
        return { success: true };
      } catch (err) {
        logger.error(`❌ [Incremental] Failed to process reference ${ref.referenceContentId}:`, err.message);
        return { success: false, error: err.message };
      }
    };

    // Process in batches
    for (let i = 0; i < validReferences.length; i += BATCH_SIZE) {
      const batch = validReferences.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(ref => processReference(ref)));
    }

    logger.log(`✅ [Incremental] Processed ${processedSuccessfully} references`);

    evidenceResults = {
      referencesFound: aiReferences.length,
      referencesProcessed: processedSuccessfully,
      failedCandidates: failedCandidates || []
    };
  } else {
    logger.log(`⏭️  [Incremental] No new claims - skipping evidence engine`);
  }

  logger.log(`\n${'='.repeat(80)}`);
  logger.log(`✅ [Incremental] Update complete`);
  logger.log(`${'='.repeat(80)}\n`);

  return {
    success: true,
    summary: {
      added: addedClaims.length,
      removed: removedClaims.length,
      unchanged: unchangedClaims.length,
      total: newClaims.length
    },
    addedClaims: addedClaims.map(c => c.text),
    removedClaims: removedClaims.map(c => c.text),
    unchangedClaims: unchangedClaims.map(c => c.text),
    evidenceRun: newClaimIds.length > 0,
    evidence: evidenceResults
  };
}

export default function createContentIncrementalRoutes({ query }) {
  const router = Router();

  /**
   * POST /api/content/:id/update-claims
   *
   * Update claims for existing content and run evidence only for new/changed claims
   *
   * Body:
   * {
   *   claims: ["claim 1", "claim 2", ...],  // New/edited list of claims
   *   fullText: "original article text..."   // Optional: if article text changed too
   * }
   *
   * Returns:
   * {
   *   added: [...],      // New claims that were added
   *   updated: [...],    // Claims that were modified
   *   removed: [...],    // Claims that were deleted
   *   unchanged: [...],  // Claims that didn't change
   *   evidenceRun: true  // Whether evidence engine was run
   * }
   */
  router.post("/api/content/:id/update-claims", async (req, res) => {
    const contentId = parseInt(req.params.id);
    const { claims: newClaims, fullText } = req.body;

    if (!contentId || isNaN(contentId)) {
      return res.status(400).json({ error: "Invalid content ID" });
    }

    if (!Array.isArray(newClaims)) {
      return res.status(400).json({ error: "Claims must be an array" });
    }

    try {
      const result = await performIncrementalUpdate(query, contentId, newClaims, fullText);
      return res.json(result);
    } catch (err) {
      logger.error("❌ Error in /api/content/:id/update-claims:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Internal server error"
      });
    }
  });

  return router;
}
