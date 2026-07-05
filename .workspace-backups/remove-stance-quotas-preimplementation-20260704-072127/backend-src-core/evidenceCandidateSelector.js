import logger from "../utils/logger.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { getPerClaimBearingLimit } from "./bearingConfig.js";

function bounded(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function candidateKey(candidate) {
  return canonicalizeUrl(candidate?.url) || candidate?.url || candidate?.id || "";
}

function candidateScore(candidate) {
  const combined = Number(candidate?.bearingPreScore);
  if (Number.isFinite(combined)) return Math.max(0, Math.min(1, combined));
  const deterministic = Number(candidate?.deterministicBearingScore);
  return Number.isFinite(deterministic) ? Math.max(0, Math.min(1, deterministic)) : 0;
}

function isOriginCandidate(candidate) {
  // Query intent describes what the search asked for, not what the returned
  // document actually is. Only a separately verified document identity may
  // receive origin protection.
  return candidate?.protectedDocumentIdentity === true || candidate?.verifiedOriginDocument === true;
}

function isSteelmanCandidate(candidate) {
  return candidate?.bearingType === "steelman" || candidate?.stanceGoal === "steelman";
}

function isLimitationCandidate(candidate) {
  return candidate?.expectedStance === "nuance" ||
    candidate?.stanceGoal === "limitations" ||
    candidate?.claimComponentAddressed === "scope" ||
    candidate?.claimComponentAddressed === "warrant";
}

function isDirectCandidate(candidate) {
  return candidate?.bearingType === "direct" ||
    candidate?.claimComponentAddressed === "whole_claim" ||
    candidate?.claimComponentAddressed === "relation" ||
    candidate?.claimComponentAddressed === "object";
}

/**
 * Phase 4 live canonical merge. It is called only from the gated path. The
 * legacy path continues using its existing exact URL dedupe.
 */
export function mergeCanonicalCandidates(candidates = []) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (!key) continue;
    const existing = groups.get(key);
    const provenance = {
      provider: candidate.provider || candidate.source || "unknown",
      providerRank: candidate.providerRank ?? null,
      query: candidate.query || null,
      searchIntent: candidate.searchIntent || null,
      stanceGoal: candidate.stanceGoal || null,
      evidenceTargetType: candidate.evidenceTargetType || null,
      evidenceTargetId: candidate.evidenceTargetId || null,
      bearingRequirement: candidate.bearingRequirement || null,
    };
    if (!existing) {
      groups.set(key, {
        ...candidate,
        canonicalUrl: key,
        retrievalProvenance: [provenance],
      });
      continue;
    }
    const better = candidateScore(candidate) > candidateScore(existing) ? candidate : existing;
    groups.set(key, {
      ...better,
      canonicalUrl: key,
      retrievalProvenance: [...existing.retrievalProvenance, provenance],
      protectedDocumentIdentity: Boolean(existing.protectedDocumentIdentity || candidate.protectedDocumentIdentity),
      identityBearingScore: Math.max(
        Number(existing.identityBearingScore) || 0,
        Number(candidate.identityBearingScore) || 0,
      ) || null,
      identityBearingType: candidate.identityBearingScore > existing.identityBearingScore
        ? candidate.identityBearingType
        : existing.identityBearingType || candidate.identityBearingType,
      identityBearingRationale: candidate.identityBearingScore > existing.identityBearingScore
        ? candidate.identityBearingRationale
        : existing.identityBearingRationale || candidate.identityBearingRationale,
      identityTargetId: existing.identityTargetId || candidate.identityTargetId || null,
    });
  }
  return [...groups.values()];
}

