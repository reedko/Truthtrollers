import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import logger from "../utils/logger.js";
import { clusterAssertions, sourceFamilyOf } from "./assertionClustering.js";
import { evaluateTargetFit, TARGET_FIT_LABELS } from "./postScrapeTargetFit.js";

const VALID_STANCES = new Set(["support", "refute", "nuance"]);

// Step 21 labels that must never occupy a DIRECT substantive support/refute slot.
const NON_DIRECT_SUBSTANTIVE_LABELS = new Set([
  TARGET_FIT_LABELS.ATTRIBUTION_ONLY,
  TARGET_FIT_LABELS.ALLEGATION_REPETITION,
  TARGET_FIT_LABELS.BACKGROUND_CAUSAL,
  TARGET_FIT_LABELS.TOPIC_ONLY,
]);

// Coverage role a packet item represents, from its target-fit label.
function coverageRoleFor(label) {
  switch (label) {
    case TARGET_FIT_LABELS.DIRECT_SUBSTANTIVE: return "direct_substantive";
    case TARGET_FIT_LABELS.ATTRIBUTION_ONLY: return "attribution";
    case TARGET_FIT_LABELS.STUDY_IDENTITY_CONTEXT: return "study_identity";
    case TARGET_FIT_LABELS.METHODOLOGY_CONTEXT: return "methodology_or_reanalysis";
    case TARGET_FIT_LABELS.OFFICIAL_RESPONSE: return "official_response";
    case TARGET_FIT_LABELS.BACKGROUND_CAUSAL: return "causal_background";
    case TARGET_FIT_LABELS.ALLEGATION_REPETITION: return "allegation_repetition";
    default: return "other";
  }
}
const CAUSAL_PARTIAL = new Set(["association", "associative", "correlation", "correlational"]);

