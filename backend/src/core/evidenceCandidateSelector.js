import logger from "../utils/logger.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { getPerClaimBearingLimit } from "./bearingConfig.js";
import { rankCandidatesByCoverage } from "./adaptiveAllocation.js";
import { deriveVerifiedDocumentRole, documentRolePriority } from "./candidateSurvival.js";

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

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function domainOf(candidate) {
  try {
    return new URL(candidate?.url || "").hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return String(candidate?.domain || "").toLowerCase().replace(/^www\./, "");
  }
}

function sourceSelectionTier(candidate) {
  const role = deriveVerifiedDocumentRole(candidate);
  const roleName = role?.role || "";
  if (role?.verified) return 5;
  if (roleName === "primary_statement_candidate" || roleName === "official_response_candidate") return 4;
  if (roleName === "original_study_candidate" || roleName === "official_study_page_candidate") return 3;
  if (roleName === "methodology_or_review_candidate" || roleName === "related_reanalysis_candidate") return 2;
  if (roleName === "news_or_commentary_candidate") return 1;
  if (roleName === "advocacy_or_press_release_candidate") return -1;
  return 0;
}

function purposeLane(candidate) {
  return String(candidate?.purposeLane || candidate?.retrievalPurpose || "alleged_conduct");
}

function quotaLane(candidate) {
  const laneId = String(candidate?.evidenceLaneId || "").toLowerCase();
  const targetType = String(candidate?.evidenceTargetType || "").toLowerCase();
  if (laneId.includes("study-identity") || targetType === "original_study") return "study_identity";
  if (laneId.includes("attribution")) return "attribution_provenance";
  if (laneId.includes("response") || targetType === "official_statement") return "official_response";
  if (laneId.includes("method") || laneId.includes("reanalysis")) return "methodology_reanalysis";
  if (laneId.includes("record") || laneId.includes("legal")) return "primary_record";
  const lane = purposeLane(candidate);
  if (lane === "study_identity" || lane === "original_document") return "study_identity";
  if (lane === "attribution_record" || lane === "source_context") return "attribution_provenance";
  if (lane === "official_response") return "official_response";
  if (lane === "independent_methodology" || lane === "independent_reanalysis" || lane === "inference_limitations") return "methodology_reanalysis";
  if (lane === "legal_or_policy_context") return "primary_record";
  return "target_primary";
}

function targetForCandidate(claim, candidate) {
  const targetId = String(candidate?.evidenceTargetId || "");
  return (claim?.evaluationTargets || []).find((target) =>
    targetId && String(target.evaluationTargetId || target.evidenceTargetId || target.id || "") === targetId
  ) || null;
}

function tokensFor(value) {
  return [...new Set(String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9%]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !/^(that|this|with|from|have|were|been|will|into|only|also|about|source|study|document|identify|underlying|record|related|claim|claims|needs|needed|disambiguation|referenced|article|described|specific|general|topic)$/.test(token))
  )];
}

function domainLooksOfficialForTarget(domain, target) {
  if (/\.(?:gov|edu)$/i.test(domain)) return true;
  const actorTokens = tokensFor([
    target?.subjectEntity,
    target?.studyAuthors,
    target?.studyTitle,
    ...(target?.bearingCriteria?.mustMatch || []),
  ].join(" ")).filter((token) => token.length >= 4);
  if (!actorTokens.length) return false;
  const compactDomain = String(domain || "").replace(/[^a-z0-9]+/g, "");
  return actorTokens.some((token) => compactDomain.includes(token));
}

function looksLikeThirdPartyRestatement(candidate, qLane, domain, target, role) {
  const url = String(candidate?.url || "").toLowerCase();
  const title = String(candidate?.title || "").toLowerCase();
  const text = `${title} ${url}`;
  if (role?.verified || candidate?.protectedDocumentIdentity) return false;
  if (qLane === "official_response") {
    const officialRole = role?.role === "primary_statement_candidate" || role?.role === "official_response_candidate";
    if (!officialRole && !domainLooksOfficialForTarget(domain, target)) return true;
  }
  return /\b(?:press-release|press_release|commentary|opinion|blog|petition|campaign|donate|anniversary)\b/.test(text);
}

