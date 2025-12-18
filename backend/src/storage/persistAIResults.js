// backend/src/storage/persistAIResults.js
// Processes AI references that were ALREADY created during evidence fetch.
// Creates reference_claim_links to connect task claims to references.

import logger from "../utils/logger.js";

export async function persistAIResults(
  query,
  { contentId, evidenceRefs = [], claimIds = [], claimConfidenceMap = new Map() }
) {
  if (!contentId || !Array.isArray(evidenceRefs)) return [];

  const saved = [];

  for (const ref of evidenceRefs) {
    if (!ref.url || !ref.referenceContentId) {
      logger.warn(`⚠️  [persistAIResults] Skipping reference missing url or contentId`);
      continue;
    }

    const referenceContentId = ref.referenceContentId;
    const stance = ref.stance || "insufficient";
    const why = ref.why || ref.summary || ref.quote || null;
    const quote = ref.quote || null;
    const quality = ref.quality || 0;

    logger.log(
      `🔍 [persistAIResults] Processing ref ${referenceContentId}: quality=${quality}, score=${Math.round(quality * 100)}, claims=${ref.claims?.length || 0}`
    );

    // Convert claim indices to actual claim IDs + get confidence for each
    const taskClaimIds = [];
    const claimIndexToConfidence = new Map(); // claimId → confidence
    if (Array.isArray(ref.claims)) {
      for (const idx of ref.claims) {
        const claimId = claimIds[idx];
        if (claimId) {
          taskClaimIds.push(claimId);
          // Get confidence for this claim from the map
          const confidence = claimConfidenceMap.get(idx);
          if (confidence !== undefined) {
            claimIndexToConfidence.set(claimId, confidence);
          }
        }
      }
    }

    // Create reference_claim_links for each task claim
    if (taskClaimIds.length > 0) {
      const linksToInsert = taskClaimIds.map((taskClaimId) => {
        const conf = claimIndexToConfidence.get(taskClaimId) || 0;

        // Calculate support_level: stance_multiplier * confidence * quality
        const stanceMultiplier = {
          'support': 1.0,
          'refute': -1.0,
          'nuance': 0.5,
          'insufficient': 0.0
        }[stance] || 0;

        const supportLevel = stanceMultiplier * conf * quality;

        return {
          claim_id: taskClaimId,
          reference_content_id: referenceContentId,
          stance,
          score: Math.round(quality * 100),
          confidence: conf || null,
          support_level: supportLevel,
          rationale: why,
          evidence_text: quote,
          evidence_offsets: ref.location ? JSON.stringify(ref.location) : null,
          created_by_ai: 1,
          verified_by_user_id: null,
          scrape_status: ref.scrapeStatus || "full", // Pass through scrape status
        };
      });

      // Bulk insert reference_claim_links
      for (const link of linksToInsert) {
        try {
          await query(
            `INSERT INTO reference_claim_links
             (claim_id, reference_content_id, stance, score, confidence, support_level, rationale, evidence_text, evidence_offsets, created_by_ai, verified_by_user_id, scrape_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              link.claim_id,
              link.reference_content_id,
              link.stance,
              link.score,
              link.confidence,
              link.support_level,
              link.rationale,
              link.evidence_text,
              link.evidence_offsets,
              link.created_by_ai,
              link.verified_by_user_id,
              link.scrape_status || "full", // Default to "full" if not specified
            ]
          );
        } catch (err) {
          logger.warn(
            `⚠️  [persistAIResults] Failed to insert reference_claim_link for claim ${link.claim_id}:`,
            err.message
          );
        }
      }

      const avgConfidence = linksToInsert.reduce((sum, link) => sum + (link.confidence || 0), 0) / linksToInsert.length;
      const avgSupportLevel = linksToInsert.reduce((sum, link) => sum + (link.support_level || 0), 0) / linksToInsert.length;
      logger.log(
        `✅ [persistAIResults] Created ${linksToInsert.length} reference_claim_links for reference ${referenceContentId} ` +
        `(avg confidence: ${avgConfidence.toFixed(4)}, avg support_level: ${avgSupportLevel.toFixed(4)})`
      );
    }

    // Return metadata for response
    saved.push({
      referenceContentId,
      url: ref.url,
      content_name: ref.title || "AI Reference",
      claimIds: taskClaimIds,
      stance,
      quote,
      summary: why,
    });
  }

  logger.log(
    `💾 [persistAIResults] Processed ${saved.length} AI references (already created during evidence fetch)`
  );

  return saved;
}
