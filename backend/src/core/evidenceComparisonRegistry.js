import { buildEvidencePacket } from "./evidencePacketBuilder.js";
import {
  allocateCandidatesAcrossClaims,
  selectCandidatesForClaim,
  selectClaimsForBearingGating,
} from "./evidenceCandidateSelector.js";

const MAX_RUNS = 50;
const RUN_TTL_MS = 24 * 60 * 60 * 1000;
const runs = new Map();

function bounded(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanCandidate(candidate = {}) {
  return {
    id: candidate.id || null,
    url: bounded(candidate.url, 1200),
    title: bounded(candidate.title, 300),
    snippet: bounded(candidate.snippet, 800),
    provider: candidate.provider || candidate.source || "unknown",
    providerRank: candidate.providerRank ?? null,
    providerScore: candidate.providerScore ?? candidate.score ?? null,
    query: bounded(candidate.query, 500),
    domain: bounded(candidate.domain, 255),
    searchIntent: candidate.searchIntent || null,
    matchedPart: candidate.matchedPart || null,
    stanceGoal: candidate.stanceGoal || null,
    evidenceTargetId: candidate.evidenceTargetId || null,
    evidenceTargetType: candidate.evidenceTargetType || null,
    bearingRequirement: candidate.bearingRequirement || null,
    deterministicBearingScore: candidate.deterministicBearingScore ?? null,
    deterministicBearingDecision: candidate.deterministicBearingDecision || null,
    deterministicBearingReason: bounded(candidate.deterministicBearingReason || candidate.bearingShadowReason, 500),
    bearingShadowWouldScrape: candidate.bearingShadowWouldScrape ?? null,
    llmBearingPreScore: candidate.llmBearingPreScore ?? null,
    bearingPreScore: candidate.bearingPreScore ?? null,
    scorerDisagreement: candidate.scorerDisagreement ?? null,
    bearingType: candidate.bearingType || null,
    expectedStance: candidate.expectedStance || null,
    claimComponentAddressed: candidate.claimComponentAddressed || null,
    triageDecision: candidate.triageDecision || null,
  };
}

function cleanEvidence(item = {}, referenceContentIdByUrl = new Map()) {
  return {
    id: item.id || null,
    candidateId: item.candidateId || null,
    referenceContentId: item.referenceContentId || referenceContentIdByUrl.get(item.url) || null,
    url: bounded(item.url, 1200),
    title: bounded(item.title, 300),
    quote: bounded(item.quote, 1600),
    summary: bounded(item.summary, 800),
    stance: item.stance || "insufficient",
    quality: item.quality ?? null,
    qualityLabel: item.qualityScores?.quality_tier || null,
    bearingScore: item.bearingScore ?? null,
    bearingType: item.bearingType || null,
    bearingReason: bounded(item.bearingReason, 500),
    claimComponentAddressed: item.claimComponentAddressed || null,
    causalStrength: item.causalStrength || null,
    evidenceTargetId: item.evidenceTargetId || null,
    evidenceTargetType: item.evidenceTargetType || null,
    bearingRequirement: item.bearingRequirement || null,
    isFringe: Boolean(item.isFringe),
  };
}

function cleanClaim(claim = {}) {
  return {
    id: Number(claim.id || claim.claimId || 0),
    text: bounded(claim.originalText || claim.text, 1200),
    role: claim.role || null,
    scoreTransform: claim.scoreTransform || null,
    evidenceNeed: claim.evidenceNeed || null,
  };
}

function projectedAllocation(results, config) {
  const claims = results.map((result) => result.claim).filter(Boolean);
  const selectedClaims = selectClaimsForBearingGating(claims, config);
  const resultByClaim = new Map(results.map((result) => [Number(result.claim?.id), result]));
  const plans = selectedClaims.eligible.map((claim) => {
    const result = resultByClaim.get(Number(claim.id));
    return selectCandidatesForClaim(claim, result?.candidates || [], config);
  });
  const allocation = allocateCandidatesAcrossClaims(plans, config);
  return {
    selectedByClaimId: Object.fromEntries(
      [...allocation.selectedByClaimId.entries()].map(([claimId, candidates]) => [
        claimId,
        candidates.map(cleanCandidate),
      ]),
    ),
    uniqueUrls: [...allocation.usedCanonicalUrls],
    skippedClaims: selectedClaims.skipped.map(({ claim, reason }) => ({ claimId: claim.id, reason })),
  };
}

function purgeExpired() {
  const cutoff = Date.now() - RUN_TTL_MS;
  for (const [contentId, run] of runs.entries()) {
    if (run.completedAtMs < cutoff) runs.delete(contentId);
  }
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
}

export function recordEvidenceComparisonRun({
  contentId,
  startedAtMs,
  completedAtMs = Date.now(),
  results = [],
  aiReferences = [],
  bearingConfig,
  flags = {},
}) {
  if (!contentId || !bearingConfig) return null;
  const referenceContentIdByUrl = new Map(
    aiReferences.map((reference) => [reference.url, reference.referenceContentId || null]),
  );
  const cleanResults = results.map((result) => {
    const claim = cleanClaim(result.claim);
    const evidence = [...(result.evidence || []), ...(result.fringeEvidence || [])]
      .map((item) => cleanEvidence(item, referenceContentIdByUrl));
    const comparisonPacket = result.evidencePacket || buildEvidencePacket({
      claim: result.claim,
      evidence,
      minBearing: bearingConfig.minBearingForPacket,
      maxItems: bearingConfig.maxEvidencePacketItems,
      maxQuotesPerDocument: 2,
    });
    return {
      claim,
      candidates: (result.candidates || []).map(cleanCandidate),
      selectedCandidates: (result.selectedCandidates || []).map(cleanCandidate),
      evidence,
      evidencePacket: comparisonPacket,
      adjudication: result.adjudication ? {
        finalVerdict: result.adjudication.finalVerdict,
        confidence: result.adjudication.confidence,
      } : null,
    };
  });
  const snapshot = {
    version: 1,
    contentId: Number(contentId),
    startedAtMs: Number(startedAtMs) || completedAtMs,
    completedAtMs,
    elapsedMs: Math.max(0, completedAtMs - (Number(startedAtMs) || completedAtMs)),
    flags: {
      enableBearingShadow: Boolean(flags.enableBearingShadow),
      enableSnippetBearingLlm: Boolean(flags.enableSnippetBearingLlm),
      enableBearingGating: Boolean(flags.enableBearingGating),
      enableBearingPacket: Boolean(flags.enableBearingPacket),
      enableBearingPacketLive: Boolean(flags.enableBearingPacketLive),
    },
    bearingConfig: {
      version: bearingConfig.version || 1,
      minBearingToScrape: bearingConfig.minBearingToScrape,
      forceSkipBelowBearing: bearingConfig.forceSkipBelowBearing,
      maxClaimsSearchedPerContent: bearingConfig.maxClaimsSearchedPerContent,
      globalScrapeLimitPerContent: bearingConfig.globalScrapeLimitPerContent,
      perClaimLimits: bearingConfig.perClaimLimits,
    },
    results: cleanResults,
    projectedGating: projectedAllocation(cleanResults, bearingConfig),
  };
  runs.delete(Number(contentId));
  runs.set(Number(contentId), snapshot);
  purgeExpired();
  return snapshot;
}

export function getEvidenceComparisonRun(contentId) {
  purgeExpired();
  return runs.get(Number(contentId)) || null;
}

export function attachEvidenceComparisonTokenUsage(contentId, tokenUsage) {
  const snapshot = runs.get(Number(contentId));
  if (!snapshot || !tokenUsage) return null;
  snapshot.actualTokenUsage = {
    calls: Number(tokenUsage.calls) || 0,
    inputTokens: Number(tokenUsage.inputTokens) || 0,
    outputTokens: Number(tokenUsage.outputTokens) || 0,
    totalTokens: Number(tokenUsage.totalTokens) || 0,
    cachedInputTokens: Number(tokenUsage.cachedInputTokens) || 0,
    startedAtMs: Number(tokenUsage.startedAtMs) || null,
    completedAtMs: Number(tokenUsage.completedAtMs) || Date.now(),
    models: tokenUsage.models || {},
    phases: tokenUsage.phases || {},
  };
  return snapshot.actualTokenUsage;
}

export function clearEvidenceComparisonRunsForTest() {
  runs.clear();
}
