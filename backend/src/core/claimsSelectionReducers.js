// backend/src/core/claimsSelectionReducers.js
//
// Document-level claim selection reducers.
//
// Reducer A: selectedEvaluationClaims
//   - Selects thesis/pillars/evidence/opposing/critical claims used to evaluate content
//   - Max 12 items, ranked by article centrality, pillar coverage, verification worthiness,
//     specificity, novelty, named anchor strength, source excerpt quality, role diversity
//   - Sets: selectedForEvaluation=true, evaluationEligible=true, verdictEligible=true,
//           searchEligible=true, visibility="workspace_eval"
//
// Reducer B: selectedSourceBackgroundClaims
//   - Selects useful source/background claims (not central evaluation claims)
//   - Max configurable (default 12), ranked by usefulness for sourcing
//   - Prefers: named studies/documents/laws, named actors, dates/numbers/statistics,
//             attribution claims, citation breadcrumbs, facts useful as source context
//   - Sets: role="background" or argumentFunction="background", selectedForEvaluation=false,
//          evaluationEligible=false, verdictEligible=false, searchEligible=false,
//          sourceEligible=true

import logger from "../utils/logger.js";

const DEFAULT_EVALUATION_MAX = 12;
const DEFAULT_BACKGROUND_MAX = 12;

/**
 * Score an evaluation candidate by ranking dimensions.
 *
 * Dimensions:
 * 1. Article centrality (0-1): How central is this claim to the article's main argument?
 * 2. Pillar coverage (0-1): Does this claim support a key pillar?
 * 3. Verification worthiness (0-1): Is this claim worth verifying?
 * 4. Specificity (0-1): Is this claim specific and falsifiable vs vague?
 * 5. Novelty vs repetition (0-1): Is this claim novel or repeated?
 * 6. Named anchor strength (0-1): Does this claim reference strong named entities?
 * 7. Source excerpt quality (0-1): Does this claim have a high-quality source excerpt?
 * 8. Role diversity bonus (0-0.2): Bonus for diverse claim roles (thesis, pillar, evidence, opposing)
 * 9. Redundancy penalty (0-1): Penalty for claiming similar to already selected items
 */
function scoreEvaluationCandidate(candidate, context = {}) {
  const {
    finalFrame = {},
    dominantAnchors = new Set(),
    selectedSoFar = [],
    roleCountByType = {},
  } = context;

  const scores = {};

  // 1. Article centrality: estimate from claim role and placement
  scores.articleCentrality = estimateCentrality(candidate, finalFrame);

  // 2. Pillar coverage: how well does this claim support final pillars?
  scores.pillarCoverage = estimatePillarCoverage(candidate, finalFrame);

  // 3. Verification worthiness: is this claim worth verifying?
  scores.verificationWorthiness = estimateVerificationWorthiness(candidate);

  // 4. Specificity: is this claim specific vs vague?
  scores.specificity = estimateSpecificity(candidate);

  // 5. Novelty vs repetition: is this claim novel or repeated in the text?
  scores.novelty = estimateNovelty(candidate, selectedSoFar);

  // 6. Named anchor strength: does this reference strong named entities/documents?
  scores.namedAnchorStrength = estimateNamedAnchorStrength(candidate, dominantAnchors);

  // 7. Source excerpt quality: how good is the source excerpt?
  scores.sourceExcerptQuality = estimateSourceExcerptQuality(candidate);

  // 8. Role diversity bonus: bonus for diverse roles (avoid all evidence, all pillars)
  scores.roleDiversityBonus = estimateRoleDiversityBonus(candidate, roleCountByType);

  // 9. Redundancy penalty: penalty for being too similar to already selected
  scores.redundancyPenalty = estimateRedundancyPenalty(candidate, selectedSoFar);

  // Weighted average of all dimensions
  const weights = {
    articleCentrality: 0.20,
    pillarCoverage: 0.18,
    verificationWorthiness: 0.15,
    specificity: 0.14,
    novelty: 0.12,
    namedAnchorStrength: 0.10,
    sourceExcerptQuality: 0.06,
    roleDiversityBonus: 0.04,
  };

  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const [dimension, weight] of Object.entries(weights)) {
    totalWeightedScore += (scores[dimension] ?? 0) * weight;
    totalWeight += weight;
  }

  // Apply redundancy penalty at the end
  const finalScore = Math.max(0, (totalWeightedScore / totalWeight) - scores.redundancyPenalty);

  return {
    score: finalScore,
    breakdown: scores,
  };
}

