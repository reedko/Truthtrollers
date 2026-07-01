import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";

const NA = "not_available";
const FORBIDDEN_STANDALONE_TERMS = new Set([
  "a", "an", "the", "each", "there", "little", "most", "known", "about",
  "every", "has", "have", "had", "are", "was", "were", "with", "from",
  "that", "this", "these", "those", "into", "than", "then", "born",
]);
const GENERIC_TERMS = new Set([
  "year", "years", "type", "types", "cause", "causes", "effect", "effects",
  "people", "person", "thing", "things", "many", "some", "more", "less",
]);
const ENTERTAINMENT_RE = /\b(movie|film|trailer|episode|season|song|lyrics|actor|actress|netflix|imdb|rotten tomatoes|entertainment)\b/i;
const DICTIONARY_RE = /\b(dictionary|definition|meaning|thesaurus|merriam|vocabulary)\b|dictionary\.com|wiktionary/i;
const SOCIAL_RE = /(?:facebook|instagram|tiktok|twitter|x|reddit)\.com/i;

export const REVIEW_HEADERS = [
  "Case ID", "Case claim", "Source", "Quality", "Bucket",
  "Legacy claim", "Legacy stance", "Legacy rel.", "Legacy rationale",
  "Bearing claim", "Bearing stance", "Bearing score", "Bearing level",
  "Bearing rationale", "Human hint",
];

export const SUMMARY_HEADERS = [
  "Case ID", "Case claim", "Rows", "Legacy accepted", "Bearing accepted",
  "Both accepted", "Bearing rejected legacy", "Bearing only", "Legacy only",
  "Legacy better", "Bearing better", "Non-good candidates",
  "Avg legacy rel.", "Avg bearing score",
];

export const GATING_PROJECTION_HEADERS = [
  "Decision", "Score", "Case claim", "Query", "Result title", "Gate reason",
  "Calls avoided", "Tokens avoided", "URL",
];

export const TOKEN_SUMMARY_HEADERS = ["Metric", "Value", "Meaning"];

function bounded(value, limit = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function canonical(value) {
  return canonicalizeUrl(value) || bounded(value, 1200);
}

function sameUrl(left, right) {
  return Boolean(canonical(left) && canonical(left) === canonical(right));
}

function stem(word) {
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/s$/.test(word) && !/ss$/.test(word) && word.length > 4) return word.slice(0, -1);
  return word;
}

function words(value) {
  return bounded(value, 4000).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter(Boolean).map(stem);
}

