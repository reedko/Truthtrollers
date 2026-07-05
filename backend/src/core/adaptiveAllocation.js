// backend/src/core/adaptiveAllocation.js
//
// Step 19: coverage-first adaptive scrape allocation.
//
// Scarce scrape attempts must be spent covering UNCOVERED evidence roles, not
// handed out in equal round-robin slices of a polluted candidate list. This
// module derives, per claim, which coverage slots its targets need, maps each
// candidate to the slot it can serve (from verifiedDocumentRole + target type —
// never from query purpose or lexical overlap), and orders candidates so that
// uncovered, central slots are attempted first.
//
// It does NOT fetch, extract, coalesce, score articles, or build packets. It
// only orders attempts and emits an allocation audit.

import logger from "../utils/logger.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { deriveVerifiedDocumentRole } from "./candidateSurvival.js";

export const COVERAGE_SLOTS = Object.freeze({
  ATTRIBUTION: "attribution",
  STUDY_IDENTITY: "study_identity",
  ORIGINAL_OR_OFFICIAL_STUDY: "original_study_or_official_study_page",
  SUBSTANTIVE_CONDUCT: "substantive_conduct",
  METHODOLOGY_OR_REANALYSIS: "methodology_or_reanalysis",
  OFFICIAL_RESPONSE: "official_response",
  CAUSAL_BACKGROUND: "causal_background_or_inference",
});

// Centrality: how much a slot matters for a misconduct/study/data-handling
// claim. Study identity and the substantive conduct/data-handling need are the
// most central; broad causal background is least.
const SLOT_CENTRALITY = Object.freeze({
  study_identity: 6,
  substantive_conduct: 6,
  original_study_or_official_study_page: 5,
  methodology_or_reanalysis: 4,
  official_response: 3,
  attribution: 3,
  causal_background_or_inference: 2,
});

function slotCentrality(slot) {
  return SLOT_CENTRALITY[slot] || 0;
}

function canonicalKey(candidate) {
  return canonicalizeUrl(candidate?.url) || candidate?.url || candidate?.id || "";
}

function domainOf(candidate) {
  try { return new URL(candidate?.url || "").hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return String(candidate?.domain || "").toLowerCase(); }
}

function bearingOf(candidate) {
  const v = Number(candidate?.finalBearingScore ?? candidate?.bearingPreScore ?? candidate?.deterministicBearingScore);
  return Number.isFinite(v) ? v : 0;
}

function providerOf(candidate) {
  const v = Number(candidate?.score);
  return Number.isFinite(v) ? v : 0;
}

// The coverage slot a candidate can serve, from its OWN document role + target
// type. Amplifier sources (press release / news / advocacy) never occupy a
// study/methodology/substantive-proof slot — they are general/allegation fill.
export function coverageSlotForCandidate(candidate = {}) {
  const role = deriveVerifiedDocumentRole(candidate);
  const targetType = String(candidate.evidenceTargetType || "").toLowerCase();
  const roleName = role?.role || null;

  // A named amplifier cannot satisfy a substantive/study coverage slot; it is
  // allegation/narrative fill regardless of the target it was retrieved for.
  const isAmplifier = roleName === "advocacy_or_press_release_candidate" || roleName === "news_or_commentary_candidate";
  if (isAmplifier) return null;

  if (roleName === "primary_statement_candidate") return COVERAGE_SLOTS.ATTRIBUTION;
  if (roleName === "official_response_candidate") return COVERAGE_SLOTS.OFFICIAL_RESPONSE;
  if (roleName === "related_reanalysis_candidate" || roleName === "methodology_or_review_candidate") return COVERAGE_SLOTS.METHODOLOGY_OR_REANALYSIS;

  // A generic causal/background review must not occupy the substantive-conduct
  // slot unless it is specifically a reanalysis (handled above).
  if (["systematic_review", "meta_analysis", "dataset"].includes(targetType)) return COVERAGE_SLOTS.CAUSAL_BACKGROUND;

  if (roleName === "original_study_candidate") {
    return targetType === "attribution" ? COVERAGE_SLOTS.ATTRIBUTION : COVERAGE_SLOTS.ORIGINAL_OR_OFFICIAL_STUDY;
  }
  if (roleName === "official_study_page_candidate") return COVERAGE_SLOTS.ORIGINAL_OR_OFFICIAL_STUDY;

  // Fall back to the evaluation target type.
  if (targetType === "attribution") return COVERAGE_SLOTS.ATTRIBUTION;
  if (targetType === "study_identity") return COVERAGE_SLOTS.STUDY_IDENTITY;
  if (["original_study", "official_statement"].includes(targetType)) return COVERAGE_SLOTS.ORIGINAL_OR_OFFICIAL_STUDY;
  if (["substantive", "primary_source"].includes(targetType)) return COVERAGE_SLOTS.SUBSTANTIVE_CONDUCT;
  return null; // general fill
}