/**
 * Estimate article centrality (0-1) based on claim role and position in article frame.
 */
function estimateCentrality(candidate, finalFrame = {}) {
  const role = candidate.role || candidate.argumentFunction || "evidence";
  const finalPillars = finalFrame.finalPillars || [];
  const finalThesis = finalFrame.finalThesis || "";

  // Thesis claims are most central
  if (role === "thesis") return 0.95;

  // Pillar claims are central; bonus if mentioned in final frame
  if (role === "pillar") {
    const isInFinalPillars = finalPillars.some(
      (p) => p.representativeCandidateIds?.includes(candidate.id)
    );
    return isInFinalPillars ? 0.90 : 0.85;
  }

  // Supporting premises and evidence are moderately central
  if (role === "supporting_premise" || role === "evidence" || role === "pillar_support") {
    return 0.70;
  }

  // Opposing claims are less central but still valuable for evaluation
  if (role === "opposing" || role === "counterargument") {
    return 0.65;
  }

  // Fallible/critical claims are valuable for evaluation robustness
  if (candidate.isFallibilityCritical) {
    return 0.75;
  }

  // Generic background: low centrality
  return 0.40;
}

/**
 * Estimate pillar coverage (0-1): does this claim support a key pillar?
 */
function estimatePillarCoverage(candidate, finalFrame = {}) {
  const finalPillars = finalFrame.finalPillars || [];
  if (!finalPillars.length) return 0.5;

  const pillarCount = finalPillars.length;
  const strongCoverage = finalPillars.some(
    (p) => p.coverageStrength > 0.7 && p.representativeCandidateIds?.includes(candidate.id)
  );

  if (strongCoverage) return 1.0;

  // Check if claim is in any pillar's representative candidates
  const inAnyPillar = finalPillars.some(
    (p) => p.representativeCandidateIds?.includes(candidate.id)
  );

  if (inAnyPillar) return 0.8;

  // No explicit pillar connection; use centrality as proxy
  return Math.min(0.6, (candidate.centrality ?? 0.5) * 0.7);
}

/**
 * Estimate verification worthiness (0-1): is this claim worth verifying?
 */
function estimateVerificationWorthiness(candidate) {
  const verifiability = candidate.verifiability ?? 0.5;
  const isFallibilityCritical = candidate.isFallibilityCritical ?? false;
  const hasSpecificTarget = Boolean(candidate.searchAssertions?.length);

  let score = verifiability;

  // Bonus for fallibility-critical claims
  if (isFallibilityCritical) score += 0.15;

  // Bonus for having specific search targets
  if (hasSpecificTarget) score += 0.10;

  return Math.min(1.0, score);
}

/**
 * Estimate specificity (0-1): is this claim specific vs vague?
 */
function estimateSpecificity(candidate) {
  const text = candidate.text || "";
  const namedEntities = candidate.namedEntities || [];
  const dates = candidate.dates || [];
  const namedStudiesOrDocuments = candidate.namedStudiesOrDocuments || [];

  // Claims with named entities, dates, or studies are more specific
  const namedEntityCount = namedEntities.length + dates.length + namedStudiesOrDocuments.length;
  let score = Math.min(0.5, namedEntityCount * 0.15);

  // Longer, more detailed claims are often more specific
  const textLength = text.length;
  if (textLength > 200) score += 0.25;
  else if (textLength > 100) score += 0.15;
  else if (textLength > 50) score += 0.10;

  // Claims with quantifiers or comparative language suggest specificity
  if (/\d+%?|\b(more|less|higher|lower|increase|decrease|significant)\b/i.test(text)) {
    score += 0.15;
  }

  return Math.min(1.0, score);
}

/**
 * Estimate novelty (0-1): is this claim novel or repeated?
 */
function estimateNovelty(candidate, selectedSoFar = []) {
  if (!selectedSoFar.length) return 1.0;

  const candidateText = normalizeTextForComparison(candidate.text || "");
  let maxSimilarity = 0;

  for (const selected of selectedSoFar) {
    const selectedText = normalizeTextForComparison(selected.text || "");
    const similarity = textSimilarity(candidateText, selectedText);
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }

  // Convert similarity to novelty: high similarity -> low novelty
  return 1.0 - Math.min(1.0, maxSimilarity);
}

