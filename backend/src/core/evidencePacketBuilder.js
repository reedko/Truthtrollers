import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";

const VALID_STANCES = new Set(["support", "refute", "nuance"]);
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
    eligible.push({
      ...item,
      inputIndex,
      packetKey: `${item.id || inputIndex}|${documentKey}|${quoteKey}`,
      canonicalUrl,
      documentKey,
      domain: domainForUrl(item.url),
      quoteKey,
      stance,
      originalStance: item.stance || "insufficient",
      finalBearing,
      qualityScore,
      qualityLabel: qualityLabel(item),
      packetRole,
      partialForClaim: stance !== item.stance || !["whole_claim", "relation", "object"].includes(String(item.claimComponentAddressed || "").toLowerCase()),
    });
  });

  eligible.sort(compareCandidates);
  const selected = [];
  const documentCounts = new Map();
  const usedDomains = new Set();
  const add = (candidate) => {
    if (!candidate || selected.length >= itemLimit) return;
    selected.push(candidate);
    documentCounts.set(candidate.documentKey, (documentCounts.get(candidate.documentKey) || 0) + 1);
    usedDomains.add(candidate.domain);
  };

  const slots = [
    (item) => item.stance === "support" && !["steelman", "origin_attribution"].includes(item.packetRole),
    (item) => item.stance === "refute" && !["steelman", "origin_attribution"].includes(item.packetRole),
    (item) => item.stance === "nuance",
    (item) => item.packetRole === "origin_attribution",
    (item) => item.packetRole === "steelman",
  ];
  for (const matchesSlot of slots) {
    add(pickWithDiversity(eligible.filter(matchesSlot), selected, documentCounts, usedDomains, documentLimit));
  }
  while (selected.length < itemLimit) {
    const next = pickWithDiversity(eligible, selected, documentCounts, usedDomains, documentLimit);
    if (!next) break;
    add(next);
  }

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
