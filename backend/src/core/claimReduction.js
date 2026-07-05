// backend/src/core/claimReduction.js
// Cluster and reduce candidates to final selected claims for persistence

import logger from "../utils/logger.js";

// Constants
export const CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS = 12;
export const CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS = 8;

/**
 * Cluster raw candidate claims from survey packets
 * Groups similar candidates by semantic meaning and removes duplicates
 *
 * @param {array} chunkSurveys - Array of survey packets from surveyTaskContent()
 * @returns {Promise<object>} - Clustered candidates with deduplication
 *   {
 *     evaluationClusterGroups: [{ representative, variants, clusterScore, sourceChunks }],
 *     backgroundClusterGroups: [{ representative, variants, clusterScore, sourceChunks }]
 *   }
 */
export async function clusterCandidates(chunkSurveys = []) {
  logger.log(`[clusterCandidates] Starting clustering of ${chunkSurveys.length} chunk surveys…`);

  if (!Array.isArray(chunkSurveys) || chunkSurveys.length === 0) {
    logger.warn("[clusterCandidates] No surveys provided, returning empty clusters");
    return {
      evaluationClusterGroups: [],
      backgroundClusterGroups: [],
    };
  }

  // Extract and flatten all evaluation candidates across chunks
  const allEvaluationCandidates = [];
  const allBackgroundCandidates = [];

  for (const survey of chunkSurveys) {
    if (!survey) continue;

    // Collect evaluation candidates with chunk context
    if (Array.isArray(survey.evaluationCandidateClaims)) {
      for (const candidate of survey.evaluationCandidateClaims) {
        allEvaluationCandidates.push({
          ...candidate,
          sourceChunkIndex: survey.chunkIndex,
          sourceChunkPosition: survey.chunkPosition,
        });
      }
    }

    // Collect background candidates with chunk context
    if (Array.isArray(survey.sourceBackgroundCandidates)) {
      for (const candidate of survey.sourceBackgroundCandidates) {
        allBackgroundCandidates.push({
          ...candidate,
          sourceChunkIndex: survey.chunkIndex,
          sourceChunkPosition: survey.chunkPosition,
        });
      }
    }
  }

  logger.log(`[clusterCandidates] Total evaluation candidates collected: ${allEvaluationCandidates.length}`);
  logger.log(`[clusterCandidates] Total background candidates collected: ${allBackgroundCandidates.length}`);

  // Simple clustering by normalizing text and grouping similar ones
  // In a production system, this would use semantic similarity (embeddings)
  function normalizeText(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ");
  }

  function clusterByText(candidates) {
    const clusters = [];
    const processedKeys = new Set();

    for (const candidate of candidates) {
      const key = normalizeText(candidate.claimText);
      if (!key || processedKeys.has(key)) continue;

      // Find all similar candidates (exact normalized match for now)
      const cluster = {
        representative: candidate,
        variants: [candidate],
        clusterScore: candidate.importanceToArticleGuess || 0.5,
        sourceChunks: new Set([candidate.sourceChunkIndex]),
      };

      for (const other of candidates) {
        if (normalizeText(other.claimText) === key && other !== candidate) {
          cluster.variants.push(other);
          cluster.sourceChunks.add(other.sourceChunkIndex);
        }
      }

      clusters.push(cluster);
      processedKeys.add(key);
    }

    return clusters;
  }

  const evaluationClusterGroups = clusterByText(allEvaluationCandidates);
  const backgroundClusterGroups = clusterByText(allBackgroundCandidates);

  logger.log(`[clusterCandidates] Created ${evaluationClusterGroups.length} evaluation cluster groups`);
  logger.log(`[clusterCandidates] Created ${backgroundClusterGroups.length} background cluster groups`);

  return {
    evaluationClusterGroups,
    backgroundClusterGroups,
  };
}

/**
 * Reduce evaluation candidates to selected claims for persistence
 * Applies quality gates and selects top candidates that don't have candidateOnly=true
 *
 * @param {array} evaluationClusterGroups - Clustered evaluation candidates
 * @param {object} finalFrame - Final article frame from fuseSurveyThemesIntoFrame
 * @returns {Promise<array>} - selectedEvaluationClaims array (max 12 items)
 *   [{ claimText, importance, role, sourceChunks, claimType, ... }]
 */