/**
 * Estimate named anchor strength (0-1): does this claim reference strong named entities/documents?
 */
function estimateNamedAnchorStrength(candidate, dominantAnchors = new Set()) {
  const namedEntities = candidate.namedEntities || [];
  const namedStudiesOrDocuments = candidate.namedStudiesOrDocuments || [];
  const allNames = [...namedEntities, ...namedStudiesOrDocuments];

  if (!allNames.length) return 0.3;

  // Count how many named anchors match dominant anchors in the article
  const matchCount = allNames.filter((name) => dominantAnchors.has(name)).length;

  if (matchCount === 0) {
    // Have some named entities but they're not dominant -> moderate score
    return Math.min(0.7, allNames.length * 0.15);
  }

  // Bonus for matching dominant anchors
  return Math.min(1.0, 0.6 + matchCount * 0.2);
}

/**
 * Estimate source excerpt quality (0-1): how good is the source excerpt?
 */
function estimateSourceExcerptQuality(candidate) {
  const sourceExcerpt = candidate.localSourceExcerpt || candidate.sourceCitedInArticle || "";
  const excerptLength = sourceExcerpt.length;

  // High-quality excerpts are substantial (50+ chars) and specific
  if (excerptLength < 20) return 0.2;
  if (excerptLength < 50) return 0.4;
  if (excerptLength < 100) return 0.6;
  if (excerptLength < 200) return 0.8;
  return 1.0;
}

/**
 * Estimate role diversity bonus (0-0.2): bonus for diverse claim roles.
 */
function estimateRoleDiversityBonus(candidate, roleCountByType = {}) {
  const role = candidate.role || "evidence";
  const isCritical = candidate.isFallibilityCritical ?? false;

  // Determine role category
  let roleCategory = "evidence";
  if (role === "thesis") roleCategory = "thesis";
  else if (role === "pillar" || role === "pillar_support") roleCategory = "pillar";
  else if (role === "opposing" || role === "counterargument") roleCategory = "opposing";
  else if (isCritical) roleCategory = "critical";

  // Count how many of this type have been selected
  const countOfThisType = roleCountByType[roleCategory] || 0;

  // Bonus decreases as more of this type are selected
  const maxDesired = roleCategory === "evidence" ? 6 : 2;

  if (countOfThisType >= maxDesired) {
    return 0.0; // Penalty for over-selecting this role
  }

  return Math.max(0, 0.2 * (1 - countOfThisType / maxDesired));
}

/**
 * Estimate redundancy penalty (0-1): penalty for being too similar to already selected.
 */
function estimateRedundancyPenalty(candidate, selectedSoFar = []) {
  if (!selectedSoFar.length) return 0.0;

  const candidateText = normalizeTextForComparison(candidate.text || "");
  let maxSimilarity = 0;

  for (const selected of selectedSoFar) {
    const selectedText = normalizeTextForComparison(selected.text || "");
    const similarity = textSimilarity(candidateText, selectedText);
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }

  // Convert similarity to penalty: high similarity -> high penalty
  return Math.max(0, maxSimilarity - 0.4); // No penalty for <40% similarity
}

/**
 * Score a source/background candidate by usefulness for sourcing.
 */
function scoreSourceBackgroundCandidate(candidate) {
  let score = 0;

  // Named studies, documents, laws, datasets are highly valuable
  const namedStudiesOrDocuments = candidate.namedStudiesOrDocuments || [];
  if (namedStudiesOrDocuments.length) {
    score += Math.min(0.4, namedStudiesOrDocuments.length * 0.2);
  }

  // Named actors/organizations are valuable for context
  const namedEntities = candidate.namedEntities || [];
  if (namedEntities.length) {
    score += Math.min(0.3, namedEntities.length * 0.15);
  }

  // Dates, numbers, statistics are useful facts
  const dates = candidate.dates || [];
  if (dates.length) {
    score += Math.min(0.15, dates.length * 0.10);
  }

  // Attribution claims are useful for understanding provenance
  if (candidate.relationshipType === "provenance" || candidate.isAttribution) {
    score += 0.2;
  }

  // Citation breadcrumbs (links to studies, documents, etc.)
  if (candidate.sourceCitedInArticle || candidate.localSourceExcerpt) {
    score += 0.15;
  }

  // Source excerpt quality
  const sourceExcerpt = candidate.localSourceExcerpt || candidate.sourceCitedInArticle || "";
  if (sourceExcerpt.length > 50) {
    score += 0.1;
  }

  // Reject generic filler
  const text = candidate.text || "";
  if (isGenericFiller(text)) {
    score -= 0.5;
  }

  return Math.max(0, Math.min(1.0, score));
}