export function selectClaimsForBearingGating(claims = [], config) {
  const candidates = [];
  const skipped = [];
  for (const claim of claims) {
    const role = String(claim?.role || "").toLowerCase();
    const argumentFunction = String(claim?.argumentFunction || "").toLowerCase();
    if (role === "background" || argumentFunction === "background") {
      skipped.push({ claim, reason: "background_claim" });
      continue;
    }
    const hasSearchableSubstantiveTarget = (claim?.evaluationTargets || []).some((target) => {
      const type = String(target?.targetType || target?.target_type || "").toLowerCase();
      return target?.searchEligible !== false && target?.search_eligible !== 0 &&
        target?.verdictEligible !== false && target?.verdict_eligible !== 0 &&
        ["substantive", "inference"].includes(type);
    });
    // scoreTransform controls how a finding affects the article's aggregate
    // score. It is not permission to suppress a separately searchable object
    // proposition carried by a neutral attribution.
    if (claim?.scoreTransform === "none" && !hasSearchableSubstantiveTarget) {
      skipped.push({ claim, reason: "score_transform_none" });
      continue;
    }
    candidates.push(claim);
  }

  // The upstream claim list is relevance-sorted. Preserve that ordering, but
  // reserve the first slot for an explicitly identified thesis so the global
  // claim cap can never silently remove the case's central claim.
  const theses = candidates.filter((claim) =>
    String(claim?.role || claim?.argumentFunction || "").toLowerCase() === "thesis"
  );
  const nonTheses = candidates.filter((claim) => !theses.includes(claim));
  const ranked = [...theses, ...nonTheses];
  const eligible = ranked.slice(0, config.maxClaimsSearchedPerContent);
  const eligibleSet = new Set(eligible);
  for (const claim of candidates) {
    if (!eligibleSet.has(claim)) skipped.push({ claim, reason: "max_claims_searched" });
  }
  return { eligible, skipped };
}

function addUnique(selected, candidate, selectionReason) {
  if (!candidate) return false;
  const key = candidateKey(candidate);
  if (!key || selected.some((item) => candidateKey(item) === key)) return false;
  selected.push({ ...candidate, gatingSelectionReason: selectionReason });
  return true;
}

