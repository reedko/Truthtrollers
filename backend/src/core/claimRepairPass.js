// backend/src/core/claimRepairPass.js
// Feature-gated targeted repair pass for coverage gaps
// Runs after theme fusion, before clustering/reduction
// Generates one repair claim per article if gaps detected

import { openAiLLM } from "./openAiLLM.js";
import logger from "../utils/logger.js";

/**
 * Check if repair pass is enabled
 * @param {object} env - Environment variables (default process.env)
 * @returns {boolean}
 */
export function isClaimRepairPassEnabled(env = process.env) {
  return env.CLAIM_REPAIR_PASS === "true";
}

/**
 * Find the most relevant excerpts from survey chunks for a given coverage gap
 * @param {array} chunkSurveys - Array of chunk survey packets
 * @param {string} gapDescription - Description of the coverage gap from final frame
 * @param {number} maxExcerpts - Maximum excerpts to return (default 3)
 * @returns {array} - Array of {chunkIndex, excerpt, context}
 */
function findRelevantExcerpts(chunkSurveys = [], gapDescription = "", maxExcerpts = 3) {
  if (!chunkSurveys.length || !gapDescription) return [];

  const excerpts = [];

  for (const survey of chunkSurveys) {
    if (!survey || !survey.evaluationCandidateClaims) continue;

    // Look for claims that might relate to the gap
    for (const candidate of survey.evaluationCandidateClaims) {
      if (!candidate.localSourceExcerpt) continue;

      // Collect excerpt with chunk context
      excerpts.push({
        chunkIndex: survey.chunkIndex,
        chunkPosition: survey.chunkPosition,
        excerpt: candidate.localSourceExcerpt,
        claimText: candidate.claimText,
        importance: candidate.importanceToArticleGuess || 0.5,
      });
    }
  }

  // Sort by importance and take top N
  excerpts.sort((a, b) => b.importance - a.importance);
  return excerpts.slice(0, maxExcerpts);
}

/**
 * Generate a repair claim for a coverage gap
 * @param {object} params
 * @param {object} params.finalFrame - Final article frame from theme fusion
 * @param {array} params.chunkSurveys - Array of survey packets with candidates
 * @param {array} params.selectedEvaluationClaims - Current selected evaluation claims
 * @param {string} params.coverageGap - Description of the gap to repair
 * @param {number} params.timeout - LLM timeout in ms (default 30000)
 * @returns {Promise<object>} - {repairClaim: {...} | null, reason: string}
 */
