// backend/src/core/processTaskClaims.js
// -------------------------------------------------------------
// Extract CLAIMS (LLM) → persist via persistClaims() → return
// -------------------------------------------------------------

import { ClaimExtractor } from "./claimsEngine.js";
import { openAiLLM } from "./openAiLLM.js";
import { persistClaims } from "../storage/persistClaims.js";
import logger from "../utils/logger.js";

// ========================================
// CLAIM EXTRACTION MODE TOGGLE
// ========================================
// 'ranked': Extract 3-9 high-quality claims only (single LLM pass, efficient)
// 'comprehensive': Extract all claims, then filter separately (for user ranking UI)
const EXTRACTION_MODE = 'ranked';

/**
 * processTaskClaims({
 *    query,
 *    taskContentId,
 *    text,
 *    claimType = 'task'
 * })
 *
 * Returns:
 *    [{ id: claimId, text }]
 */
export async function processTaskClaims({ query, taskContentId, text, claimType = 'task', taskClaimsContext = null }) {
  logger.log("🟩 [processTaskClaims] Extracting + storing claims…");
  if (taskClaimsContext && taskClaimsContext.length > 0) {
    logger.log(`📋 [processTaskClaims] Context-aware mode: ${taskClaimsContext.length} task claims provided:`);
    taskClaimsContext.forEach((claim, i) => {
      logger.log(`   ${i + 1}. "${claim.substring(0, 80)}${claim.length > 80 ? '...' : ''}"`);
    });
  } else {
    logger.log(`📋 [processTaskClaims] Standard mode: no task claims context`);
  }

  if (!query) throw new Error("processTaskClaims: missing query");
  if (!taskContentId)
    throw new Error("processTaskClaims: missing taskContentId");

  if (!text || !text.trim()) {
    logger.warn("⚠️ [processTaskClaims] Empty text, skipping claims.");
    return [];
  }

  // -----------------------------------------------------
  // 1. Claim extraction (LLM)
  // -----------------------------------------------------
  const extractor = new ClaimExtractor(openAiLLM, query);

  logger.log(`🟩 [processTaskClaims] Using extraction mode: ${EXTRACTION_MODE}`);

  const extraction = await extractor.analyzeContent({
    chunks: [{ text, tokenLength: Math.round(text.length / 4) }],
    existingTestimonials: [],
    maxConcurrency: 1,
    extractionMode: EXTRACTION_MODE,
    taskClaimsContext,
  });

  let claims = extraction.claims || [];
  logger.log(`🟩 Extracted ${claims.length} claims`);

  if (claims.length === 0) return [];

  // -----------------------------------------------------
  // 1.5. Filter and rank claims (ONLY in comprehensive mode)
  // In ranked mode, filtering already happened during extraction
  // -----------------------------------------------------
  if (EXTRACTION_MODE === 'comprehensive') {
    logger.log(`🟦 [ClaimFiltering] Scoring and filtering claims...`);
    claims = await extractor.filterAndRankClaims(
      claims,
      5,      // maxClaims: keep top 5
      0.6     // threshold: claims must score ≥ 0.6 average
    );

    logger.log(`🟦 [ClaimFiltering] Filtered to ${claims.length} high-value claims`);

    if (claims.length === 0) {
      logger.warn(`⚠️ [ClaimFiltering] No claims passed quality threshold!`);
      return [];
    }
  } else {
    logger.log(`🟦 [ClaimFiltering] Skipping separate filter (ranked mode already filtered)`);
  }

  // -----------------------------------------------------
  // 2. Persist claims (batch)
  // persistClaims(query, contentId, claimsArray, relationshipType, claimType)
  // returns array of new claimIds
  // -----------------------------------------------------
  const claimIds = await persistClaims(query, taskContentId, claims, claimType, claimType);

  if (!Array.isArray(claimIds)) {
    throw new Error("persistClaims returned invalid claimIds");
  }

  // -----------------------------------------------------
  // 3. Return [{ id, text }]
  // -----------------------------------------------------
  const result = claimIds.map((id, i) => ({
    id,
    text: claims[i],
  }));

  logger.log(
    `🟩 [processTaskClaims] Persisted ${result.length} claims for content ${taskContentId}`
  );

  return result;
}