/**
 * Check if a claim is generic filler (not useful for sourcing).
 */
function isGenericFiller(text) {
  // Common generic phrases that don't provide useful source context
  const genericPatterns = [
    /^(the|a|some|many|some of the|a lot of|various)\b/i,
    /^\w+\s+(said|said that|stated|believe|think|found|show)/i,
    /^(this|that|it)\s+(is|was|could be|might be|seems to be)\s+(important|significant|notable|interesting|clear)/i,
    /^(according to|based on|due to)\s+\w+/i,
  ];

  return genericPatterns.some((pattern) => pattern.test(text));
}

/**
 * Normalize text for comparison by removing punctuation and extra whitespace.
 */
function normalizeTextForComparison(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculate text similarity using Jaccard similarity on word sets.
 */
function textSimilarity(text1, text2) {
  const words1 = new Set(text1.split(" ").filter(Boolean));
  const words2 = new Set(text2.split(" ").filter(Boolean));

  if (words1.size === 0 && words2.size === 0) return 1.0;
  if (words1.size === 0 || words2.size === 0) return 0.0;

  let shared = 0;
  for (const word of words1) {
    if (words2.has(word)) shared += 1;
  }

  const union = words1.size + words2.size - shared;
  return shared / union;
}

/**
 * Reducer A: Select high-value evaluation claims (thesis/pillars/evidence/opposing/critical).
 *
 * @param {array} clusteredCandidates - Candidates from Prompt 7 (assertion clustering)
 * @param {object} finalFrame - Final frame from Prompt 6 (theme fusion)
 * @param {number} maxEvaluationClaims - Maximum evaluation claims to select (default 12)
 * @returns {object} { selectedEvaluationClaims, logs }
 */
export function reduceToEvaluationClaims(
  clusteredCandidates = [],
  finalFrame = {},
  maxEvaluationClaims = DEFAULT_EVALUATION_MAX
) {
  const startLog = `[EVALUATION_CLAIMS_REDUCER] Starting reduction with ${clusteredCandidates.length} candidates (max: ${maxEvaluationClaims})`;
  logger.log(startLog);

  if (!clusteredCandidates.length) {
    const noLogsMessage = "[EVALUATION_CLAIMS_REDUCER] No candidates to reduce";
    logger.log(noLogsMessage);
    return { selectedEvaluationClaims: [], logs: [startLog, noLogsMessage] };
  }

  // Filter candidates eligible for evaluation
  const eligibleCandidates = clusteredCandidates.filter((c) => {
    // Must be eligible for evaluation
    if (c.evaluationEligible === false) return false;

    // Reject pure background claims in evaluation context
    if (c.role === "background" && c.argumentFunction === "background") return false;

    // Prefer claims with clear roles
    const role = c.role || c.argumentFunction || "";
    const evaluationRoles = [
      "thesis",
      "pillar",
      "pillar_support",
      "evidence",
      "opposing",
      "counterargument",
      "supporting_premise",
    ];

    if (role && !evaluationRoles.includes(role)) {
      // Allow fallibility-critical claims even if they don't have standard roles
      if (!c.isFallibilityCritical) return false;
    }

    return true;
  });

  logger.log(`[EVALUATION_CLAIMS_REDUCER] Filtered to ${eligibleCandidates.length} eligible candidates`);

  // Score each candidate
  const dominantAnchors = new Set(finalFrame.dominantNamedAnchors || []);
  const scoredCandidates = [];

  for (const candidate of eligibleCandidates) {
    const { score, breakdown } = scoreEvaluationCandidate(candidate, {
      finalFrame,
      dominantAnchors,
      selectedSoFar: scoredCandidates.map((sc) => sc.candidate),
      roleCountByType: countRoleTypes(scoredCandidates.map((sc) => sc.candidate)),
    });

    scoredCandidates.push({
      candidate,
      score,
      breakdown,
    });
  }

  // Sort by score descending
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Select top N
  const selected = scoredCandidates.slice(0, maxEvaluationClaims).map((sc) => {
    const candidate = sc.candidate;
    return {
      ...candidate,
      selectedForEvaluation: true,
      evaluationEligible: true,
      verdictEligible: true,
      searchEligible: true,
      visibility: "workspace_eval",
      selectionScore: sc.score,
      selectionBreakdown: sc.breakdown,
    };
  });

  // Log selection metrics
  const roleDistribution = countRoleTypes(selected);
  const pillarCoverageCount = (finalFrame.finalPillars || []).filter((p) =>
    selected.some((s) => p.representativeCandidateIds?.includes(s.id))
  ).length;

  const logs = [
    `[EVALUATION_CLAIMS_SELECTED] Selected ${selected.length}/${eligibleCandidates.length} eligible candidates`,
    `[EVALUATION_CLAIMS_SELECTED] Role distribution: ${JSON.stringify(roleDistribution)}`,
    `[EVALUATION_CLAIMS_SELECTED] Pillar coverage: ${pillarCoverageCount}/${(finalFrame.finalPillars || []).length} pillars`,
    `[EVALUATION_CLAIMS_SELECTED] Score range: ${selected.length ? `${(selected[selected.length - 1]?.selectionScore ?? 0).toFixed(3)}-${(selected[0]?.selectionScore ?? 0).toFixed(3)}` : "N/A"}`,
  ];

  for (const log of logs) {
    logger.log(log);
  }

  return { selectedEvaluationClaims: selected, logs };
}

/**
 * Reducer B: Select useful source/background claims.
 *
 * @param {array} clusteredCandidates - Candidates from Prompt 7 (assertion clustering)
 * @param {array} evaluationClaims - Already-selected evaluation claims (to avoid duplication)
 * @param {number} maxBackgroundClaims - Maximum background claims to select (default 12)
 * @returns {object} { selectedSourceBackgroundClaims, logs }
 */
export function reduceToSourceBackgroundClaims(
  clusteredCandidates = [],
  evaluationClaims = [],
  maxBackgroundClaims = DEFAULT_BACKGROUND_MAX
) {
  const startLog = `[BACKGROUND_CLAIMS_REDUCER] Starting reduction with ${clusteredCandidates.length} candidates (max: ${maxBackgroundClaims})`;
  logger.log(startLog);

  if (!clusteredCandidates.length) {
    const noLogsMessage = "[BACKGROUND_CLAIMS_REDUCER] No candidates to reduce";
    logger.log(noLogsMessage);
    return { selectedSourceBackgroundClaims: [], logs: [startLog, noLogsMessage] };
  }

  // Exclude already-selected evaluation claims
  const evaluationClaimIds = new Set(evaluationClaims.map((c) => c.id));

  // Filter candidates eligible for background/source context
  const eligibleCandidates = clusteredCandidates.filter((c) => {
    // Exclude evaluation claims already selected
    if (evaluationClaimIds.has(c.id)) return false;

    // Prefer background-marked claims
    const role = c.role || c.argumentFunction || "";
    if (role === "background") return true;

    // Also include claims useful for source context (with named studies, entities, etc.)
    const hasNamedStudiesOrDocuments = (c.namedStudiesOrDocuments || []).length > 0;
    const hasNamedEntities = (c.namedEntities || []).length > 0;
    const hasDates = (c.dates || []).length > 0;
    const hasAttribution = c.relationshipType === "provenance" || c.isAttribution;

    if (hasNamedStudiesOrDocuments || hasNamedEntities || hasAttribution || hasDates) {
      // Reject generic filler unless it's attributed or has named entities
      if (!isGenericFiller(c.text || "") || hasAttribution || hasNamedEntities || hasNamedStudiesOrDocuments) {
        return true;
      }
    }

    return false;
  });

  logger.log(`[BACKGROUND_CLAIMS_REDUCER] Filtered to ${eligibleCandidates.length} eligible candidates`);

  // Score each candidate
  const scoredCandidates = [];

  for (const candidate of eligibleCandidates) {
    const score = scoreSourceBackgroundCandidate(candidate);

    if (score > 0) {
      // Skip very low-value candidates
      scoredCandidates.push({
        candidate,
        score,
      });
    }
  }

  // Sort by score descending
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Select top N
  const selected = scoredCandidates.slice(0, maxBackgroundClaims).map((sc) => {
    const candidate = sc.candidate;
    return {
      ...candidate,
      role: candidate.role === "background" ? "background" : "background", // Normalize
      argumentFunction: "background",
      selectedForEvaluation: false,
      evaluationEligible: false,
      verdictEligible: false,
      searchEligible: false,
      sourceEligible: true,
      visibility: "workspace_background",
      selectionScore: sc.score,
    };
  });

  // Log usefulness distribution
  const usefulnessCategories = {
    named_studies: 0,
    named_entities: 0,
    attribution: 0,
    dates_numbers: 0,
    other: 0,
  };

  for (const item of selected) {
    if ((item.namedStudiesOrDocuments || []).length > 0) usefulnessCategories.named_studies += 1;
    else if ((item.namedEntities || []).length > 0) usefulnessCategories.named_entities += 1;
    else if (item.relationshipType === "provenance") usefulnessCategories.attribution += 1;
    else if ((item.dates || []).length > 0) usefulnessCategories.dates_numbers += 1;
    else usefulnessCategories.other += 1;
  }

  const logs = [
    `[BACKGROUND_CLAIMS_SELECTED] Selected ${selected.length}/${clusteredCandidates.length} candidates`,
    `[BACKGROUND_CLAIMS_SELECTED] Usefulness distribution: ${JSON.stringify(usefulnessCategories)}`,
    `[BACKGROUND_CLAIMS_SELECTED] Score range: ${selected.length ? `${(selected[selected.length - 1]?.selectionScore ?? 0).toFixed(3)}-${(selected[0]?.selectionScore ?? 0).toFixed(3)}` : "N/A"}`,
  ];

  for (const log of logs) {
    logger.log(log);
  }

  return { selectedSourceBackgroundClaims: selected, logs };
}

/**
 * Count claim roles to track diversity.
 */
function countRoleTypes(claims) {
  const counts = {
    thesis: 0,
    pillar: 0,
    evidence: 0,
    opposing: 0,
    critical: 0,
    other: 0,
  };

  for (const claim of claims) {
    const role = claim.role || claim.argumentFunction || "evidence";
    const isCritical = claim.isFallibilityCritical ?? false;

    if (role === "thesis") counts.thesis += 1;
    else if (role === "pillar" || role === "pillar_support") counts.pillar += 1;
    else if (role === "opposing" || role === "counterargument") counts.opposing += 1;
    else if (isCritical) counts.critical += 1;
    else if (role === "evidence" || role === "supporting_premise") counts.evidence += 1;
    else counts.other += 1;
  }

  return counts;
}

/**
 * Apply both reducers and return combined results.
 *
 * @param {array} clusteredCandidates - Candidates from Prompt 7
 * @param {object} finalFrame - Final frame from Prompt 6
 * @param {object} options - Configuration options
 * @param {number} options.maxEvaluationClaims - Max evaluation claims (default 12)
 * @param {number} options.maxBackgroundClaims - Max background claims (default 12)
 * @returns {object} { selectedEvaluationClaims, selectedSourceBackgroundClaims, logs }
 */
export function reduceClaimsForDocumentEvaluation(
  clusteredCandidates = [],
  finalFrame = {},
  options = {}
) {
  const { maxEvaluationClaims = DEFAULT_EVALUATION_MAX, maxBackgroundClaims = DEFAULT_BACKGROUND_MAX } =
    options;

  logger.log(
    `[CLAIMS_REDUCTION] Starting document-level claim reduction (${clusteredCandidates.length} candidates)`
  );

  const evaluationResult = reduceToEvaluationClaims(
    clusteredCandidates,
    finalFrame,
    maxEvaluationClaims
  );

  const backgroundResult = reduceToSourceBackgroundClaims(
    clusteredCandidates,
    evaluationResult.selectedEvaluationClaims,
    maxBackgroundClaims
  );

  const allLogs = [
    ...evaluationResult.logs,
    ...backgroundResult.logs,
    `[CLAIMS_REDUCTION_COMPLETE] Evaluation: ${evaluationResult.selectedEvaluationClaims.length}, Background: ${backgroundResult.selectedSourceBackgroundClaims.length}`,
  ];

  for (const log of allLogs) {
    logger.log(log);
  }

  return {
    selectedEvaluationClaims: evaluationResult.selectedEvaluationClaims,
    selectedSourceBackgroundClaims: backgroundResult.selectedSourceBackgroundClaims,
    logs: allLogs,
  };
}