function looksLikeGenericDataPortal(candidate, matchedAnchors = []) {
  const title = String(candidate?.title || "").toLowerCase();
  const url = String(candidate?.url || "").toLowerCase();
  if (/\bdata\.gov home\b/.test(title) || /^https?:\/\/(?:www\.)?data\.gov\/?$/i.test(candidate?.url || "")) {
    return true;
  }
  const distinctiveAnchors = matchedAnchors.filter((token) =>
    !["data", "linking", "study"].includes(token)
  );
  return distinctiveAnchors.length < 2 &&
    /\b(?:data\.gov home|data catalog|open data portal|dataset search)\b/.test(`${title} ${url}`);
}

function isOfficialStudyIdentityPage(candidate) {
  const role = deriveVerifiedDocumentRole(candidate);
  if (role?.role !== "official_study_page_candidate") return false;
  const lane = quotaLane(candidate);
  if (lane !== "study_identity") return false;
  const title = String(candidate?.title || "").toLowerCase();
  const url = String(candidate?.url || "").toLowerCase();
  return /\b(?:study|paper|analysis|report)\b/.test(title) || /\b(?:study|paper|analysis|report)\b/.test(url);
}

function isArchiveOrPointerWrapper(candidate) {
  const role = deriveVerifiedDocumentRole(candidate);
  if (role?.role === "original_study_candidate") return false;
  const lane = quotaLane(candidate);
  if (lane !== "study_identity" && lane !== "primary_record") return false;
  const title = String(candidate?.title || "").toLowerCase();
  const snippet = String(candidate?.snippet || candidate?.bearingText || "").toLowerCase();
  const url = String(candidate?.url || "").toLowerCase();
  let host = "";
  let path = "";
  try {
    const parsed = new URL(candidate?.url || "");
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    path = parsed.pathname.toLowerCase();
  } catch {
    // Leave host/path empty; title/snippet checks still apply.
  }
  const archiveLike = host.startsWith("archive.") ||
    host === "web.archive.org" ||
    /(?:^|[.-])archive(?:[.-]|$)/i.test(host) ||
    /\/(?:archive|archived|webcache)\//i.test(path) ||
    /\b(?:archived|archive notice|archived page|archived content)\b/.test(`${title} ${snippet}`);
  const pointerLike = /\b(?:study|paper|report|document|publication|article)\b/.test(`${title} ${snippet} ${path}`) &&
    /\b(?:about|notice|summary|page|safety|concerns|archive|archived)\b/.test(`${title} ${snippet} ${path}`);
  return archiveLike && pointerLike;
}

function annotateDeferredWrapperCandidates(candidates = []) {
  const canonicalByTarget = new Map();
  for (const candidate of candidates) {
    const role = deriveVerifiedDocumentRole(candidate);
    const targetId = candidate?.evidenceTargetId ? String(candidate.evidenceTargetId) : "";
    if (!targetId || role?.role !== "original_study_candidate" || !role?.verified) continue;
    const existing = canonicalByTarget.get(targetId);
    if (!existing || (Number(candidate.identityBearingScore) || 0) > (Number(existing.identityBearingScore) || 0)) {
      canonicalByTarget.set(targetId, candidate);
    }
  }
  if (!canonicalByTarget.size) return candidates;
  return candidates.map((candidate) => {
    const targetId = candidate?.evidenceTargetId ? String(candidate.evidenceTargetId) : "";
    const canonical = targetId ? canonicalByTarget.get(targetId) : null;
    if (!canonical || candidateKey(canonical) === candidateKey(candidate) || !isArchiveOrPointerWrapper(candidate)) {
      return candidate;
    }
    return {
      ...candidate,
      sourceWrapperDeferred: true,
      deferredToCanonicalUrl: canonical.url || canonical.canonicalUrl || candidateKey(canonical),
      deferredToCanonicalTitle: canonical.title || "",
      wrapperDeferredReason: "verified_original_study_for_same_target",
    };
  });
}

function looksLikeCommentaryOrReview(candidate) {
  const title = String(candidate?.title || "").toLowerCase();
  const url = String(candidate?.url || "").toLowerCase();
  return /\b(?:commentary|editorial|letter|opinion|review)\b/.test(`${title} ${url}`);
}

