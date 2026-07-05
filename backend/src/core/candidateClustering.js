// backend/src/core/candidateClustering.js
//
// Step 6.5: Candidate clustering before final selection (Prompt 8 reducers).
//
// Clusters evaluation candidates separately from background candidates using
// semantic and structural keys to reduce repetition across chunks. Each cluster
// selects a canonical representative for reducer steps.
//
// Evaluation cluster keys:
// - normalized claim text (Jaccard similarity)
// - same subject/actor
// - same predicate/action
// - same object
// - same named study/document/law/dataset
// - same statistic/date/quantity
// - semantic similarity (if available)
// - noveltyHint and localRepetitionSignals
//
// Background cluster keys:
// - same named study/document/law/dataset
// - same actor/source attribution
// - same historical/contextual event
// - same statistic/date/quantity
// - same citation breadcrumb

import logger from "../utils/logger.js";
import { tokenizeBearingText } from "./evidenceNeed.js";

const NEAR_DUP_JACCARD = 0.65; // token-set overlap threshold for text similarity

function normalizeText(text) {
  return String(text || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function tokenSet(text) {
  return new Set(tokenizeBearingText(normalizeText(text)));
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function arraySetIntersection(arr1 = [], arr2 = []) {
  if (!Array.isArray(arr1) || !Array.isArray(arr2)) return false;
  if (arr1.length === 0 || arr2.length === 0) return false;
  const set1 = new Set(arr1.map((x) => normalizeText(String(x))));
  const set2 = new Set(arr2.map((x) => normalizeText(String(x))));
  for (const item of set1) {
    if (set2.has(item)) return true;
  }
  return false;
}

function extractNamedEntity(candidate = {}) {
  const actors = Array.isArray(candidate.namedActors) ? candidate.namedActors : [];
  return actors.length > 0 ? normalizeText(actors[0]) : null;
}

function extractNamedDocuments(candidate = {}) {
  const docs = Array.isArray(candidate.namedStudiesOrDocuments) ? candidate.namedStudiesOrDocuments : [];
  return docs.length > 0 ? docs.map((d) => normalizeText(String(d))) : [];
}

function extractNamedLaws(candidate = {}) {
  const laws = Array.isArray(candidate.namedLawsOrPolicies) ? candidate.namedLawsOrPolicies : [];
  return laws.length > 0 ? laws.map((l) => normalizeText(String(l))) : [];
}

function extractNamedDatasets(candidate = {}) {
  const datasets = Array.isArray(candidate.namedDatasets) ? candidate.namedDatasets : [];
  return datasets.length > 0 ? datasets.map((d) => normalizeText(String(d))) : [];
}

function extractStatistics(candidate = {}) {
  // Attempt to extract numeric patterns from claim text
  const text = normalizeText(candidate.claimText || "");
  const patterns = [
    /\d+\s*%/g,                        // percentages
    /\$?\d+[\d,]*\.?\d*/g,             // numbers/currency
    /\d{4}-\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/g, // dates/ranges
  ];
  const stats = new Set();
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      stats.add(normalizeText(match));
    }
  }
  return Array.from(stats);
}

/**
 * Determine if two evaluation candidates should be in the same cluster.
 * Uses multi-key matching: if ANY key matches, they cluster together (single-linkage).
 */
function shouldClusterEvaluationCandidates(a, b, aTokens, bTokens) {
  // Text similarity: Jaccard overlap of tokens
  const textSim = jaccard(aTokens, bTokens);
  if (textSim >= NEAR_DUP_JACCARD) return true;

  // Same subject/actor
  const aActor = extractNamedEntity(a);
  const bActor = extractNamedEntity(b);
  if (aActor && bActor && aActor === bActor) return true;

  // Same named study/document/law/dataset
  const aDocs = extractNamedDocuments(a);
  const bDocs = extractNamedDocuments(b);
  if (arraySetIntersection(aDocs, bDocs)) return true;

  const aLaws = extractNamedLaws(a);
  const bLaws = extractNamedLaws(b);
  if (arraySetIntersection(aLaws, bLaws)) return true;

  const aDatasets = extractNamedDatasets(a);
  const bDatasets = extractNamedDatasets(b);
  if (arraySetIntersection(aDatasets, bDatasets)) return true;

  // Same statistic/date/quantity (exact string match after normalization)
  const aStats = extractStatistics(a);
  const bStats = extractStatistics(b);
  if (aStats.length > 0 && bStats.length > 0) {
    for (const stat of aStats) {
      if (bStats.includes(stat)) return true;
    }
  }

  // noveltyHint and localRepetitionSignals indicate repetition
  const aNovalty = normalizeText(a.noveltyHint || "");
  const bNovalty = normalizeText(b.noveltyHint || "");
  if ((aNovalty === "repeated" || aNovalty === "derivative") &&
      (bNovalty === "repeated" || bNovalty === "derivative")) {
    // Both marked as non-novel in same context; may cluster
    const aReps = a.localRepetitionSignals;
    const bReps = b.localRepetitionSignals;
    if (aReps && bReps && String(aReps) === String(bReps)) return true;
  }

  return false;
}

/**
 * Determine if two background candidates should be in the same cluster.
 * Background candidates cluster on source/document evidence, not claim text.
 */
function shouldClusterBackgroundCandidates(a, b) {
  // Same named study/document/law/dataset
  const aDocs = extractNamedDocuments(a);
  const bDocs = extractNamedDocuments(b);
  if (arraySetIntersection(aDocs, bDocs)) return true;

  const aLaws = extractNamedLaws(a);
  const bLaws = extractNamedLaws(b);
  if (arraySetIntersection(aLaws, bLaws)) return true;

  // Same actor/source attribution
  const aActor = extractNamedEntity(a);
  const bActor = extractNamedEntity(b);
  if (aActor && bActor && aActor === bActor) return true;

  // Same statistic/date/quantity
  const aStats = extractStatistics(a);
  const bStats = extractStatistics(b);
  if (aStats.length > 0 && bStats.length > 0) {
    for (const stat of aStats) {
      if (bStats.includes(stat)) return true;
    }
  }

  // Same citation breadcrumb (if available from local source excerpt)
  const aExcerpt = normalizeText(a.localSourceExcerpt || "");
  const bExcerpt = normalizeText(b.localSourceExcerpt || "");
  if (aExcerpt && bExcerpt && aExcerpt === bExcerpt) return true;

  return false;
}

/**
 * Score a candidate as a cluster representative.
 * Higher importance/novelty scores preferred; lower importance/repetition scores demoted.
 */
function scoreAsRepresentative(candidate = {}) {
  let score = 0;

  // Favor high importance
  score += Number(candidate.importanceInChunk ?? 0) * 10;
  score += Number(candidate.importanceToArticleGuess ?? 0) * 5;

  // Penalize repetition and low novelty
  const novelty = normalizeText(candidate.noveltyHint || "");
  if (novelty === "novel" || novelty === "original") score += 5;
  else if (novelty === "repeated" || novelty === "derivative") score -= 10;

  // Penalize candidates marked with repetition signals
  if (candidate.localRepetitionSignals) score -= 3;

  return score;
}

/**
 * Cluster evaluation candidates using union-find with multi-key matching.
 * Returns { clusterIdByIndex, clusters } where each cluster has a canonical representative.
 */
export function clusterEvaluationCandidates(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) {
    return { clusterIdByIndex: [], clusters: new Map(), totalClusters: 0 };
  }

  const tokenSets = list.map((c) => tokenSet(c.claimText || ""));
  const parent = list.map((_, i) => i);

  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };

  // Single-linkage clustering: if candidate i matches candidate j on ANY key, union them
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (shouldClusterEvaluationCandidates(list[i], list[j], tokenSets[i], tokenSets[j])) {
        union(i, j);
      }
    }
  }

  const clusterIdByIndex = list.map((_, i) => `eval:${find(i)}`);
  const clusters = new Map();

  // Build cluster map
  list.forEach((candidate, i) => {
    const clusterId = clusterIdByIndex[i];
    if (!clusters.has(clusterId)) {
      clusters.set(clusterId, {
        id: clusterId,
        type: "evaluation",
        memberIndexes: [],
        candidates: [],
        representativeIndex: null,
      });
    }
    const cluster = clusters.get(clusterId);
    cluster.memberIndexes.push(i);
    cluster.candidates.push({ ...candidate, sourceIndex: i });
  });

  // Select canonical representative for each cluster (highest score)
  for (const cluster of clusters.values()) {
    let bestIndex = cluster.memberIndexes[0];
    let bestScore = scoreAsRepresentative(list[bestIndex]);

    for (const idx of cluster.memberIndexes) {
      const score = scoreAsRepresentative(list[idx]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
      }
    }

    cluster.representativeIndex = bestIndex;
    cluster.representative = { ...list[bestIndex], sourceIndex: bestIndex };
    cluster.size = cluster.memberIndexes.length;
  }

  return { clusterIdByIndex, clusters, totalClusters: clusters.size };
}