export function selectCandidatesForClaim(claim, candidates = [], config, options = {}) {
  const perClaimLimit = options.perClaimLimit ?? getPerClaimBearingLimit(claim, config);
  if (perClaimLimit <= 0) {
    return {
      claim,
      mergedCandidates: mergeCanonicalCandidates(candidates),
      selectedCandidates: [],
      rankedCandidates: [],
      expansionCandidates: [],
      decisions: candidates.map((candidate) => ({ candidate, decision: "skip", reason: "per_claim_limit_zero" })),
      perClaimLimit,
    };
  }

  const mergedCandidates = mergeCanonicalCandidates(candidates);
  const decisions = [];
  const eligible = [];
  const uncertain = [];
  for (const candidate of mergedCandidates) {
    const score = candidateScore(candidate);
    const origin = isOriginCandidate(candidate);
    const steelman = isSteelmanCandidate(candidate);
    const disagreement = Number(candidate?.scorerDisagreement);
    const llmAvailable = Number.isFinite(Number(candidate?.llmBearingPreScore));
    const forceThreshold = llmAvailable
      ? config.forceSkipBelowBearing
      : config.deterministicForceSkipBelow;
    const oneScorerHigh = Number(candidate?.llmBearingPreScore) >= config.minBearingToScrape ||
      Number(candidate?.deterministicBearingScore) >= config.minBearingToScrape;
    const highDisagreement = Number.isFinite(disagreement) && disagreement >= 0.4;
    const protectedSteelman = steelman && (score >= forceThreshold || oneScorerHigh || highDisagreement);
    const explicitJunk = candidate?.excluded === true || candidate?.unsupported === true || !candidateKey(candidate);
    const forceSkip = explicitJunk;
    const passes = score >= config.minBearingToScrape || origin || protectedSteelman || highDisagreement;

    if (forceSkip) {
      decisions.push({ candidate, decision: "skip", reason: "force_skip_low_bearing", score });
    } else if (passes) {
      eligible.push({ ...candidate, gatingScore: score, protectedOrigin: origin, protectedSteelman });
      decisions.push({ candidate, decision: "eligible", reason: origin ? "protected_origin" : protectedSteelman ? "protected_steelman" : highDisagreement ? "scorer_disagreement" : "bearing_threshold", score });
    } else {
      uncertain.push({ ...candidate, gatingScore: score, protectedOrigin: origin, protectedSteelman });
      decisions.push({ candidate, decision: "maybe", reason: "below_bearing_threshold", score });
    }
  }

  eligible.sort((a, b) => (b.gatingScore - a.gatingScore) || ((b.score ?? 0) - (a.score ?? 0)));
  uncertain.sort((a, b) =>
    (b.gatingScore - a.gatingScore) ||
    ((a.providerRank ?? Number.MAX_SAFE_INTEGER) - (b.providerRank ?? Number.MAX_SAFE_INTEGER)) ||
    ((b.score ?? 0) - (a.score ?? 0))
  );
  const selected = [];
  const identities = eligible
    .filter((candidate) => candidate.protectedDocumentIdentity)
    .sort((a, b) => (Number(b.identityBearingScore) || 0) - (Number(a.identityBearingScore) || 0));
  const verifiedIdentityLimit = Math.min(3, Math.max(config.maxIdentitySlotsPerClaim ?? 0, identities.length));
  for (const candidate of identities.slice(0, verifiedIdentityLimit)) {
    if (selected.length >= perClaimLimit) break;
    addUnique(selected, candidate, "document_identity_slot");
  }
  const origins = eligible.filter((candidate) => candidate.protectedOrigin);
  for (const candidate of origins.slice(0, config.maxOriginSlotsPerClaim)) {
    if (selected.length >= perClaimLimit) break;
    addUnique(selected, candidate, "origin_slot");
  }
  const bestRemaining = eligible.find((candidate) =>
    !selected.some((item) => candidateKey(item) === candidateKey(candidate))
  );
  const bestDirect = eligible.find((candidate) =>
    isDirectCandidate(candidate) &&
    !selected.some((item) => candidateKey(item) === candidateKey(candidate))
  );
  // Directness is useful only when it is competitive. The old unconditional
  // direct slot selected a much weaker Wakefield page ahead of stronger
  // Thompson/CDC-specific candidates.
  const directIsCompetitive = bestDirect && (
    !bestRemaining || candidateScore(bestDirect) >= candidateScore(bestRemaining) - 0.15
  );
  addUnique(selected, directIsCompetitive ? bestDirect : bestRemaining, directIsCompetitive ? "best_direct" : "best_ranked");

  const selectedStances = new Set(selected.map((candidate) => candidate.expectedStance).filter(Boolean));
  const diversityCandidate = eligible.find((candidate) =>
    candidate.expectedStance &&
    !["background", "insufficient"].includes(candidate.expectedStance) &&
    !selectedStances.has(candidate.expectedStance),
  );
  addUnique(selected, diversityCandidate, "stance_or_target_diversity");
  addUnique(selected, eligible.find(isLimitationCandidate), "material_limitation");

  const steelmen = eligible.filter((candidate) => candidate.protectedSteelman);
  for (const candidate of steelmen.slice(0, config.maxSteelmanSlotsPerClaim)) {
    if (selected.length >= perClaimLimit) break;
    addUnique(selected, candidate, "steelman_slot");
  }

  for (const candidate of eligible) {
    if (selected.length >= perClaimLimit) break;
    addUnique(selected, candidate, "bearing_rank");
  }

  if (selected.length === 0) {
    const fallback = uncertain[0];
    addUnique(selected, fallback, isOriginCandidate(fallback) ? "origin_fallback" : "single_best_fallback");
  }

  // Phase 6: selection defines the first tranche only. Snippet-low and
  // uncertain candidates remain in a stable ranked pool for post-scrape
  // adaptive expansion; snippet scoring is not a final exclusion authority.
  const rankedCandidates = [];
  // Every verified study-object document precedes ordinary candidates even
  // when the visible claim's first-tranche size is smaller than the number of
  // retained identity roles. The adaptive loop is therefore able to inspect
  // all (bounded to three) without provider rank or snippet score displacing
  // one of them.
  for (const candidate of [...identities.slice(0, 3), ...selected, ...eligible, ...uncertain]) {
    addUnique(rankedCandidates, candidate, candidate.gatingSelectionReason || "adaptive_pool");
  }
  const initialCandidates = selected.slice(0, perClaimLimit);
  const initialKeys = new Set(initialCandidates.map(candidateKey));

  return {
    claim,
    mergedCandidates,
    selectedCandidates: initialCandidates,
    rankedCandidates,
    expansionCandidates: rankedCandidates.filter((candidate) => !initialKeys.has(candidateKey(candidate))),
    decisions,
    perClaimLimit,
  };
}