export async function generateRepairClaim({
  finalFrame = {},
  chunkSurveys = [],
  selectedEvaluationClaims = [],
  coverageGap = "",
  timeout = 30000,
} = {}) {
  try {
    logger.log("[ClaimRepairPass] Generating repair claim for gap:", coverageGap.substring(0, 80));

    if (!coverageGap || !coverageGap.trim()) {
      return {
        repairClaim: null,
        reason: "Empty coverage gap description",
      };
    }

    // Find relevant excerpts from survey
    const relevantExcerpts = findRelevantExcerpts(chunkSurveys, coverageGap, 3);

    if (!relevantExcerpts.length) {
      return {
        repairClaim: null,
        reason: "No relevant excerpts found in source material",
      };
    }

    // Build excerpt text for LLM
    const excerptText = relevantExcerpts
      .map((e) => `[Chunk ${e.chunkIndex}] ${e.excerpt}`)
      .join("\n\n");

    // Build current pillars summary
    const pillarsSummary = (finalFrame.finalPillars || [])
      .map((p) => `- ${p.pillarText}`)
      .join("\n");

    const systemPrompt = `You are a fact-checking assistant. Given a coverage gap in article evidence and related excerpts, generate a single repair claim that could address this gap.

The repair claim should be:
1. Factual and verifiable
2. Extracted or derived from the provided excerpts
3. Specific and material to the article's thesis
4. Not already covered in selected pillars

Return strict JSON only with exactly this structure:
{
  "shouldGenerate": true|false,
  "repairClaim": "single specific claim (100-200 chars max) or null",
  "reasoning": "brief explanation of why this claim addresses the gap (max 200 chars)"
}

If you cannot generate a meaningful repair claim, return shouldGenerate: false with null claim.`;

    const userPrompt = `ARTICLE THESIS: ${finalFrame.finalThesis || "Unknown"}

CURRENT PILLARS:
${pillarsSummary || "(none)"}

COVERAGE GAP TO REPAIR:
${coverageGap}

AVAILABLE EXCERPTS FROM ARTICLE:
${excerptText}

Generate a single repair claim that could strengthen evidence for the coverage gap above. Only generate if the excerpts genuinely support a new, material claim.`;

    logger.log("[ClaimRepairPass] Calling LLM for repair claim generation…");

    const llmResponse = await openAiLLM.generate({
      system: systemPrompt,
      user: userPrompt,
      schemaHint: '{"shouldGenerate":true,"repairClaim":"string or null","reasoning":"string"}',
      temperature: 0.1, // Low temperature for consistency
      maxRetries: 1,
      timeout,
    });

    // Validate response
    const shouldGenerate = llmResponse.shouldGenerate === true;
    const claimText = shouldGenerate ? (llmResponse.repairClaim || "").trim() : "";

    if (!shouldGenerate || !claimText) {
      return {
        repairClaim: null,
        reason: llmResponse.reasoning || "LLM determined no repair claim needed",
      };
    }

    // Build repair claim object
    const repairClaim = {
      claimText,
      roleHint: "evidence", // Repair claims are evidence-level
      importanceToArticleGuess: 0.7, // Medium-high importance
      importanceInChunk: 0.6,
      noveltyHint: "new",
      rhetoricalFunction: "addresses coverage gap",
      localSourceExcerpt: relevantExcerpts[0]?.excerpt || "",
      namedActors: [],
      namedStudiesOrDocuments: [],
      namedLawsOrPolicies: [],
      namedDatasets: [],
      claimType: { attribution: false, misconduct: false, causation: false, statistical: false, legal_or_regulatory: false },
      candidateOnly: false, // Important: repair claims are ready for persistence
      sourceChunkIndex: relevantExcerpts[0]?.chunkIndex || 0,
      sourceChunkPosition: relevantExcerpts[0]?.chunkPosition || "middle_body",
      repairPass: true, // Mark as from repair pass
    };

    logger.log("[ClaimRepairPass] Repair claim generated:", claimText.substring(0, 60) + "...");

    return {
      repairClaim,
      reason: "Repair claim generated and ready for clustering",
    };
  } catch (error) {
    logger.error("[ClaimRepairPass] Error generating repair claim:", error.message);
    return {
      repairClaim: null,
      reason: `Error: ${error.message}`,
    };
  }
}

/**
 * Run targeted repair pass after theme fusion
 * Checks flag and coverage gaps, generates up to one repair claim
 *
 * @param {object} params
 * @param {object} params.finalFrame - Final frame from theme fusion
 * @param {array} params.chunkSurveys - Array of survey packets
 * @param {array} params.selectedEvaluationClaims - Current selected claims
 * @param {object} params.env - Environment variables (default process.env)
 * @returns {Promise<object>} - {repairClaim: {...} | null, outcome: string}
 */
export async function runTargetedRepairPass({
  finalFrame = {},
  chunkSurveys = [],
  selectedEvaluationClaims = [],
  env = process.env,
} = {}) {
  // Check if feature is enabled
  if (!isClaimRepairPassEnabled(env)) {
    logger.log("[ClaimRepairPass] Feature disabled (CLAIM_REPAIR_PASS != true)");
    return {
      repairClaim: null,
      outcome: "disabled",
    };
  }

  // Check if gaps exist
  const coverageGaps = finalFrame.coverageGaps || [];
  if (!coverageGaps.length) {
    logger.log("[ClaimRepairPass] No coverage gaps detected, skipping repair pass");
    return {
      repairClaim: null,
      outcome: "none_needed",
    };
  }

  logger.log(`[ClaimRepairPass] Starting targeted repair pass (${coverageGaps.length} gaps detected)…`);

  // Pick first gap
  const firstGap = coverageGaps[0];
  logger.log("[ClaimRepairPass] Targeting first coverage gap:", firstGap.substring(0, 100));

  // Generate repair claim for first gap
  const { repairClaim, reason } = await generateRepairClaim({
    finalFrame,
    chunkSurveys,
    selectedEvaluationClaims,
    coverageGap: firstGap,
  });

  if (!repairClaim) {
    logger.log("[ClaimRepairPass] Repair claim generation returned null:", reason);
    return {
      repairClaim: null,
      outcome: "attempted",
    };
  }

  logger.log("[ClaimRepairPass] Repair claim generated and ready for clustering");

  return {
    repairClaim,
    outcome: "generated",
  };
}

export default {
  isClaimRepairPassEnabled,
  generateRepairClaim,
  runTargetedRepairPass,
};