/**
 * Cluster background candidates using union-find with multi-key matching.
 * Returns { clusterIdByIndex, clusters } where each cluster has a canonical representative.
 */
export function clusterBackgroundCandidates(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) {
    return { clusterIdByIndex: [], clusters: new Map(), totalClusters: 0 };
  }

  const parent = list.map((_, i) => i);

  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };

  // Single-linkage clustering: if background candidate i matches j on ANY key, union them
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (shouldClusterBackgroundCandidates(list[i], list[j])) {
        union(i, j);
      }
    }
  }

  const clusterIdByIndex = list.map((_, i) => `bg:${find(i)}`);
  const clusters = new Map();

  // Build cluster map
  list.forEach((candidate, i) => {
    const clusterId = clusterIdByIndex[i];
    if (!clusters.has(clusterId)) {
      clusters.set(clusterId, {
        id: clusterId,
        type: "background",
        memberIndexes: [],
        candidates: [],
        representativeIndex: null,
      });
    }
    const cluster = clusters.get(clusterId);
    cluster.memberIndexes.push(i);
    cluster.candidates.push({ ...candidate, sourceIndex: i });
  });

  // Select canonical representative for each cluster (by usefulness as context)
  for (const cluster of clusters.values()) {
    let bestIndex = cluster.memberIndexes[0];
    let bestScore = scoreAsRepresentative(list[bestIndex]);

    for (const idx of cluster.memberIndexes) {
      const score = scoreAsRepresentative(list[idx]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
      }
    }

    cluster.representativeIndex = bestIndex;
    cluster.representative = { ...list[bestIndex], sourceIndex: bestIndex };
    cluster.size = cluster.memberIndexes.length;
  }

  return { clusterIdByIndex, clusters, totalClusters: clusters.size };
}

