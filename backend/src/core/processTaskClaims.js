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
// 'ranked': Extract 3-12 high-quality claims only (single LLM pass, efficient)
// 'comprehensive': Extract all claims, then filter separately (for user ranking UI)
const EXTRACTION_MODE = 'ranked'; // Use ranked mode for faster processing (1 LLM call vs 2)

/**
 * processTaskClaims({
 *    query,
 *    taskContentId,
 *    text,
 *    claimType = 'task',
 *    taskClaimsContext = null,
 *    clearOldLinks = false
 * })
 *
 * @param clearOldLinks - If true, clear existing content_claims links before persisting (for re-scraping)
 *
 * Returns:
 *    [{ id: claimId, text }]
 */
export async function processTaskClaims({ query, taskContentId, text, claimType = 'task', taskClaimsContext = null, clearOldLinks = false }) {
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

  logger.log(`📝 [processTaskClaims] Text length: ${text.length} chars, first 300 chars: "${text.substring(0, 300).replace(/\s+/g, ' ')}..."`);


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

  if (claims.length === 0) {
    logger.warn(`⚠️ [processTaskClaims] No claims extracted! This may indicate:`);
    logger.warn(`   - The article text is too technical/scientific for claim extraction`);
    logger.warn(`   - The LLM failed to find verifiable factual claims`);
    logger.warn(`   - The text extraction captured non-content areas`);
    logger.warn(`   Text sample (first 500 chars): "${text.substring(0, 500).replace(/\s+/g, ' ')}"`);
    return [];
  }

  // -----------------------------------------------------
  // 1.5. Filter and rank claims (ONLY in comprehensive mode)
  // In ranked mode, filtering already happened during extraction
  // -----------------------------------------------------
  if (EXTRACTION_MODE === 'comprehensive') {
    logger.log(`🟦 [ClaimFiltering] Scoring and filtering claims...`);
    claims = await extractor.filterAndRankClaims(
      claims,
      10,     // maxClaims: keep top 10 (increased from 5 for more coverage)
      0.4     // threshold: claims must score ≥ 0.4 average (lowered from 0.6 to be more permissive)
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
  // persistClaims(query, contentId, claimsArray, relationshipType, claimType, clearOldLinks)
  // returns array of new claimIds
  // -----------------------------------------------------
  const claimIds = await persistClaims(query, taskContentId, claims, claimType, claimType, clearOldLinks);

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
