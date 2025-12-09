// backend/src/core/processTaskClaims.js
// -------------------------------------------------------------
// Extract CLAIMS (LLM) → persist via persistClaims() → return
// -------------------------------------------------------------

import { ClaimExtractor } from "./claimsEngine.js";
import { openAiLLM } from "./openAiLLM.js";
import { persistClaims } from "../storage/persistClaims.js";

/**
 * processTaskClaims({
 *    query,
 *    taskContentId,
 *    text
 * })
 *
 * Returns:
 *    [{ id: claimId, text }]
 */
export async function processTaskClaims({ query, taskContentId, text }) {
  console.log("🟩 [processTaskClaims] Extracting + storing claims…");

  if (!query) throw new Error("processTaskClaims: missing query");
  if (!taskContentId)
    throw new Error("processTaskClaims: missing taskContentId");

  if (!text || !text.trim()) {
    console.warn("⚠️ [processTaskClaims] Empty text, skipping claims.");
    return [];
  }

  // -----------------------------------------------------
  // 1. Claim extraction (LLM)
  // -----------------------------------------------------
  const extractor = new ClaimExtractor(openAiLLM);

  const extraction = await extractor.analyzeContent({
    chunks: [{ text, tokenLength: Math.round(text.length / 4) }],
    existingTestimonials: [],
    maxConcurrency: 1,
  });

  const claims = extraction.claims || [];
  console.log(`🟩 Extracted ${claims.length} claims`);

  if (claims.length === 0) return [];

  // -----------------------------------------------------
  // 2. Persist claims (batch)
  // persistClaims(query, contentId, claimsArray)
  // returns array of new claimIds
  // -----------------------------------------------------
  const claimIds = await persistClaims(query, taskContentId, claims);

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

  console.log(
    `🟩 [processTaskClaims] Persisted ${result.length} claims for content ${taskContentId}`
  );

  return result;
}