// The coverage slots a claim's targets require, from existing target types only.
export function requiredCoverageSlotsForClaim(claim = {}) {
  const slots = new Set();
  const targets = Array.isArray(claim.evaluationTargets) ? claim.evaluationTargets
    : Array.isArray(claim.evidenceNeed?.evidenceTargets) ? claim.evidenceNeed.evidenceTargets
    : [];
  for (const target of targets) {
    const t = String(target.evaluationTargetType || target.evidenceTargetType || "").toLowerCase();
    if (t === "attribution" || t === "attribution_statement") slots.add(COVERAGE_SLOTS.ATTRIBUTION);
    else if (t === "study_identity") slots.add(COVERAGE_SLOTS.STUDY_IDENTITY);
    else if (["original_study", "official_statement"].includes(t)) slots.add(COVERAGE_SLOTS.ORIGINAL_OR_OFFICIAL_STUDY);
    else if (["substantive", "primary_source"].includes(t)) slots.add(COVERAGE_SLOTS.SUBSTANTIVE_CONDUCT);
    else if (["systematic_review", "meta_analysis", "dataset"].includes(t)) slots.add(COVERAGE_SLOTS.CAUSAL_BACKGROUND);
  }
  return slots;
}

function isIndependent(candidate) {
  const role = deriveVerifiedDocumentRole(candidate);
  return Boolean(role?.verified) &&
    role.role !== "advocacy_or_press_release_candidate" &&
    role.role !== "news_or_commentary_candidate";
}

// Score one candidate assignment given the slots already covered and the domains
// already attempted (E). Higher is better. Coverage of an uncovered required
// slot dominates; provider score is only a final tie-break (F).
function scoreAssignment(candidate, { requiredSlots, coveredSlots, attemptedDomains }) {
  const slot = coverageSlotForCandidate(candidate);
  const coversUncovered = Boolean(slot) && requiredSlots.has(slot) && !coveredSlots.has(slot); // (A)
  const centrality = slotCentrality(slot);                                                     // (B)
  const compatible = Boolean(slot);                                                             // (C) role maps to a real slot
  const bearing = bearingOf(candidate);                                                         // (D)
  const independent = isIndependent(candidate);                                                 // (E)
  const duplicateDomain = attemptedDomains.has(domainOf(candidate));                            // (E)
  // Composite, lexicographically dominated by coverage then centrality.
  const coverageScore =
    (coversUncovered ? 1000 : 0) +
    (compatible ? 100 : 0) +
    centrality * 10 +
    bearing * 5 +
    (independent ? 2 : 0) -
    (duplicateDomain ? 3 : 0) +
    providerOf(candidate) * 0.5;
  return { slot, coversUncovered, centrality, compatible, bearing, independent, duplicateDomain, coverageScore };
}

/**
 * Order a claim's candidates coverage-first. Greedy: repeatedly take the highest
 * coverage-scored candidate given what is already covered/attempted, mark its
 * slot covered, and continue. Returns the reordered candidates plus per-candidate
 * audit rows. Does not mutate inputs.
 */
export function rankCandidatesByCoverage(claim, candidates = [], options = {}) {
  const requiredSlots = requiredCoverageSlotsForClaim(claim);
  const coveredSlots = new Set(options.alreadyCoveredSlots || []);
  const attemptedDomains = new Set(options.attemptedDomains || []);
  const remaining = candidates.filter(Boolean).map((candidate) => ({ candidate }));
  const ordered = [];
  const auditRows = [];
  let rank = 0;

  while (remaining.length) {
    let bestIndex = 0;
    let best = scoreAssignment(remaining[0].candidate, { requiredSlots, coveredSlots, attemptedDomains });
    for (let i = 1; i < remaining.length; i += 1) {
      const s = scoreAssignment(remaining[i].candidate, { requiredSlots, coveredSlots, attemptedDomains });
      if (s.coverageScore > best.coverageScore) { best = s; bestIndex = i; }
    }
    const { candidate } = remaining.splice(bestIndex, 1)[0];
    rank += 1;
    const uncoveredBefore = [...requiredSlots].filter((slot) => !coveredSlots.has(slot));
    if (best.coversUncovered) coveredSlots.add(best.slot);
    attemptedDomains.add(domainOf(candidate));
    const role = deriveVerifiedDocumentRole(candidate);
    ordered.push(candidate);
    auditRows.push({
      claimId: claim?.id ?? null,
      targetId: candidate.evidenceTargetId ?? null,
      targetType: candidate.evidenceTargetType || null,
      title: String(candidate.title || "").slice(0, 200),
      canonicalUrl: canonicalKey(candidate).slice(0, 500),
      sourceRole: role?.role || null,
      finalBearingScore: bearingOf(candidate),
      uncoveredCoverageSlot: best.coversUncovered ? best.slot : null,
      coverageSlot: best.slot,
      coverageScore: Math.round(best.coverageScore * 100) / 100,
      allocationRank: rank,
      coversUncovered: best.coversUncovered,
      deferredReason: best.coversUncovered ? null
        : best.slot ? "slot_already_covered_or_not_required"
        : "general_fill_no_coverage_slot",
      uncoveredCoverageBefore: uncoveredBefore,
    });
  }
  return { ordered, auditRows, requiredSlots: [...requiredSlots], coveredSlots: [...coveredSlots] };
}

export function logAdaptiveAllocationAudit({ taskContentId = null, claim, auditRows, claimAttemptCount = null, globalAttemptCount = null }) {
  logger.log(`[ADAPTIVE_ALLOCATION_AUDIT] ${JSON.stringify({
    event: "adaptive_allocation_audit",
    taskContentId,
    claimId: claim?.id ?? null,
    claimAttemptCount,
    globalAttemptCount,
    assignments: (auditRows || []).slice(0, 24),
  })}`);
}