export async function reduceEvaluationClaims(evaluationClusterGroups = [], finalFrame = null) {
  logger.log(`[reduceEvaluationClaims] Reducing ${evaluationClusterGroups.length} evaluation clusters to selection…`);

  if (!Array.isArray(evaluationClusterGroups) || evaluationClusterGroups.length === 0) {
    logger.log("[reduceEvaluationClaims] No evaluation clusters, returning empty selection");
    return [];
  }

  // Sort clusters by importance score
  const sortedClusters = evaluationClusterGroups.sort((a, b) => {
    const scoreA = a.representative?.importanceToArticleGuess ?? a.clusterScore ?? 0;
    const scoreB = b.representative?.importanceToArticleGuess ?? b.clusterScore ?? 0;
    return scoreB - scoreA;
  });

  // Select top candidates, enforcing candidateOnly restriction
  const selectedClaims = [];

  for (const cluster of sortedClusters) {
    if (selectedClaims.length >= CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS) {
      break;
    }

    const representative = cluster.representative;
    if (!representative) continue;

    // CRITICAL: Do NOT persist if candidateOnly=true AND has no source excerpt
    // If it has localSourceExcerpt from survey, it's a valid source and should be persisted
    if (representative.candidateOnly === true && !representative.localSourceExcerpt) {
      logger.warn(`[reduceEvaluationClaims] Skipping candidate-only claim with no source: "${representative.claimText?.substring(0, 60)}..."`);
      continue;
    }

    // Build selected claim record
    const selectedClaim = {
      text: representative.claimText,
      role: representative.roleHint || "unclear",
      importance: representative.importanceToArticleGuess ?? 0.5,
      importanceInChunk: representative.importanceInChunk ?? 0.5,
      noveltyHint: representative.noveltyHint || "unclear",
      rhetoricalFunction: representative.rhetoricalFunction || "",
      sourceChunks: Array.from(cluster.sourceChunks || []),
      variantCount: (cluster.variants || []).length - 1,
      claimType: representative.claimType || {},
      namedActors: representative.namedActors || [],
      namedStudiesOrDocuments: representative.namedStudiesOrDocuments || [],
      namedLawsOrPolicies: representative.namedLawsOrPolicies || [],
      namedDatasets: representative.namedDatasets || [],
      localSourceExcerpt: representative.localSourceExcerpt || "",
      alignedToPillar: null, // Can be enriched by final frame
      candidateOnly: false, // Explicitly mark as NOT candidate-only
      repairPass: representative.repairPass === true, // Preserve repair pass flag
    };

    // Try to align with pillars in final frame
    if (finalFrame && Array.isArray(finalFrame.finalPillars)) {
      for (const pillar of finalFrame.finalPillars) {
        if (pillar.supportingChunkIndexes?.includes(representative.sourceChunkIndex)) {
          selectedClaim.alignedToPillar = pillar.pillarText;
          break;
        }
      }
    }

    selectedClaims.push(selectedClaim);
  }

  logger.log(`[reduceEvaluationClaims] Selected ${selectedClaims.length}/${CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS} evaluation claims`);

  return selectedClaims;
}

/**
 * Reduce background candidates to selected claims for persistence
 * Applies quality gates and selects top background candidates
 *
 * @param {array} backgroundClusterGroups - Clustered background candidates
 * @param {object} finalFrame - Final article frame from fuseSurveyThemesIntoFrame
 * @returns {Promise<array>} - selectedSourceBackgroundClaims array (max CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS items)
 *   [{ claimText, usefulness, reason, sourceChunks, ... }]
 */
export async function reduceBackgroundClaims(backgroundClusterGroups = [], finalFrame = null) {
  logger.log(`[reduceBackgroundClaims] Reducing ${backgroundClusterGroups.length} background clusters to selection…`);

  if (!Array.isArray(backgroundClusterGroups) || backgroundClusterGroups.length === 0) {
    logger.log("[reduceBackgroundClaims] No background clusters, returning empty selection");
    return [];
  }

  // Sort clusters by usefulness, with "high" scoring higher
  const usefulnessScore = (usefulness) => {
    const scores = { high: 1.0, medium: 0.6, low: 0.3 };
    return scores[usefulness] ?? 0.3;
  };

  const sortedClusters = backgroundClusterGroups.sort((a, b) => {
    const scoreA = usefulnessScore(a.representative?.sourceUsefulness ?? "medium");
    const scoreB = usefulnessScore(b.representative?.sourceUsefulness ?? "medium");
    return scoreB - scoreA;
  });

  // Select top background claims, enforcing candidateOnly restriction
  const selectedClaims = [];

  for (const cluster of sortedClusters) {
    if (selectedClaims.length >= CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS) {
      break;
    }

    const representative = cluster.representative;
    if (!representative) continue;

    // CRITICAL: Do NOT persist if candidateOnly=true AND has no source excerpt
    // If it has localSourceExcerpt from survey, it's a valid source and should be persisted
    if (representative.candidateOnly === true && !representative.localSourceExcerpt) {
      logger.warn(`[reduceBackgroundClaims] Skipping candidate-only claim with no source: "${representative.claimText?.substring(0, 60)}..."`);
      continue;
    }

    // Build selected claim record
    const selectedClaim = {
      text: representative.claimText,
      usefulness: representative.sourceUsefulness || "medium",
      reason: representative.reasonUsefulAsSource || "",
      sourceChunks: Array.from(cluster.sourceChunks || []),
      variantCount: (cluster.variants || []).length - 1,
      claimType: representative.claimType || { background: true },
      namedActors: representative.namedActors || [],
      namedStudiesOrDocuments: representative.namedStudiesOrDocuments || [],
      namedLawsOrPolicies: representative.namedLawsOrPolicies || [],
      namedDatasets: representative.namedDatasets || [],
      localSourceExcerpt: representative.localSourceExcerpt || "",
      candidateOnly: false, // Explicitly mark as NOT candidate-only
    };

    selectedClaims.push(selectedClaim);
  }

  logger.log(`[reduceBackgroundClaims] Selected ${selectedClaims.length}/${CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS} background claims`);

  return selectedClaims;
}

export default {
  clusterCandidates,
  reduceEvaluationClaims,
  reduceBackgroundClaims,
  CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS,
  CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS,
};