function similarity(left, right) {
  const a = new Set(words(left).filter((word) => word.length > 2));
  const b = new Set(words(right).filter((word) => word.length > 2));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signedStanceWeight(stance, score) {
  const value = numeric(score);
  if (value === null) return NA;
  const normalized = Math.max(0, Math.min(1, value));
  if (/refut|oppose|contradict/i.test(stance || "")) return Number((-normalized).toFixed(4));
  if (/support|confirm/i.test(stance || "")) return Number(normalized.toFixed(4));
  return 0;
}

function relevanceLabel(score) {
  const value = numeric(score);
  if (value === null) return NA;
  const normalized = value <= 1 ? value * 100 : value;
  if (normalized >= 80) return "high";
  if (normalized >= 60) return "medium";
  return "low";
}

export function buildClaimHingePacket(caseClaim = {}) {
  const text = bounded(caseClaim.claim_text || caseClaim.text, 1200);
  const lower = text.toLowerCase();
  const hasNumber = /\b\d+(?:\.\d+)?\b|\b(?:percent|percentage|one in|out of every)\b/i.test(text);
  let claimType = "other";
  if (/\b(?:means|defined as|definition|refers to)\b/i.test(text)) claimType = "definition";
  else if (hasNumber && /\b(?:each year|per year|birth|born|incidence|prevalence|rate|percent|out of every)\b/i.test(text)) claimType = "incidence_statistic";
  else if (/\b(?:cause|causes|caused|leads? to|results? in|increases?|decreases?|risk of|because)\b/i.test(text)) claimType = "causal_claim";
  else if (/[“”"]|\b(?:said|says|stated|claimed|told|according to)\b/i.test(text)) claimType = "quoted_speech_claim";
  else if (/\b(?:there (?:is|are)|exists?|existence)\b/i.test(text)) claimType = "existence_claim";
  else if (/\b(?:more than|less than|compared with|compared to|higher|lower|versus)\b/i.test(text)) claimType = "comparison_claim";
  else if (/\b(?:recommend|should|guidance|treat|treatment|screen|diagnos|dose|therapy)\b/i.test(text)) claimType = "medical_guidance_claim";
  else if (/\b(?:agency|government|university|court|department|institution|announced|approved|banned|ordered|investigat)\b/i.test(text)) claimType = "institutional_action_claim";

  const requiredTerms = [...new Set(words(lower).filter((word) =>
    (word.length > 3 || /^\d+$/.test(word)) &&
    !FORBIDDEN_STANDALONE_TERMS.has(word) && !GENERIC_TERMS.has(word),
  ))].slice(0, 12);
  const disputedHinge = bounded(lower.replace(/^[^a-z0-9]+|[.?!]+$/g, ""), 500);
  const acceptableSourceTypes = {
    definition: ["authoritative_dictionary", "official_domain_reference"],
    incidence_statistic: ["government_health", "peer_reviewed", "hospital_or_medical_institution"],
    causal_claim: ["systematic_review", "peer_reviewed", "government_health"],
    quoted_speech_claim: ["primary_transcript", "primary_video", "reliable_reporting"],
    institutional_action_claim: ["official_record", "audit", "court_document", "reputable_reporting"],
    medical_guidance_claim: ["official_guideline", "medical_society", "government_health"],
  }[claimType] || ["primary_source", "authoritative_domain_source", "reputable_reporting"];
  return {
    case_claim_text: text,
    claim_type: claimType,
    disputed_hinge: disputedHinge,
    required_terms: requiredTerms,
    forbidden_standalone_terms: [...FORBIDDEN_STANDALONE_TERMS],
    acceptable_source_types: acceptableSourceTypes,
  };
}

function candidateQuality(packet, candidate, duplicate = false) {
  const title = bounded(candidate?.title, 400);
  const snippet = bounded(candidate?.snippet, 1000);
  const url = bounded(candidate?.url, 1200);
  const combined = `${title} ${snippet} ${url}`;
  if (duplicate) return "duplicate_or_derivative";
  if (ENTERTAINMENT_RE.test(combined) && !ENTERTAINMENT_RE.test(packet.case_claim_text)) return "entertainment_wrong_sense";
  if (DICTIONARY_RE.test(combined) && packet.claim_type !== "definition") return "dictionary_generic";
  if (SOCIAL_RE.test(url)) return "social_low_authority";
  const candidateWords = new Set(words(combined));
  const required = packet.required_terms;
  const hits = required.filter((term) => candidateWords.has(term)).length;
  const ratio = required.length ? hits / required.length : 0;
  if (required.length && (hits === 0 || ratio < 0.3)) return "topic_only";
  return required.length ? "good_candidate" : "unclear";
}

function gateCandidate(packet, candidate, duplicate = false) {
  const quality = candidateQuality(packet, candidate, duplicate);
  const score = numeric(candidate?.bearingPreScore ?? candidate?.deterministicBearingScore);
  if (["entertainment_wrong_sense", "dictionary_generic"].includes(quality)) {
    return { decision: "reject", quality, reason: `Obvious ${quality.replace(/_/g, " ")} mismatch before scrape.` };
  }
  if (quality === "topic_only" && (score === null || score < 0.35)) {
    return { decision: "reject", quality, reason: "Title/snippet shares a broad topic but does not address the disputed hinge." };
  }
  if (candidate?.deterministicBearingDecision === "skip" && score !== null && score < 0.15) {
    return { decision: "reject", quality, reason: bounded(candidate.deterministicBearingReason || "Deterministic snippet bearing is below the conservative rejection floor.", 500) };
  }
  if (quality === "good_candidate" && score !== null && score >= 0.35) {
    return { decision: "pass", quality, reason: "Title/snippet contains the claim object and clears the snippet-bearing threshold." };
  }
  return { decision: "needs_llm", quality, reason: "Deterministic title/snippet evidence is not strong enough for a conservative pass or rejection." };
}

function bearingRescore(legacy, result, threshold) {
  const evidence = (result?.evidence || []).filter((item) => sameUrl(item.url, legacy.source_url));
  const best = evidence.sort((a, b) => (numeric(b.bearingScore) ?? -1) - (numeric(a.bearingScore) ?? -1))[0];
  if (best && numeric(best.bearingScore) !== null) {
    const score = numeric(best.bearingScore);
    return {
      score,
      decision: best.bearingType === "none" || score < 0.15 ? "reject" : score < threshold ? "downgrade" : "accept",
      reason: bounded(best.bearingReason || "Post-scrape bearing rescore.", 500),
    };
  }
  const candidate = (result?.candidates || []).find((item) => sameUrl(item.url, legacy.source_url));
  const score = numeric(candidate?.bearingPreScore ?? candidate?.deterministicBearingScore);
  if (score === null) return { score: NA, decision: "not_scored", reason: "No bearing score was retained for this legacy URL." };
  return {
    score,
    decision: candidate?.bearingType === "none" || score < 0.15 ? "reject" : score < threshold ? "downgrade" : "accept",
    reason: bounded(candidate?.deterministicBearingReason || "Pre-scrape bearing rescore.", 500),
  };
}

function reviewHint(row) {
  if (["entertainment_wrong_sense", "dictionary_generic", "topic_only"].includes(row.candidate_quality_flag)) {
    return row.bearing_status === "rejected"
      ? "Legacy matched topic only; bearing rejected as low-bearing."
      : "Search candidate was junk; should have been gated before scrape.";
  }
  if (row.comparison_bucket === "both_accepted_same_source") {
    return row.legacy_stance !== row.bearing_stance
      ? "Both matched the same source but bearing stance is clearer."
      : "Both methods accepted the same source.";
  }
  if (row.comparison_bucket === "bearing_better_match") return "Bearing found a claim that addresses the disputed hinge more directly.";
  if (row.comparison_bucket === "legacy_better_match") return "Legacy retained the more direct claim match.";
  if (row.comparison_bucket === "bearing_rejected_legacy") return "Bearing rejected the legacy match as insufficiently connected to the disputed hinge.";
  if (row.comparison_bucket === "bearing_only") return "Bearing accepted evidence that legacy did not retain.";
  if (row.comparison_bucket === "legacy_only") return "Legacy accepted this match; bearing did not retain a corresponding accepted passage.";
  return "Both are weak or unavailable; inspect query generation and candidate quality.";
}

function emptyReviewRow(caseClaim) {
  const row = Object.fromEntries(REVIEW_HEADERS.map((header) => [header, NA]));
  row.case_claim_id = caseClaim.claim_id;
  row.case_claim_text = caseClaim.claim_text;
  row.same_url_used_by_both = false;
  return row;
}

function applySource(row, legacy, bearing, metadata = {}) {
  const source = bearing || legacy || {};
  row.source_id = bearing?.referenceContentId || legacy?.reference_content_id || NA;
  row.source_title = bearing?.title || metadata.source_title || legacy?.source_title || NA;
  row.source_url = bearing?.url || legacy?.source_url || NA;
  row.publisher_name = metadata.publisher_name || legacy?.publisher_name || NA;
  row.publication_venue = metadata.publication_venue || legacy?.publication_venue || NA;
  row.source_type = metadata.source_type || legacy?.source_type || source.evidenceTargetType || NA;
}

export function buildEvidenceReviewRows({ caseClaims = [], legacyLinks = [], snapshot = null, sourceMetadataByContentId = {} } = {}) {
  const rows = [];
  const resultByClaimId = new Map((snapshot?.results || []).map((result) => [Number(result.claim.id), result]));
  for (const caseClaim of caseClaims) {
    const result = resultByClaimId.get(Number(caseClaim.claim_id));
    const hingePacket = buildClaimHingePacket(caseClaim);
    const legacyItems = legacyLinks.filter((link) => Number(link.task_claim_id) === Number(caseClaim.claim_id));
    const bearingItems = [...(result?.evidencePacket?.items || [])];
    const usedBearing = new Set();

    for (const legacy of legacyItems) {
      const bearingIndex = bearingItems.findIndex((bearing, index) =>
        !usedBearing.has(index) && sameUrl(legacy.source_url, bearing.url),
      );
      const bearing = bearingIndex >= 0 ? bearingItems[bearingIndex] : null;
      if (bearingIndex >= 0) usedBearing.add(bearingIndex);
      const rescore = bearingRescore(legacy, result, snapshot?.bearingConfig?.minBearingToScrape || 0.35);
      const candidate = (result?.candidates || []).find((item) => sameUrl(item.url, legacy.source_url));
      const quality = candidateQuality(hingePacket, candidate || {
        title: legacy.source_title, url: legacy.source_url,
        snippet: legacy.reference_claim_text || legacy.evidence_text,
      });
      const bucket = bearing ? "both_accepted_same_source"
        : ["reject", "downgrade"].includes(rescore.decision) ? "bearing_rejected_legacy"
          : "legacy_only";
      const bearingScore = bearing?.finalBearing ?? bearing?.bearingScore ?? rescore.score;
      const bearingLevel = bearing?.bearingType || (rescore.decision === "downgrade" ? "downgraded" : rescore.decision === "reject" ? "none" : "");
      const metadata = sourceMetadataByContentId[Number(bearing?.referenceContentId || legacy.reference_content_id)] || {};
      const hintInput = {
        candidate_quality_flag: quality,
        bearing_status: bearing ? "accepted" : ["reject", "downgrade"].includes(rescore.decision) ? "rejected" : "not_found",
        comparison_bucket: bucket,
        legacy_stance: legacy.stance,
        bearing_stance: bearing?.stance,
      };
      rows.push({
        "Case ID": caseClaim.claim_id,
        "Case claim": caseClaim.claim_text,
        "Source": [bearing?.title || metadata.source_title || legacy.source_title, bearing?.url || legacy.source_url].filter(Boolean).join("\n"),
        "Quality": quality,
        "Bucket": bucket,
        "Legacy claim": legacy.reference_claim_text || legacy.evidence_text || "",
        "Legacy stance": legacy.stance || "",
        "Legacy rel.": legacy.veracity ?? "",
        "Legacy rationale": legacy.rationale || "",
        "Bearing claim": bearing?.quote || bearing?.summary || "",
        "Bearing stance": bearing?.stance || "",
        "Bearing score": bearingScore === NA ? "" : bearingScore,
        "Bearing level": bearingLevel,
        "Bearing rationale": bearing?.inclusionReason || bearing?.bearingReason || rescore.reason || "",
        "Human hint": reviewHint(hintInput),
        _legacy_status: "accepted",
        _bearing_status: hintInput.bearing_status,
        _comparison_bucket: bucket,
      });
    }

    bearingItems.forEach((bearing, index) => {
      if (usedBearing.has(index)) return;
      const candidate = (result?.candidates || []).find((item) => sameUrl(item.url, bearing.url));
      const quality = candidateQuality(hingePacket, candidate || bearing);
      const metadata = sourceMetadataByContentId[Number(bearing.referenceContentId)] || {};
      rows.push({
        "Case ID": caseClaim.claim_id,
        "Case claim": caseClaim.claim_text,
        "Source": [bearing.title || metadata.source_title, bearing.url].filter(Boolean).join("\n"),
        "Quality": quality,
        "Bucket": "bearing_only",
        "Legacy claim": "", "Legacy stance": "", "Legacy rel.": "", "Legacy rationale": "",
        "Bearing claim": bearing.quote || bearing.summary || "",
        "Bearing stance": bearing.stance || "",
        "Bearing score": bearing.finalBearing ?? bearing.bearingScore ?? "",
        "Bearing level": bearing.bearingType || "",
        "Bearing rationale": bearing.inclusionReason || bearing.bearingReason || "",
        "Human hint": "Bearing accepted evidence that legacy did not retain.",
        _legacy_status: "not_found", _bearing_status: "accepted", _comparison_bucket: "bearing_only",
      });
    });
  }
  return rows;
}

export function buildGatingProjectionRows({ caseClaims = [], snapshot = null, loadRows = [] } = {}) {
  if (!snapshot) return [];
  const claimById = new Map(caseClaims.map((claim) => [Number(claim.claim_id), claim]));
  const loadByClaim = new Map(loadRows.map((row) => [Number(row.case_claim_id), row]));
  const rows = [];
  for (const result of snapshot.results || []) {
    const claim = claimById.get(Number(result.claim.id)) || { claim_id: result.claim.id, claim_text: result.claim.text };
    const packet = buildClaimHingePacket(claim);
    const actualUrls = new Set((result.evidence || []).map((item) => canonical(item.url)).filter(Boolean));
    const load = loadByClaim.get(Number(claim.claim_id)) || {};
    const totalTokens = numeric(load.legacy_total_tokens) ?? 0;
    const averageTokens = actualUrls.size ? Math.floor((totalTokens / actualUrls.size) * 0.6) : 0;
    const seenCanonical = new Set();
    for (const candidate of result.candidates || []) {
      const key = canonical(candidate.url);
      const duplicate = Boolean(key && seenCanonical.has(key));
      if (key) seenCanonical.add(key);
      const gate = gateCandidate(packet, candidate, duplicate);
      const actuallyScraped = actualUrls.has(key);
      const rejectedScraped = gate.decision === "reject" && actuallyScraped;
      rows.push({
        "Decision": gate.decision,
        "Score": candidate.bearingPreScore ?? candidate.deterministicBearingScore ?? NA,
        "Case claim": claim.claim_text,
        "Query": candidate.query || NA,
        "Result title": candidate.title || NA,
        "Gate reason": gate.reason,
        "Calls avoided": rejectedScraped ? 3 : 0,
        "Tokens avoided": rejectedScraped ? averageTokens : 0,
        "URL": candidate.url || NA,
        case_claim_id: claim.claim_id,
        gate_decision: gate.decision,
        estimated_downstream_calls_avoided: rejectedScraped ? 3 : 0,
        estimated_tokens_avoided: rejectedScraped ? averageTokens : 0,
        _candidate_quality_flag: gate.quality,
        _actually_scraped: actuallyScraped,
        _canonical_url: key,
      });
    }
  }
  return rows;
}

function sumNumeric(rows, field) {
  const values = rows.map((row) => numeric(row[field])).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : NA;
}

function deltaPercent(delta, baseline) {
  return typeof delta === "number" && typeof baseline === "number" && baseline > 0
    ? Number(((delta / baseline) * 100).toFixed(2)) : NA;
}

export function buildEvidenceSummaryRows({ contentId, caseClaims = [], snapshot = null, reviewRows = [], gatingRows = [], loadRows = [] } = {}) {
  return caseClaims.map((claim) => {
    const claimRows = reviewRows.filter((row) => Number(row["Case ID"]) === Number(claim.claim_id));
    const bucketCount = (bucket) => claimRows.filter((row) => row["Bucket"] === bucket).length;
    const legacyScores = claimRows.map((row) => numeric(row["Legacy rel."])).filter((value) => value !== null);
    const bearingScores = claimRows.map((row) => numeric(row["Bearing score"])).filter((value) => value !== null);
    const average = (values) => values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : "";
    return {
      "Case ID": claim.claim_id,
      "Case claim": claim.claim_text,
      "Rows": claimRows.length,
      "Legacy accepted": claimRows.filter((row) => row._legacy_status === "accepted").length,
      "Bearing accepted": claimRows.filter((row) => row._bearing_status === "accepted").length,
      "Both accepted": bucketCount("both_accepted_same_source"),
      "Bearing rejected legacy": bucketCount("bearing_rejected_legacy"),
      "Bearing only": bucketCount("bearing_only"),
      "Legacy only": bucketCount("legacy_only"),
      "Legacy better": bucketCount("legacy_better_match"),
      "Bearing better": bucketCount("bearing_better_match"),
      "Non-good candidates": claimRows.filter((row) => !["good_candidate", "unclear"].includes(row["Quality"])).length,
      "Avg legacy rel.": average(legacyScores),
      "Avg bearing score": average(bearingScores),
    };
  });
}

export function buildTokenSummaryRows({ contentId, caseClaims = [], snapshot = null, gatingRows = [], loadRows = [] } = {}) {
  const legacyUrls = sumNumeric(loadRows, "legacy_urls_scraped");
  const bearingUrls = sumNumeric(loadRows, "bearing_urls_scraped_actual");
  const legacyCalls = sumNumeric(loadRows, "legacy_total_llm_calls");
  const bearingCalls = sumNumeric(loadRows, "bearing_total_llm_calls_actual");
  const legacyTokens = sumNumeric(loadRows, "legacy_total_tokens");
  const bearingTokens = sumNumeric(loadRows, "bearing_total_tokens_actual");
  const projectedTokens = sumNumeric(loadRows, "projected_total_tokens");
  const actualDelta = typeof legacyTokens === "number" && typeof bearingTokens === "number" ? bearingTokens - legacyTokens : NA;
  const projectedDelta = typeof legacyTokens === "number" && typeof projectedTokens === "number" ? projectedTokens - legacyTokens : NA;
  const junk = gatingRows.filter((row) => !["good_candidate", "unclear"].includes(row._candidate_quality_flag));
  const rejected = junk.filter((row) => row.gate_decision === "reject");
  const rejectedScraped = rejected.filter((row) => row._actually_scraped);
  const avoidedUrls = new Set(rejectedScraped.map((row) => row._canonical_url).filter(Boolean)).size;
  const metric = (name, value, meaning = "") => ({ Metric: name, Value: value, Meaning: meaning });
  const captured = snapshot?.actualTokenUsage || null;
  return [
    metric("Content ID", contentId),
    metric("Case claims", caseClaims.length),
    metric("Search candidates", (snapshot?.results || []).reduce((sum, result) => sum + (result.candidates || []).length, 0)),
    metric("Legacy URLs scraped", legacyUrls, snapshot?.flags?.enableBearingGating ? "Unavailable because this run used live bearing gating." : ""),
    metric("Bearing URLs scraped actual", bearingUrls, "Actual URL/claim occurrences processed by the bearing run."),
    metric("Legacy LLM calls actual", legacyCalls),
    metric("Bearing LLM calls actual", bearingCalls),
    metric("Legacy tokens actual", legacyTokens),
    metric("Bearing tokens actual", bearingTokens),
    metric("Captured OpenAI calls", captured?.calls ?? NA, "Exact API-reported calls across the complete scrape-task request."),
    metric("Captured OpenAI input tokens", captured?.inputTokens ?? NA, "Exact API-reported prompt tokens."),
    metric("Captured OpenAI output tokens", captured?.outputTokens ?? NA, "Exact API-reported completion tokens."),
    metric("Captured OpenAI total tokens", captured?.totalTokens ?? NA, "Exact API-reported total; use this instead of estimates for this run."),
    metric("Captured cached input tokens", captured?.cachedInputTokens ?? NA, "Subset of input tokens served from provider cache."),
    metric("Captured pre-evidence tokens", captured?.phases?.preEvidence?.totalTokens ?? NA, "Task claim extraction and argument mapping before evidence retrieval."),
    metric("Captured evidence-engine tokens", captured?.phases?.evidenceEngine?.totalTokens ?? NA, "Query generation, snippet-bearing scoring, and full-document quote extraction."),
    metric("Captured post-evidence tokens", captured?.phases?.postEvidence?.totalTokens ?? NA, "Reference-claim extraction and final claim matching."),
    metric("Actual token delta", actualDelta, "Negative means fewer actual bearing tokens; unavailable when legacy was not run."),
    metric("Actual token delta %", deltaPercent(actualDelta, legacyTokens)),
    metric("Projected tokens with snippet gate", projectedTokens, "Projection only when gating was off; actual gated runs should be judged by bearing actual."),
    metric("Projected token delta", projectedDelta, "Negative means fewer projected bearing tokens."),
    metric("Projected token delta %", deltaPercent(projectedDelta, legacyTokens)),
    metric("Junk candidates seen", junk.length, "Candidates marked not good."),
    metric("Junk candidates that would be gated", rejected.length, "Deterministic review classification."),
    metric("Estimated scrapes avoided", avoidedUrls, "Conservative candidate URLs rejected before downstream work."),
    metric("Estimated claim extractions avoided", Math.min(rejectedScraped.length, avoidedUrls)),
    metric("Estimated match calls avoided", Math.min(rejectedScraped.length, avoidedUrls)),
  ];
}