/**
 * Process all survey packets, cluster evaluation and background candidates separately,
 * and return clustered results ready for Prompt 8 reducer steps.
 *
 * @param {Object} surveyResults - Output from surveyTaskContent
 * @returns {Object} Clustered results with logging
 */
export function clusterCandidatesFromSurvey(surveyResults = {}) {
  const chunkSurveys = Array.isArray(surveyResults.chunkSurveys) ? surveyResults.chunkSurveys : [];

  if (chunkSurveys.length === 0) {
    logger.log("[EVALUATION_CANDIDATES_CLUSTERED] count=0, clusters=0, representatives=0");
    logger.log("[BACKGROUND_CANDIDATES_CLUSTERED] count=0, clusters=0, representatives=0");
    return {
      evaluationClusterResults: { clusters: new Map(), representatives: [] },
      backgroundClusterResults: { clusters: new Map(), representatives: [] },
      clusteringMetrics: {
        evaluationCandidatesProcessed: 0,
        evaluationClusters: 0,
        evaluationRepresentatives: 0,
        backgroundCandidatesProcessed: 0,
        backgroundClusters: 0,
        backgroundRepresentatives: 0,
      },
    };
  }

  // Flatten all evaluation and background candidates from all chunks
  const allEvaluationCandidates = [];
  const allBackgroundCandidates = [];

  for (const packet of chunkSurveys) {
    const evalClaims = Array.isArray(packet.evaluationCandidateClaims) ? packet.evaluationCandidateClaims : [];
    const bgClaims = Array.isArray(packet.sourceBackgroundCandidates) ? packet.sourceBackgroundCandidates : [];

    for (const claim of evalClaims) {
      allEvaluationCandidates.push({
        ...claim,
        sourceChunkIndex: packet.chunkIndex,
        sourceChunkPosition: packet.chunkPosition,
        chunkMiniTheme: packet.chunkMiniTheme,
      });
    }

    for (const claim of bgClaims) {
      allBackgroundCandidates.push({
        ...claim,
        sourceChunkIndex: packet.chunkIndex,
        sourceChunkPosition: packet.chunkPosition,
        chunkMiniTheme: packet.chunkMiniTheme,
      });
    }
  }

  // Cluster evaluation candidates
  const evaluationResults = clusterEvaluationCandidates(allEvaluationCandidates);
  const evaluationRepresentatives = Array.from(evaluationResults.clusters.values())
    .filter((c) => c.representative)
    .map((c) => c.representative);

  logger.log(
    `[EVALUATION_CANDIDATES_CLUSTERED] count=${allEvaluationCandidates.length}, clusters=${evaluationResults.totalClusters}, representatives=${evaluationRepresentatives.length}`
  );

  // Log cluster details (sample of clusters with repetition reduction)
  if (evaluationResults.clusters.size > 0) {
    const clusterDetails = Array.from(evaluationResults.clusters.values())
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        size: c.size,
        representative: c.representative?.claimText?.substring(0, 100),
      }));
    logger.log(`[EVALUATION_CLUSTERS_SAMPLE] ${JSON.stringify(clusterDetails)}`);
  }

  // Cluster background candidates
  const backgroundResults = clusterBackgroundCandidates(allBackgroundCandidates);
  const backgroundRepresentatives = Array.from(backgroundResults.clusters.values())
    .filter((c) => c.representative)
    .map((c) => c.representative);

  logger.log(
    `[BACKGROUND_CANDIDATES_CLUSTERED] count=${allBackgroundCandidates.length}, clusters=${backgroundResults.totalClusters}, representatives=${backgroundRepresentatives.length}`
  );

  // Log background cluster details
  if (backgroundResults.clusters.size > 0) {
    const clusterDetails = Array.from(backgroundResults.clusters.values())
      .slice(0, 3)
      .map((c) => ({
        id: c.id,
        size: c.size,
        representative: c.representative?.claimText?.substring(0, 100),
      }));
    logger.log(`[BACKGROUND_CLUSTERS_SAMPLE] ${JSON.stringify(clusterDetails)}`);
  }

  return {
    evaluationClusterResults: {
      clusters: evaluationResults.clusters,
      representatives: evaluationRepresentatives,
      totalCandidates: allEvaluationCandidates.length,
      totalClusters: evaluationResults.totalClusters,
    },
    backgroundClusterResults: {
      clusters: backgroundResults.clusters,
      representatives: backgroundRepresentatives,
      totalCandidates: allBackgroundCandidates.length,
      totalClusters: backgroundResults.totalClusters,
    },
    clusteringMetrics: {
      evaluationCandidatesProcessed: allEvaluationCandidates.length,
      evaluationClusters: evaluationResults.totalClusters,
      evaluationRepresentatives: evaluationRepresentatives.length,
      backgroundCandidatesProcessed: allBackgroundCandidates.length,
      backgroundClusters: backgroundResults.totalClusters,
      backgroundRepresentatives: backgroundRepresentatives.length,
      evaluationReductionRatio: allEvaluationCandidates.length > 0
        ? (evaluationRepresentatives.length / allEvaluationCandidates.length).toFixed(2)
        : "0",
      backgroundReductionRatio: allBackgroundCandidates.length > 0
        ? (backgroundRepresentatives.length / allBackgroundCandidates.length).toFixed(2)
        : "0",
    },
  };
}

/**
 * Get canonical representatives from clustered results, sorted by quality.
 * Used to feed clustered candidates into Prompt 8 reducer steps.
 */
export function getClusteredRepresentatives(clusteringOutput = {}) {
  const evalReps = Array.isArray(clusteringOutput.evaluationClusterResults?.representatives)
    ? clusteringOutput.evaluationClusterResults.representatives
    : [];
  const bgReps = Array.isArray(clusteringOutput.backgroundClusterResults?.representatives)
    ? clusteringOutput.backgroundClusterResults.representatives
    : [];

  // Sort by importance (higher importanceInChunk and importanceToArticleGuess first)
  const sorted = [...evalReps, ...bgReps].sort((a, b) => {
    const scoreA = (Number(a.importanceInChunk ?? 0) + Number(a.importanceToArticleGuess ?? 0)) / 2;
    const scoreB = (Number(b.importanceInChunk ?? 0) + Number(b.importanceToArticleGuess ?? 0)) / 2;
    return scoreB - scoreA;
  });

  return {
    evaluationRepresentatives: evalReps,
    backgroundRepresentatives: bgReps,
    allRepresentatives: sorted,
  };
}