export function allocateCandidatesAcrossClaims(plans = [], config) {
  const selectedByClaimId = new Map(plans.map((plan) => [Number(plan.claim.id), []]));
  const usedCanonicalUrls = new Set();
  const cursors = new Map(plans.map((plan) => [Number(plan.claim.id), 0]));
  const globalLimit = config.globalScrapeLimitPerContent;
  let progressed = true;

  while (progressed) {
    progressed = false;
    for (const plan of plans) {
      const claimId = Number(plan.claim.id);
      const cursor = cursors.get(claimId) || 0;
      if (cursor >= plan.selectedCandidates.length) continue;
      const candidate = plan.selectedCandidates[cursor];
      cursors.set(claimId, cursor + 1);
      progressed = true;
      const key = candidateKey(candidate);
      if (!key) continue;
      if (!usedCanonicalUrls.has(key) && usedCanonicalUrls.size >= globalLimit) continue;
      if (!usedCanonicalUrls.has(key)) usedCanonicalUrls.add(key);
      selectedByClaimId.get(claimId).push(candidate);
    }
  }

  return {
    selectedByClaimId,
    usedCanonicalUrls,
    globalLimit,
    remainingUniqueSlots: Math.max(0, globalLimit - usedCanonicalUrls.size),
  };
}

export function reserveAdditionalCandidates(candidates = [], allocation, limit = 1) {
  const selected = [];
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const key = candidateKey(candidate);
    if (!key) continue;
    if (!allocation.usedCanonicalUrls.has(key) && allocation.usedCanonicalUrls.size >= allocation.globalLimit) continue;
    if (!allocation.usedCanonicalUrls.has(key)) allocation.usedCanonicalUrls.add(key);
    selected.push(candidate);
  }
  allocation.remainingUniqueSlots = Math.max(0, allocation.globalLimit - allocation.usedCanonicalUrls.size);
  return selected;
}

export function logBearingGatingAudit({ taskContentId = null, claim, candidates, selectedCandidates, decisions }) {
  const selectedKeys = new Set(selectedCandidates.map(candidateKey));
  const logged = candidates.slice(0, 12);
  const record = {
    event: "bearing_gating",
    taskContentId,
    claimId: claim?.id ?? null,
    claimText: bounded(claim?.text, 500),
    candidateCount: candidates.length,
    selectedCount: selectedCandidates.length,
    omittedCandidateCount: Math.max(0, candidates.length - logged.length),
    selectedUrls: selectedCandidates.slice(0, 8).map((candidate) => bounded(candidate.url, 1000)),
    candidates: logged.map((candidate) => {
      const decision = decisions.find((item) => candidateKey(item.candidate) === candidateKey(candidate));
      return {
        url: bounded(candidate.url, 1000),
        score: candidateScore(candidate),
        selected: selectedKeys.has(candidateKey(candidate)),
        reason: bounded(decision?.reason || candidate.gatingSelectionReason, 300),
        origin: isOriginCandidate(candidate),
        steelman: isSteelmanCandidate(candidate),
      };
    }),
  };
  logger.log(`[BEARING_GATING] ${JSON.stringify(record)}`);
  return record;
}
