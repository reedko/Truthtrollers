const CAP_ORDER = ["A", "B", "C", "D", "E", "Ø"];

function clamp(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function bucketFromScore(score) {
  if (score == null) return null;
  if (score >= 80) return "high";
  if (score >= 65) return "medium";
  if (score >= 45) return "mixed";
  if (score >= 25) return "low";
  return "low";
}

function scoreFromBucket(bucket) {
  const b = String(bucket || "").toLowerCase();
  if (["very high", "high"].includes(b)) return 86;
  if (["mostly factual", "mostly", "medium"].includes(b)) return 74;
  if (["mixed"].includes(b)) return 52;
  if (["low"].includes(b)) return 34;
  if (["very low"].includes(b)) return 18;
  return null;
}

function confidenceToNumber(confidence) {
  const c = String(confidence || "").toLowerCase();
  if (c === "high") return 0.9;
  if (c === "medium") return 0.65;
  if (c === "low") return 0.35;
  return 0.5;
}

function makeSignal({
  provider,
  signalType,
  effectType,
  score = null,
  bucket = null,
  confidenceDelta = 0,
  reliabilityDelta = 0,
  cap = null,
  capReason = null,
  flags = [],
  evidenceUrl = null,
  explanation = "",
  raw = null,
  matchedName = null,
  matchedDomain = null,
  matchConfidence = null,
}) {
  return {
    provider,
    signal_type: signalType,
    admiralty_effect_type: effectType,
    normalized_score: score == null ? null : clamp(score, 0, 100, null),
    reliability_bucket: bucket || bucketFromScore(score),
    confidence_delta: confidenceDelta,
    reliability_delta: reliabilityDelta,
    cap,
    cap_reason: capReason,
    flags,
    evidence_url: evidenceUrl,
    explanation,
    raw,
    matched_name: matchedName,
    matched_domain: matchedDomain,
    match_confidence: matchConfidence,
  };
}

function mbfcScore(rawResult) {
  const n = rawResult?.normalized || {};
  const raw = rawResult?.raw || {};
  const factual = String(raw.factual_reporting || raw.factual || n.factual_reporting || "").toLowerCase();
  const credibility = raw.credibility_score ?? raw.credibility ?? n.credibilityScore ?? n.credibility ?? null;

  if (typeof credibility === "number") return clamp(credibility, 0, 100, null);
  if (factual.includes("very high")) return 90;
  if (factual.includes("high")) return 84;
  if (factual.includes("mostly")) return 74;
  if (factual.includes("mixed")) return 52;
  if (factual.includes("very low")) return 18;
  if (factual.includes("low")) return 34;
  return scoreFromBucket(n.reliability);
}

function mapMbfc(rawResult) {
  const score = mbfcScore(rawResult);
  const rawText = JSON.stringify(rawResult?.raw || rawResult || {}).toLowerCase();
  const flags = [];
  let cap = null;
  let capReason = null;
  if (/conspiracy|pseudoscience|questionable|failed fact checks|fake news|propaganda/.test(rawText)) {
    flags.push("mbfc_high_risk_classification");
    cap = score != null && score < 25 ? "E" : "D";
    capReason = "MBFC indicates high-risk source classification.";
  }

  if (score == null) {
    return makeSignal({
      provider: "mbfc",
      signalType: "bias_context",
      effectType: "contextual",
      confidenceDelta: 0.03,
      flags,
      cap,
      capReason,
      evidenceUrl: rawResult?.normalized?.externalUrl || null,
      explanation: "MBFC matched, but supplied no factuality or credibility score; treating as context only.",
      raw: rawResult,
      matchedName: rawResult?.normalized?.publisherName,
      matchedDomain: rawResult?.normalized?.domain,
      matchConfidence: confidenceToNumber(rawResult?.confidence),
    });
  }

  return makeSignal({
    provider: "mbfc",
    signalType: "direct_reliability_signal",
    effectType: cap ? "cap" : "direct",
    score,
    bucket: bucketFromScore(score),
    confidenceDelta: 0.12,
    reliabilityDelta: score - 50,
    cap,
    capReason,
    flags,
    evidenceUrl: rawResult?.normalized?.externalUrl || null,
    explanation: `MBFC factuality/credibility mapped to ${score}/100.`,
    raw: rawResult,
    matchedName: rawResult?.normalized?.publisherName,
    matchedDomain: rawResult?.normalized?.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapAdFontes(rawResult) {
  const n = rawResult?.normalized || {};
  const score = n.reliabilityScore != null
    ? clamp((Number(n.reliabilityScore) / 64) * 100, 0, 100, null)
    : scoreFromBucket(n.reliability);
  if (score == null) {
    return makeSignal({
      provider: "adfontes",
      signalType: "bias_context",
      effectType: "contextual",
      confidenceDelta: 0.03,
      evidenceUrl: n.externalUrl || null,
      explanation: "Ad Fontes matched, but supplied bias/context only.",
      raw: rawResult,
      matchedName: n.publisherName,
      matchedDomain: n.domain,
      matchConfidence: confidenceToNumber(rawResult?.confidence),
    });
  }
  return makeSignal({
    provider: "adfontes",
    signalType: "direct_reliability_signal",
    effectType: "direct",
    score,
    bucket: bucketFromScore(score),
    confidenceDelta: 0.12,
    reliabilityDelta: score - 50,
    evidenceUrl: n.externalUrl || null,
    explanation: `Ad Fontes reliability mapped to ${Math.round(score)}/100.`,
    raw: rawResult,
    matchedName: n.publisherName,
    matchedDomain: n.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapScimago(rawResult) {
  const n = rawResult?.normalized || {};
  const score = n.veracityScore ?? n.reliabilityScore ?? null;
  if (score == null) {
    return makeSignal({
      provider: "scimago",
      signalType: "publication_legitimacy_signal",
      effectType: "provenance",
      confidenceDelta: rawResult?.matchFound ? 0.08 : 0,
      evidenceUrl: n.externalUrl || null,
      explanation: "SCImago matched academic publication metadata without a quartile score.",
      raw: rawResult,
      matchedName: n.sourceName || n.publisherName,
      matchedDomain: n.domain,
      matchConfidence: confidenceToNumber(rawResult?.confidence),
    });
  }
  return makeSignal({
    provider: "scimago",
    signalType: "direct_reliability_signal",
    effectType: "direct",
    score,
    bucket: bucketFromScore(score),
    confidenceDelta: 0.15,
    reliabilityDelta: score - 50,
    evidenceUrl: n.externalUrl || null,
    explanation: `SCImago journal quartile/impact mapped to ${score}/100.`,
    raw: rawResult,
    matchedName: n.sourceName || n.publisherName,
    matchedDomain: n.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapAllSides(rawResult) {
  return makeSignal({
    provider: "allsides",
    signalType: "bias_context",
    effectType: "contextual",
    confidenceDelta: 0.03,
    flags: rawResult?.normalized?.bias ? ["bias_only_not_reliability"] : [],
    evidenceUrl: rawResult?.normalized?.externalUrl || null,
    explanation: "AllSides supplies political bias/context only; ignored for direct reliability.",
    raw: rawResult,
    matchedName: rawResult?.normalized?.publisherName,
    matchedDomain: rawResult?.normalized?.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapOpenSources(rawResult) {
  const flags = rawResult?.normalized?.flaggedTypes || [];
  const danger = flags.some((flag) => /fake|conspiracy|propaganda|disinformation|junk/i.test(flag));
  return makeSignal({
    provider: "opensources",
    signalType: "direct_reliability_signal",
    effectType: danger ? "cap" : "downgrade",
    score: danger ? 15 : 35,
    bucket: "low",
    confidenceDelta: 0.1,
    reliabilityDelta: danger ? -35 : -20,
    cap: danger ? "E" : "D",
    capReason: `OpenSources flags: ${flags.join(", ") || "listed"}`,
    flags,
    evidenceUrl: rawResult?.normalized?.externalUrl || null,
    explanation: "OpenSources risk flags directly downgrade/cap reliability.",
    raw: rawResult,
    matchedName: rawResult?.normalized?.publisherName,
    matchedDomain: rawResult?.normalized?.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapWikipedia(rawResult) {
  const n = rawResult?.normalized || {};
  const score = n.reliabilityScore ?? n.veracityScore ?? null;
  if (score != null) {
    return makeSignal({
      provider: "wikipedia",
      signalType: "direct_reliability_signal",
      effectType: "direct",
      score,
      bucket: bucketFromScore(score),
      confidenceDelta: 0.08,
      reliabilityDelta: score - 50,
      evidenceUrl: n.externalUrl || null,
      explanation: `Wikipedia-derived credibility context mapped to ${score}/100.`,
      raw: rawResult,
      matchedName: n.publisherName,
      matchedDomain: n.domain,
      matchConfidence: confidenceToNumber(rawResult?.confidence),
    });
  }
  return makeSignal({
    provider: "wikipedia",
    signalType: "identity_context",
    effectType: "contextual",
    confidenceDelta: 0.06,
    flags: ["wikipedia_identity_not_reliability"],
    evidenceUrl: n.externalUrl || null,
    explanation: "Wikipedia identified/profiled the entity but supplied no reliability score.",
    raw: rawResult,
    matchedName: n.publisherName,
    matchedDomain: n.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapWikidata(rawResult) {
  const n = rawResult?.normalized || {};
  const flags = [];
  let cap = null;
  let capReason = null;
  const typeText = `${n.sourceType || ""} ${JSON.stringify(n.relationships || [])}`.toLowerCase();
  if (/advocacy|lobby|campaign|law firm|marketing|public relations|pr firm|trade association/.test(typeText)) {
    flags.push("conflicted_or_advocacy_entity_type");
    cap = "C";
    capReason = "Wikidata indicates advocacy, lobbying, legal, marketing, or campaign context.";
  }
  return makeSignal({
    provider: "wikidata",
    signalType: "identity_provenance_signal",
    effectType: cap ? "cap" : "provenance",
    confidenceDelta: 0.1,
    reliabilityDelta: 0,
    cap,
    capReason,
    flags,
    evidenceUrl: n.externalUrl || null,
    explanation: "Wikidata improves identity/source-type confidence but is not direct reliability evidence.",
    raw: rawResult,
    matchedName: n.publisherName,
    matchedDomain: n.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapWayback(rawResult) {
  const n = rawResult?.normalized || {};
  const years = n.domainAgeYears ?? n.archiveAgeYears ?? null;
  const captures = n.captureCount ?? null;
  const flags = [];
  let score = 0;
  let cap = null;
  let capReason = null;

  if (years != null && years >= 5 && captures > 100) score = 15;
  else if (years != null && years >= 2 && captures > 20) score = 8;
  else if (rawResult?.matchFound === false || captures === 0 || (captures != null && captures < 3)) {
    flags.push("weak_domain_footprint");
    cap = "C";
    capReason = "Wayback found weak or no independent domain footprint.";
  }

  return makeSignal({
    provider: "wayback",
    signalType: "domain_footprint_signal",
    effectType: cap ? "cap" : "provenance",
    confidenceDelta: score > 0 ? 0.05 : 0,
    reliabilityDelta: 0,
    cap,
    capReason,
    flags,
    evidenceUrl: n.externalUrl || n.archiveUrl || null,
    explanation: score > 0
      ? `Wayback domain footprint supports provenance (+${score}).`
      : "Wayback does not provide reliability; weak archive footprint may cap obscure sources.",
    raw: rawResult,
    matchedDomain: n.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapRdap(rawResult) {
  const n = rawResult?.normalized || {};
  const age = n.domainAgeYears;
  const flags = [];
  let score = 0;
  let cap = null;
  let capReason = null;
  if (age >= 5) score = 10;
  else if (age >= 1) score = 5;
  else if (age != null) {
    flags.push("young_domain");
    cap = "C";
    capReason = "RDAP indicates a domain younger than one year.";
  }
  return makeSignal({
    provider: "rdap",
    signalType: "domain_registration_signal",
    effectType: cap ? "cap" : "provenance",
    confidenceDelta: score > 0 ? 0.04 : 0,
    cap,
    capReason,
    flags,
    evidenceUrl: n.externalUrl || null,
    explanation: age == null ? "RDAP did not return domain age." : `RDAP domain age is about ${age.toFixed(1)} years.`,
    raw: rawResult,
    matchedDomain: n.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapGdelt(rawResult) {
  const n = rawResult?.normalized || {};
  const independent = Number(n.independentMentionCount ?? 0);
  const total = Number(n.mentionCount ?? 0);
  const flags = [];
  let score = 0;
  if (independent >= 10) score = 20;
  else if (independent >= 5) score = 15;
  else if (independent >= 1) score = 8;
  else if (total === 0 || rawResult?.matchFound === false) flags.push("low_independent_footprint");

  return makeSignal({
    provider: "gdelt",
    signalType: "independent_footprint_signal",
    effectType: "provenance",
    score,
    confidenceDelta: score > 0 ? 0.05 : 0,
    reliabilityDelta: 0,
    flags,
    evidenceUrl: n.externalUrl || null,
    explanation: score > 0
      ? `GDELT found ${independent} independent mentions across ${n.independentDomains?.length || 0} domains.`
      : "GDELT found no independent footprint for this publisher/entity.",
    raw: rawResult,
    matchedName: n.publisherName,
    matchedDomain: n.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapScholarly(provider, rawResult) {
  const n = rawResult?.normalized || {};
  const flags = [...(n.flags || [])];
  let cap = null;
  let capReason = null;
  let score = null;
  let confidenceDelta = 0;

  if (n.doiMatched || n.workMatched || n.issnMatched || n.sourceMatched) {
    score = n.doiMatched || n.workMatched ? 50 : (n.issnMatched ? 45 : 35);
    confidenceDelta = n.doiMatched || n.workMatched ? 0.2 : (n.issnMatched ? 0.18 : 0.12);
  }
  if (n.metadataMismatch) {
    flags.push("publication_metadata_mismatch");
    cap = "C";
    capReason = `${provider} metadata did not match the claimed publication.`;
  }
  if (n.claimedScholarly && !n.doiMatched && !n.workMatched && !n.sourceMatched && !n.issnMatched) {
    flags.push("claimed_publication_not_verified");
    cap = "C";
    capReason = `${provider} could not verify the claimed scholarly publication.`;
  }

  return makeSignal({
    provider,
    signalType: "publication_legitimacy_signal",
    effectType: cap ? "cap" : "provenance",
    score,
    confidenceDelta,
    cap,
    capReason,
    flags,
    evidenceUrl: n.externalUrl || null,
    explanation: score
      ? `${provider} verified scholarly publication/source metadata${n.issnMatched ? " by ISSN" : ""}.`
      : `${provider} did not provide direct reliability evidence.`,
    raw: rawResult,
    matchedName: n.publisherName || n.sourceName || n.workTitle,
    matchedDomain: n.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapNewsGuard(rawResult) {
  const n = rawResult?.normalized || {};
  const score = n.score ?? n.reliabilityScore ?? rawResult?.raw?.score ?? null;
  if (score == null) {
    return makeSignal({
      provider: "newsguard",
      signalType: "provider_status",
      effectType: "contextual",
      flags: ["provider_unavailable"],
      explanation: "NewsGuard unavailable or unconfigured.",
      raw: rawResult,
    });
  }
  return makeSignal({
    provider: "newsguard",
    signalType: "direct_reliability_signal",
    effectType: "direct",
    score,
    bucket: bucketFromScore(score),
    confidenceDelta: 0.15,
    reliabilityDelta: score - 50,
    evidenceUrl: n.externalUrl || null,
    explanation: `NewsGuard score mapped directly to ${score}/100.`,
    raw: rawResult,
    matchedName: n.publisherName,
    matchedDomain: n.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapIdentityOnly(provider, rawResult) {
  const n = rawResult?.normalized || {};
  const flags = [];
  let cap = null;
  let capReason = null;
  const entityStatus = n.currentStatus || n.status;
  if (entityStatus && /inactive|dissolved|revoked|delinquent/i.test(entityStatus)) {
    flags.push("entity_inactive");
    cap = "C";
    capReason = `${provider} indicates inactive, dissolved, revoked, or delinquent entity status.`;
  }
  return makeSignal({
    provider,
    signalType: "identity_provenance_signal",
    effectType: cap ? "cap" : "provenance",
    confidenceDelta: rawResult?.matchFound ? 0.1 : 0,
    cap,
    capReason,
    flags,
    evidenceUrl: n.externalUrl || null,
    explanation: `${provider} provides entity identity/provenance, not direct reliability.`,
    raw: rawResult,
    matchedName: n.matchedName || n.legalName || n.publisherName || n.entityName,
    matchedDomain: n.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

function mapOwnSiteOrgStatus(rawResult) {
  const n = rawResult?.normalized || {};
  const flags = Array.isArray(n.risk_flags) ? n.risk_flags : [];
  const isIndustryGroup = n.publisher_type === "industry_trade_association";
  return makeSignal({
    provider: "own_site_org_status",
    signalType: "identity_provenance_signal",
    effectType: isIndustryGroup ? "cap" : "contextual",
    score: n.conflict_of_interest_score != null ? Number(n.conflict_of_interest_score) * 100 : null,
    confidenceDelta: n.identity_confidence != null ? Math.min(0.2, Number(n.identity_confidence) / 5) : 0.05,
    reliabilityDelta: isIndustryGroup ? -10 : 0,
    cap: isIndustryGroup ? "C" : null,
    capReason: isIndustryGroup ? "Own-site evidence indicates an industry trade association or consortium." : null,
    flags,
    evidenceUrl: n.externalUrl || null,
    explanation: n.use_note || "Own-site organization-status evidence stored as identity/provenance context.",
    raw: rawResult,
    matchedName: n.publisher_name,
    matchedDomain: n.domain,
    matchConfidence: n.identity_confidence ?? confidenceToNumber(rawResult?.confidence),
  });
}

export function mapProviderSignalToAdmiralty(providerName, rawResult, matchContext = {}) {
  const provider = String(providerName || rawResult?.providerName || "").toLowerCase();
  if (!rawResult || rawResult.matchFound === false) {
    return makeSignal({
      provider: provider || "unknown",
      signalType: "provider_status",
      effectType: "contextual",
      flags: rawResult?.status ? [`provider_${rawResult.status}`] : ["provider_no_match"],
      explanation: `${provider || "Provider"} returned no match.`,
      raw: rawResult,
      matchedDomain: matchContext.domain || null,
      matchedName: matchContext.publisherName || null,
    });
  }

  if (provider === "mbfc") return mapMbfc(rawResult);
  if (provider === "adfontes") return mapAdFontes(rawResult);
  if (provider === "scimago") return mapScimago(rawResult);
  if (provider === "allsides") return mapAllSides(rawResult);
  if (provider === "opensources") return mapOpenSources(rawResult);
  if (provider === "wikipedia") return mapWikipedia(rawResult);
  if (provider === "wikidata") return mapWikidata(rawResult);
  if (provider === "wayback") return mapWayback(rawResult);
  if (provider === "rdap") return mapRdap(rawResult);
  if (provider === "gdelt") return mapGdelt(rawResult);
  if (provider === "openalex" || provider === "crossref") return mapScholarly(provider, rawResult);
  if (provider === "newsguard") return mapNewsGuard(rawResult);
  if (["opencorporates", "irs_teos", "sec_edgar"].includes(provider)) return mapIdentityOnly(provider, rawResult);
  if (provider === "own_site_org_status") return mapOwnSiteOrgStatus(rawResult);

  return makeSignal({
    provider: provider || "unknown",
    signalType: "contextual_credibility_signal",
    effectType: "contextual",
    confidenceDelta: rawResult?.matchFound ? 0.02 : 0,
    evidenceUrl: rawResult?.normalized?.externalUrl || null,
    explanation: `${provider || "Provider"} result stored as contextual signal only.`,
    raw: rawResult,
    matchedName: rawResult?.normalized?.publisherName,
    matchedDomain: rawResult?.normalized?.domain,
    matchConfidence: confidenceToNumber(rawResult?.confidence),
  });
}

export function summarizeProviderSignals(signals = []) {
  const direct = signals.filter((s) => s.admiralty_effect_type === "direct" || s.signal_type === "direct_reliability_signal");
  const scoredDirect = direct.filter((s) => s.normalized_score != null);
  const directReliabilityScore = scoredDirect.length
    ? scoredDirect.reduce((sum, s) => sum + Number(s.normalized_score), 0) / scoredDirect.length
    : null;
  const provenanceScore = signals
    .filter((s) => s.admiralty_effect_type === "provenance" || /provenance|footprint|legitimacy|registration/.test(s.signal_type))
    .reduce((sum, s) => sum + (Number(s.normalized_score) || 0), 0);
  const publicationLegitimacyScore = signals
    .filter((s) => s.signal_type === "publication_legitimacy_signal")
    .reduce((sum, s) => sum + (Number(s.normalized_score) || 0), 0);
  const identityConfidence = clamp(
    0.2 + signals.reduce((sum, s) => sum + (Number(s.confidence_delta) || 0), 0),
    0,
    1,
    0.2
  );
  const caps = signals
    .filter((s) => s.cap)
    .map((s) => ({ cap: s.cap, reason: s.cap_reason, provider: s.provider }));
  const strongestCap = caps
    .slice()
    .sort((a, b) => CAP_ORDER.indexOf(b.cap) - CAP_ORDER.indexOf(a.cap))[0] || null;
  const flags = [...new Set(signals.flatMap((s) => Array.isArray(s.flags) ? s.flags : []))];
  const reliabilitySignalSources = scoredDirect.map((s) => s.provider);
  const ignoredForDirectReliability = signals
    .filter((s) => s.normalized_score == null || s.admiralty_effect_type !== "direct")
    .map((s) => s.provider);
  const alignmentScores = signals
    .filter((s) => s.provider === "own_site_org_status" || (Array.isArray(s.flags) && s.flags.includes("material_industry_interest")))
    .map((s) => Number(s.normalized_score))
    .filter(Number.isFinite);

  return {
    directReliabilityScore,
    reliabilitySignalPresent: directReliabilityScore != null,
    provenanceScore,
    publicationLegitimacyScore,
    identityConfidence,
    independentFootprintScore: signals
      .filter((s) => /footprint/.test(s.signal_type))
      .reduce((sum, s) => sum + (Number(s.normalized_score) || 0), 0),
    contextualCredibilityScore: signals
      .filter((s) => s.admiralty_effect_type === "contextual")
      .reduce((sum, s) => sum + (Number(s.normalized_score) || 0), 0),
    conflictOfInterestScore: alignmentScores.length
      ? Math.max(...alignmentScores)
      : flags.some((flag) => /conflict|advocacy|lobby|marketing|campaign|law|material_industry_interest/.test(flag)) ? 50 : 0,
    caps,
    strongestCap,
    flags,
    reliabilitySignalSources,
    ignoredForDirectReliability: [...new Set(ignoredForDirectReliability)],
  };
}

export function applyReliabilityCap(letter, cap) {
  if (!cap || letter === "Ø") return letter;
  const letterIdx = CAP_ORDER.indexOf(letter);
  const capIdx = CAP_ORDER.indexOf(cap);
  if (letterIdx === -1 || capIdx === -1) return letter;
  return letterIdx < capIdx ? cap : letter;
}