function clamp01(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function bounded(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function domainForUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function qualityLabel(item) {
  const tier = bounded(item?.qualityScores?.quality_tier || item?.qualityLabel || "", 30).toLowerCase();
  if (tier) return tier;
  const score = clamp01(item?.quality, 0);
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function effectivePacketStance(item, claim) {
  const stance = String(item?.stance || "insufficient").toLowerCase();
  const claimType = String(claim?.evidenceNeed?.claimType || claim?.claimType || "").toLowerCase();
  const causalStrength = String(item?.causalStrength || "").toLowerCase();
  if (claimType === "causal" && stance === "support" && CAUSAL_PARTIAL.has(causalStrength)) {
    return "nuance";
  }
  return stance;
}

export function classifyPacketRole(item, claim = {}) {
  const requirement = String(item?.bearingRequirement || "").toLowerCase();
  const component = String(item?.claimComponentAddressed || "").toLowerCase();
  const bearingType = String(item?.bearingType || "").toLowerCase();
  const stance = effectivePacketStance(item, claim);

  if (bearingType === "steelman" || item?.isFringe) return "steelman";
  if (bearingType === "origin" || requirement === "source_attribution" || component === "attribution") {
    return "origin_attribution";
  }
  if (requirement === "warrant_test" || requirement === "causal_mechanism") return "warrant_test";
  if (stance === "refute" || stance === "nuance" || component === "scope") return "rebuttal_limitation";
  if (["whole_claim", "subject", "relation", "object"].includes(component)) return "data_ground";
  return "backing";
}

export function explainPacketSelection(item, packetRole, claim = {}) {
  const stance = effectivePacketStance(item, claim);
  const component = bounded(item?.claimComponentAddressed || "whole_claim", 60);
  const supplied = bounded(item?.bearingReason, 400);
  if (supplied) return `${supplied} Selected as ${packetRole}; ${stance} evidence addressing ${component}.`;
  return `Selected as ${packetRole}: ${stance} evidence directly addresses ${component} of the exact claim.`;
}

function rejectionReason(item, threshold, claim) {
  const bearing = Number(item?.bearingScore);
  const stance = effectivePacketStance(item, claim);
  const type = String(item?.bearingType || "").toLowerCase();
  const component = String(item?.claimComponentAddressed || "").toLowerCase();
  if (!Number.isFinite(bearing)) return "missing_final_bearing";
  if (bearing < threshold) return "below_packet_bearing_threshold";
  if (!VALID_STANCES.has(stance)) return "insufficient_stance";
  if (type === "none") return "topic_only_or_no_bearing";
  if ((type === "context" || !type) && (!component || component === "none" || component === "subject")) {
    return "topic_only_context";
  }
  return null;
}

function compareCandidates(a, b) {
  const bearingDelta = b.finalBearing - a.finalBearing;
  if (Math.abs(bearingDelta) > 0.10) return bearingDelta;
  const qualityDelta = b.qualityScore - a.qualityScore;
  if (qualityDelta !== 0) return qualityDelta;
  if (bearingDelta !== 0) return bearingDelta;
  return a.inputIndex - b.inputIndex;
}

function pickWithDiversity(candidates, selected, documentCounts, usedDomains, documentLimit) {
  const available = candidates.filter((candidate) => {
    if (selected.some((item) => item.packetKey === candidate.packetKey)) return false;
    if ((documentCounts.get(candidate.documentKey) || 0) >= documentLimit) return false;
    if (selected.some((item) => item.documentKey === candidate.documentKey && item.quoteKey === candidate.quoteKey)) return false;
    return true;
  });
  if (available.length === 0) return null;
  const best = available[0];
  const diverse = available.find((candidate) =>
    !usedDomains.has(candidate.domain) && best.finalBearing - candidate.finalBearing <= 0.10,
  );
  return diverse || best;
}

function logFinalPacketSelectionAudit({ claim, clusters, packetAudit }) {
  // First selected member of each cluster is the representative others duplicate.
  const clusterRepresentative = new Map();
  for (const row of packetAudit) {
    if (row.selected && !clusterRepresentative.has(row.item.assertionClusterId)) {
      clusterRepresentative.set(row.item.assertionClusterId, row.item.id || row.item.packetKey);
    }
  }
  let selectedRank = 0;
  logger.log(`[FINAL_PACKET_SELECTION_AUDIT] ${JSON.stringify({
    event: "final_packet_selection_audit",
    claimId: Number(claim?.id || claim?.claimId || 0) || null,
    assignments: packetAudit.slice(0, 40).map((row) => {
      const item = row.item;
      const cluster = clusters.get(item.assertionClusterId);
      const dupOf = !row.selected && clusterRepresentative.get(item.assertionClusterId);
      const finalRank = row.selected ? (selectedRank += 1) : null;
      return {
        targetId: item.evidenceTargetId ?? null,
        assertionId: item.id || item.packetKey,
        sourceUrl: bounded(item.url, 300),
        sourceTitle: bounded(item.title, 160),
        stance: item.stance,
        compatibilityLabel: item.compatibilityLabel || null,
        assertionClusterId: item.assertionClusterId,
        selected: row.selected,
        rejectedOrDeferredReason: row.reason,
        packetRole: row.packetRole,
        duplicateOfAssertionId: dupOf || null,
        sourceFamily: item.sourceFamily || null,
        coverageRole: item.coverageRole || null,
        independent: Boolean(item.independent),
        finalRank,
        clusterSize: cluster?.size ?? 1,
        clusterSyndicated: Boolean(cluster?.syndicated),
      };
    }),
  })}`);
}

export function buildEvidencePacket({
  claim = {},
  evidence = [],
  minBearing = 0.35,
  maxItems = 5,
  maxQuotesPerDocument = 2,
} = {}) {
  const threshold = clamp01(minBearing, 0.35);
  const itemLimit = Math.max(1, Math.min(5, Math.round(Number(maxItems) || 5)));
  const documentLimit = Math.max(1, Math.min(2, Math.round(Number(maxQuotesPerDocument) || 2)));
  const rejected = [];
  const eligible = [];

  (Array.isArray(evidence) ? evidence : []).forEach((item, inputIndex) => {
    const reason = rejectionReason(item, threshold, claim);
    if (reason) {
      if (rejected.length < 20) rejected.push({
        evidenceId: item?.id || null,
        url: bounded(item?.url, 500),
        reason,
        bearing: Number.isFinite(Number(item?.bearingScore)) ? clamp01(item.bearingScore) : null,
      });
      return;
    }
    const canonicalUrl = canonicalizeUrl(item.url) || bounded(item.url, 1000) || `evidence:${item.id || inputIndex}`;
    const packetRole = classifyPacketRole(item, claim);
    const stance = effectivePacketStance(item, claim);
    const finalBearing = clamp01(item.bearingScore);
    const qualityScore = clamp01(item.quality, 0);
    const quoteKey = bounded(item.quote, 1000).toLowerCase();
    const documentKey = String(item.referenceContentId || item.contentId || canonicalUrl);
    // Step 21 compatibility label (deterministic; reuse the persisted one if the
    // item already carries it, else compute it here — no LLM call).
    const target = (claim.evaluationTargets || []).find(
      (t) => String(t.evaluationTargetId) === String(item.evidenceTargetId),
    ) || {};
    const fit = item.targetFit || evaluateTargetFit({ claim, target, evidence: item });
    // Respect Step 21: a forbidden-label item can never present as a direct
    // substantive support/refute. Downgrade its packet stance to nuance so it may
    // only appear as context (matching the persisted finalStance). This is
    // defensive — the persistence layer already downgrades these.
    const packetStance = NON_DIRECT_SUBSTANTIVE_LABELS.has(fit.compatibilityLabel) ? "nuance" : stance;
    eligible.push({
      ...item,
      inputIndex,
      packetKey: `${item.id || inputIndex}|${documentKey}|${quoteKey}`,
      canonicalUrl,
      documentKey,
      domain: domainForUrl(item.url),
      quoteKey,
      stance: packetStance,
      originalStance: item.stance || "insufficient",
      finalBearing,
      qualityScore,
      qualityLabel: qualityLabel(item),
      packetRole,
      compatibilityLabel: fit.compatibilityLabel,
      coverageRole: coverageRoleFor(fit.compatibilityLabel),
      sourceFamily: sourceFamilyOf(item),
      // Source independence (Step 23 ranking factor 4): amplifier / repeated
      // allegation material is not independent corroboration.
      independent: !(
        ["advocacy_or_press_release_candidate", "news_or_commentary_candidate"].includes(fit.sourceRole) ||
        fit.compatibilityLabel === TARGET_FIT_LABELS.ALLEGATION_REPETITION
      ),
      partialForClaim: stance !== item.stance || !["whole_claim", "relation", "object"].includes(String(item.claimComponentAddressed || "").toLowerCase()),
    });
  });

  eligible.sort(compareCandidates);
  // Step 22: cluster near-duplicate / syndicated assertions so repeated
  // allegation copies cannot occupy multiple packet slots.
  const { clusterIdByIndex, clusters } = clusterAssertions(eligible);
  eligible.forEach((item, i) => {
    item.assertionClusterId = clusterIdByIndex[i];
    const cluster = clusters.get(clusterIdByIndex[i]);
    item.clusterRepetition = Boolean(cluster && (cluster.syndicated || cluster.multiCopy)) ||
      item.compatibilityLabel === TARGET_FIT_LABELS.ALLEGATION_REPETITION;
  });
  const selected = [];
  const documentCounts = new Map();
  const usedDomains = new Set();
  const selectedClusters = new Set();       // Step 22: one representative per cluster
  const selectedCoverageRoles = new Set();
  const packetAudit = [];
  const add = (candidate, packetRole) => {
    if (!candidate || selected.length >= itemLimit) return;
    selected.push(candidate);
    documentCounts.set(candidate.documentKey, (documentCounts.get(candidate.documentKey) || 0) + 1);
    usedDomains.add(candidate.domain);
    selectedClusters.add(candidate.assertionClusterId);
    selectedCoverageRoles.add(candidate.coverageRole);
    packetAudit.push({ item: candidate, selected: true, packetRole, reason: null });
  };

  // A candidate is available for a slot if it is unpicked, not over its document
  // limit, and — Step 22 — its assertion cluster is not already represented.
  const clusterAvailable = (candidate) => !selectedClusters.has(candidate.assertionClusterId);
  const pick = (pool, { requireDirectSubstantive = false, preferUncoveredRole = false } = {}) => {
    let filtered = pool.filter(clusterAvailable);
    if (requireDirectSubstantive) {
      // Respect Step 21: only genuine direct substantive evidence may fill a
      // direct support/refute slot. Repeated allegations / attribution / broad
      // causal / topic-only never do.
      filtered = filtered.filter((c) => !NON_DIRECT_SUBSTANTIVE_LABELS.has(c.compatibilityLabel));
    }
    if (preferUncoveredRole) {
      const uncovered = filtered.filter((c) => !selectedCoverageRoles.has(c.coverageRole));
      if (uncovered.length) filtered = uncovered;
    }
    // Ranking factor 4: prefer independent sources over non-independent (repeated
    // allegation / amplifier) material when any independent candidate is
    // available — provider score never overrides this.
    const independentSubset = filtered.filter((c) => c.independent);
    if (independentSubset.length) filtered = independentSubset;
    return pickWithDiversity(filtered, selected, documentCounts, usedDomains, documentLimit);
  };

  const slots = [
    { role: "support", match: (item) => item.stance === "support" && !["steelman", "origin_attribution"].includes(item.packetRole), requireDirectSubstantive: true },
    { role: "refute", match: (item) => item.stance === "refute" && !["steelman", "origin_attribution"].includes(item.packetRole), requireDirectSubstantive: true },
    { role: "nuance", match: (item) => item.stance === "nuance" },
    { role: "origin_attribution", match: (item) => item.packetRole === "origin_attribution" },
    { role: "steelman", match: (item) => item.packetRole === "steelman" },
  ];
  for (const slot of slots) {
    add(pick(eligible.filter(slot.match), { requireDirectSubstantive: slot.requireDirectSubstantive }), slot.role);
  }
  // Fallback fill prefers coverage across evidence roles rather than more copies
  // of the loudest cluster.
  while (selected.length < itemLimit) {
    const next = pick(eligible, { preferUncoveredRole: true });
    if (!next) break;
    add(next, "coverage_fill");
  }

  // Record deferred/rejected eligible items (cluster duplicates, non-direct into
  // substantive slots) for the audit.
  const selectedKeys = new Set(selected.map((item) => item.packetKey));
  for (const item of eligible) {
    if (selectedKeys.has(item.packetKey)) continue;
    let reason = "not_selected_lower_rank";
    if (selectedClusters.has(item.assertionClusterId)) {
      reason = item.clusterRepetition ? "duplicate_allegation_cluster" : "duplicate_assertion_cluster";
    } else if (NON_DIRECT_SUBSTANTIVE_LABELS.has(item.compatibilityLabel)) {
      reason = `non_direct_substantive_${item.compatibilityLabel}`;
    }
    packetAudit.push({ item, selected: false, packetRole: null, reason });
  }
  logFinalPacketSelectionAudit({ claim, clusters, packetAudit });

  const items = selected.map((item) => ({
    evidenceId: item.id || null,
    candidateId: item.candidateId || null,
    referenceContentId: item.referenceContentId || item.contentId || null,
    url: bounded(item.url, 1000),
    canonicalUrl: item.canonicalUrl,
    domain: item.domain,
    documentKey: item.documentKey,
    title: bounded(item.title, 300),
    quote: bounded(item.quote, 1200),
    summary: bounded(item.summary, 600),
    stance: item.stance,
    originalStance: item.originalStance,
    finalBearing: item.finalBearing,
    bearingType: item.bearingType || null,
    bearingReason: bounded(item.bearingReason, 400),
    claimComponentAddressed: item.claimComponentAddressed || null,
    causalStrength: item.causalStrength || null,
    evidenceTargetId: item.evidenceTargetId || null,
    evidenceTargetType: item.evidenceTargetType || null,
    bearingRequirement: item.bearingRequirement || null,
    qualityScore: item.qualityScore,
    qualityLabel: item.qualityLabel,
    packetRole: item.packetRole,
    compatibilityLabel: item.compatibilityLabel || null,
    coverageRole: item.coverageRole || null,
    assertionClusterId: item.assertionClusterId || null,
    partialForClaim: item.partialForClaim,
    verdictEligible: true,
    inclusionReason: explainPacketSelection(item, item.packetRole, claim),
  }));

  return {
    version: 1,
    claimId: Number(claim.id || claim.claimId || 0),
    threshold,
    maxItems: itemLimit,
    itemCount: items.length,
    items,
    rejected,
    stats: {
      inputCount: Array.isArray(evidence) ? evidence.length : 0,
      eligibleCount: eligible.length,
      rejectedCount: (Array.isArray(evidence) ? evidence.length : 0) - eligible.length,
      selectedDocumentCount: new Set(items.map((item) => item.documentKey)).size,
      selectedDomainCount: new Set(items.map((item) => item.domain)).size,
    },
  };
}