function retrievalPromiseForCandidate(claim, candidate) {
  const reasons = [];
  let score = 0.08;
  const lane = purposeLane(candidate);
  const qLane = quotaLane(candidate);
  const role = deriveVerifiedDocumentRole(candidate);
  const roleTier = sourceSelectionTier(candidate);
  const domain = domainOf(candidate);
  const url = String(candidate?.url || "");
  const haystack = [
    candidate?.title,
    candidate?.bearingText,
    candidate?.snippet,
    url,
    domain,
  ].join(" ").toLowerCase();
  const target = targetForCandidate(claim, candidate);
  const criteria = candidate?.bearingCriteria || target?.bearingCriteria || {};
  const anchorText = [
    target?.targetText,
    target?.primaryQueryText,
    candidate?.query,
    ...(criteria.mustMatch || []),
    ...(criteria.shouldMatch || []),
  ].join(" ");
  const anchors = tokensFor(anchorText).slice(0, 18);
  const matchedAnchors = anchors.filter((token) => haystack.includes(token));

  if (role?.verified) {
    score += 0.35;
    reasons.push(`verified_document:${role.role}`);
  } else if (roleTier > 0) {
    score += Math.min(0.2, roleTier * 0.04);
    reasons.push(`source_role:${role?.role || "classified"}`);
  }

  if (candidate?.academicApiContent?.apiBacked) {
    score += 0.22;
    reasons.push("api_abstract_or_metadata");
  }
  if (/\.pdf(?:$|[?#])/i.test(url)) {
    score += 0.16;
    reasons.push("pdf_or_primary_file");
  }
  if (/\.(?:gov|edu)$/i.test(domain) && roleTier >= 0) {
    score += 0.06;
    reasons.push("institutional_domain");
  } else if (domainLooksOfficialForTarget(domain, target) && roleTier >= 0) {
    score += 0.04;
    reasons.push("target_actor_domain");
  }
  if (["study_identity", "primary_record", "official_response", "methodology_reanalysis"].includes(qLane)) {
    score += 0.14;
    reasons.push(`role_lane:${qLane}`);
  } else if (lane) {
    score += 0.06;
    reasons.push(`role_lane:${qLane}`);
  }
  if (matchedAnchors.length) {
    score += Math.min(0.22, matchedAnchors.length * 0.035);
    reasons.push(`hard_anchors:${matchedAnchors.slice(0, 6).join(",")}`);
  }
  if (candidate?.protectedDocumentIdentity) {
    score += 0.25;
    reasons.push("protected_document_identity");
  }
  if (Number.isFinite(Number(candidate?.score))) {
    score += Math.min(0.08, Number(candidate.score) * 0.04);
    reasons.push("provider_rank_signal");
  }

  const snippetBearing = candidateScore(candidate);
  if (snippetBearing >= 0.55) {
    score += 0.08;
    reasons.push("high_snippet_bearing_signal");
  } else if (snippetBearing >= 0.25) {
    score += 0.04;
    reasons.push("some_snippet_bearing_signal");
  }

  const likelyRestatement = Boolean(candidate?.deterministicAllegationRepetition) ||
    String(candidate?.deterministicFallbackCategory || "").includes("allegation_repetition") ||
    String(candidate?.compatibilityLabel || "").includes("allegation_repetition");
  if (likelyRestatement && !["attribution_provenance", "primary_record"].includes(qLane)) {
    score = Math.min(score, 0.34);
    reasons.push("capped_likely_claim_restatement");
  }
  if (role?.role === "advocacy_or_press_release_candidate") {
    score = Math.min(score, 0.38);
    reasons.push("capped_advocacy_or_press_release");
  }
  if (looksLikeThirdPartyRestatement(candidate, qLane, domain, target, role)) {
    score = Math.min(score, qLane === "official_response" ? 0.2 : 0.32);
    reasons.push(qLane === "official_response" ? "capped_third_party_official_response" : "capped_third_party_restatement");
  }
  if (qLane === "study_identity" && looksLikeCommentaryOrReview(candidate)) {
    score = Math.min(score, 0.42);
    reasons.push("capped_commentary_or_review_for_study_identity");
  }
  if (looksLikeGenericDataPortal(candidate, matchedAnchors)) {
    score = Math.min(score, 0.18);
    reasons.push("capped_generic_data_portal");
  }
  if (candidate?.sourceWrapperDeferred) {
    score = Math.min(score, 0.12);
    reasons.push(`deferred_to_canonical:${String(candidate.deferredToCanonicalUrl || "").slice(0, 120)}`);
  }

  return {
    retrievalPromiseScore: clamp01(score),
    retrievalPromiseLane: qLane,
    retrievalPromiseReasons: reasons.slice(0, 8),
  };
}

function selectionComparator(a, b) {
  const promiseDiff = Number(b.retrievalPromiseScore || 0) - Number(a.retrievalPromiseScore || 0);
  if (promiseDiff !== 0) return promiseDiff;
  const tierDiff = sourceSelectionTier(b) - sourceSelectionTier(a);
  if (tierDiff !== 0) return tierDiff;
  const roleA = deriveVerifiedDocumentRole(a)?.role;
  const roleB = deriveVerifiedDocumentRole(b)?.role;
  const roleDiff = documentRolePriority(roleA) - documentRolePriority(roleB);
  if (roleDiff !== 0) return roleDiff;
  return (candidateScore(b) - candidateScore(a)) || ((b.score ?? 0) - (a.score ?? 0));
}

function isOriginCandidate(candidate) {
  // Query intent describes what the search asked for, not what the returned
  // document actually is. Only a separately verified document identity may
  // receive origin protection.
  return candidate?.protectedDocumentIdentity === true || candidate?.verifiedOriginDocument === true;
}

function isSteelmanCandidate(candidate) {
  // Only the post-retrieval bearing classification may mark a candidate as a
  // steelman. The query's purpose lane / legacy stanceGoal must never decide it.
  return candidate?.bearingType === "steelman";
}

function isLimitationCandidate(candidate) {
  // Determined from classified content (expectedStance / claimComponentAddressed),
  // never from the query's desired stance.
  return candidate?.expectedStance === "nuance" ||
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
      // Purpose lane the query pursued (never a stance). Kept for the
      // purposeLane -> classified-stance yield metric.
      purposeLane: candidate.purposeLane || candidate.retrievalPurpose || null,
      providerProfile: candidate.providerProfile || null,
      // Legacy fields retained (neutral) for backward compatibility only.
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

  const mergedCandidates = annotateDeferredWrapperCandidates(mergeCanonicalCandidates(candidates));
  const decisions = [];
  const eligible = [];
  const uncertain = [];
  for (const candidate of mergedCandidates) {
    const promise = retrievalPromiseForCandidate(claim, candidate);
    const scoredCandidate = { ...candidate, ...promise };
    const score = candidateScore(scoredCandidate);
    const promiseScore = scoredCandidate.retrievalPromiseScore;
    const origin = isOriginCandidate(scoredCandidate);
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
    const forceSkip = explicitJunk || candidate?.sourceWrapperDeferred === true;
    const passes = promiseScore >= 0.22 || origin || protectedSteelman || highDisagreement;

    if (forceSkip) {
      decisions.push({
        candidate: scoredCandidate,
        decision: "skip",
        reason: candidate?.sourceWrapperDeferred ? "deferred_to_verified_canonical_study" : "force_skip_explicit_junk",
        score,
        retrievalPromiseScore: promiseScore,
      });
    } else if (passes) {
      eligible.push({ ...scoredCandidate, gatingScore: promiseScore, snippetBearingGateScore: score, protectedOrigin: origin, protectedSteelman });
      decisions.push({
        candidate: scoredCandidate,
        decision: "eligible",
        reason: origin ? "protected_origin" : protectedSteelman ? "protected_steelman" : highDisagreement ? "scorer_disagreement" : "retrieval_promise",
        score,
        retrievalPromiseScore: promiseScore,
        retrievalPromiseLane: scoredCandidate.retrievalPromiseLane,
      });
    } else {
      uncertain.push({ ...scoredCandidate, gatingScore: promiseScore, snippetBearingGateScore: score, protectedOrigin: origin, protectedSteelman });
      decisions.push({ candidate: scoredCandidate, decision: "maybe", reason: "low_retrieval_promise", score, retrievalPromiseScore: promiseScore });
    }
  }

  eligible.sort(selectionComparator);
  uncertain.sort((a, b) =>
    (b.gatingScore - a.gatingScore) ||
    ((a.providerRank ?? Number.MAX_SAFE_INTEGER) - (b.providerRank ?? Number.MAX_SAFE_INTEGER)) ||
    ((b.score ?? 0) - (a.score ?? 0))
  );
  const selected = [];
  const studyIdentityQuota = perClaimLimit >= 6 ? 2 : 1;
  const targetPrimaryQuota = perClaimLimit >= 6 ? Math.max(2, perClaimLimit - 3) : Math.max(1, perClaimLimit);
  const laneQuota = new Map([
    ["study_identity", studyIdentityQuota],
    ["attribution_provenance", 1],
    ["official_response", 1],
    ["methodology_reanalysis", 1],
    ["primary_record", 1],
    ["target_primary", targetPrimaryQuota],
  ]);
  const laneCounts = new Map();
  const addLaneCandidate = (candidate, reason) => {
    if (!candidate || selected.length >= perClaimLimit) return false;
    const lane = candidate.retrievalPromiseLane || quotaLane(candidate);
    const limit = laneQuota.get(lane) ?? 1;
    const count = laneCounts.get(lane) || 0;
    if (count >= limit) return false;
    if (addUnique(selected, candidate, reason)) {
      laneCounts.set(lane, count + 1);
      return true;
    }
    return false;
  };
  const identities = eligible
    .filter((candidate) => candidate.protectedDocumentIdentity)
    .sort((a, b) => (Number(b.identityBearingScore) || 0) - (Number(a.identityBearingScore) || 0));
  const verifiedIdentityLimit = Math.min(3, Math.max(config.maxIdentitySlotsPerClaim ?? 0, identities.length));
  for (const candidate of identities.slice(0, verifiedIdentityLimit)) {
    if (selected.length >= perClaimLimit) break;
    addLaneCandidate(candidate, "document_identity_slot");
  }
  const origins = eligible.filter((candidate) => candidate.protectedOrigin);
  for (const candidate of origins.slice(0, config.maxOriginSlotsPerClaim)) {
    if (selected.length >= perClaimLimit) break;
    addLaneCandidate(candidate, "origin_slot");
  }
  if (studyIdentityQuota > 1) {
    const officialStudyPage = eligible.find((candidate) =>
      isOfficialStudyIdentityPage(candidate) &&
      !selected.some((selectedItem) => candidateKey(selectedItem) === candidateKey(candidate))
    );
    addLaneCandidate(officialStudyPage, "study_identity_official_page_slot");
  }
  for (const lane of ["study_identity", "primary_record", "official_response", "methodology_reanalysis", "attribution_provenance", "target_primary"]) {
    const candidate = eligible.find((item) =>
      (item.retrievalPromiseLane || quotaLane(item)) === lane &&
      !selected.some((selectedItem) => candidateKey(selectedItem) === candidateKey(item))
    );
    addLaneCandidate(candidate, `retrieval_role_slot:${lane}`);
  }

  const steelmen = eligible.filter((candidate) => candidate.protectedSteelman);
  for (const candidate of steelmen.slice(0, config.maxSteelmanSlotsPerClaim)) {
    if (selected.length >= perClaimLimit) break;
    addLaneCandidate(candidate, "steelman_slot");
  }

  for (const candidate of eligible) {
    if (selected.length >= perClaimLimit) break;
    addLaneCandidate(candidate, "retrieval_promise_rank");
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
  // Step 19: within each claim, order attempts coverage-first (uncovered central
  // target roles before general/low-coverage material). Fairness across claims
  // (the round-robin below) remains only as an anti-starvation secondary guard.
  const orderedPlans = plans.map((plan) => {
    const coverage = rankCandidatesByCoverage(plan.claim, plan.selectedCandidates || []);
    return { ...plan, selectedCandidates: coverage.ordered };
  });
  const selectedByClaimId = new Map(orderedPlans.map((plan) => [Number(plan.claim.id), []]));
  const usedCanonicalUrls = new Set();
  const cursors = new Map(orderedPlans.map((plan) => [Number(plan.claim.id), 0]));
  const globalLimit = config.globalScrapeLimitPerContent;
  let progressed = true;

  while (progressed) {
    progressed = false;
    for (const plan of orderedPlans) {
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

  // Metric: for each query purpose lane, what stance distribution did the
  // returned candidates actually classify to? This lets us observe whether a
  // lane tends to surface support/refute/nuance WITHOUT forcing stance at query
  // time. Stance here is the post-retrieval bearing classification, not intent.
  const selectedKeySet = new Set(selectedCandidates.map(candidateKey));
  const laneYield = {};
  for (const candidate of candidates) {
    const lane = candidate.purposeLane || candidate.retrievalPurpose || "unknown";
    const stance = candidate.expectedStance || "unclassified";
    const bucket = laneYield[lane] || (laneYield[lane] = { total: 0, selected: 0, stances: {} });
    bucket.total += 1;
    if (selectedKeySet.has(candidateKey(candidate))) bucket.selected += 1;
    bucket.stances[stance] = (bucket.stances[stance] || 0) + 1;
  }
  logger.log(`[PURPOSE_LANE_YIELD] ${JSON.stringify({
    event: "purpose_lane_stance_distribution",
    taskContentId,
    claimId: claim?.id ?? null,
    laneYield,
  })}`);

  return record;
}
