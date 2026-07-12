// backend/src/core/candidateSurvival.js
//
// Candidate survival + pre-bearing selection.
//
// Principle: good raw search results must survive long enough for BEARING to
// judge them. Do not trim candidates by provider score before bearing. Instead
// preserve a bounded union, run the cheap deterministic bearing pre-score, and
// use deterministic bearing + verified document role + bearing-text richness to
// choose what enters the (expensive) LLM bearing batch. Provider score is
// provenance/debug metadata only — never the primary pre-bearing gate.
//
// See docs/evidence-query-stance-analysis.md and the candidate-survival repair.

import logger from "../utils/logger.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";

// Canonical, stringly-stable stage names so drop-audit assertions are not
// brittle. Every candidate removed (from the pipeline OR from a bounded batch)
// logs exactly one of these. Do NOT use ad hoc stage strings.
export const DROP_STAGES = Object.freeze({
  RAW_RESULT: "raw_result",
  CANONICAL_MERGE: "canonical_merge",
  PRE_BEARING_POOL: "pre_bearing_pool",
  DETERMINISTIC_BEARING_GATE: "deterministic_bearing_gate",
  LLM_BEARING_BATCH: "llm_bearing_batch",
  LLM_BEARING_RESULT: "llm_bearing_result",
  GATING: "gating",
  ADAPTIVE_SCRAPE: "adaptive_scrape",
  PACKET_SELECTION: "packet_selection",
});

// Canonical drop reasons. The lane cap reason is suffixed with the lane name at
// call time (e.g. `max_candidates_per_purpose_lane:alleged_conduct`).
export const DROP_REASONS = Object.freeze({
  MAX_PRE_BEARING_PER_CLAIM: "max_pre_bearing_candidates_per_claim",
  MAX_PER_PURPOSE_LANE: "max_candidates_per_purpose_lane",
  BEYOND_LLM_BEARING_CAP: "beyond_llm_bearing_cap_survives_with_deterministic_score",
});

// Coarse safety bounds. These are NOT routine provider-score filters; they are
// count valves set high enough that they rarely bite. Overridable via opt.
export const DEFAULT_SURVIVAL_BOUNDS = Object.freeze({
  maxPreBearingCandidatesPerClaim: 50,
  maxLlmBearingCandidatesPerClaim: 12,
  maxCandidatesPerPurposeLane: 10,
  maxVerifiedDocumentCandidates: 8,
});

export function resolveSurvivalBounds(opt = {}) {
  return {
    maxPreBearingCandidatesPerClaim: Number(opt.maxPreBearingCandidatesPerClaim) || DEFAULT_SURVIVAL_BOUNDS.maxPreBearingCandidatesPerClaim,
    maxLlmBearingCandidatesPerClaim: Number(opt.maxLlmBearingCandidatesPerClaim) || DEFAULT_SURVIVAL_BOUNDS.maxLlmBearingCandidatesPerClaim,
    maxCandidatesPerPurposeLane: Number(opt.maxCandidatesPerPurposeLane) || DEFAULT_SURVIVAL_BOUNDS.maxCandidatesPerPurposeLane,
    maxVerifiedDocumentCandidates: Number(opt.maxVerifiedDocumentCandidates) || DEFAULT_SURVIVAL_BOUNDS.maxVerifiedDocumentCandidates,
  };
}

const OFFICIAL_DOMAIN_RE = /(^|\.)(?:cdc\.gov|nih\.gov|ncbi\.nlm\.nih\.gov|who\.int|fda\.gov|nature\.com|nejm\.org|thelancet\.com|bmj\.com|jamanetwork\.com|cochranelibrary\.com|cochrane\.org|europepmc\.org|clinicaltrials\.gov|\w+\.gov|\w+\.edu)$/i;
const ACADEMIC_SOCIAL_DOMAIN_RE = /(^|\.)(?:academia\.edu|researchgate\.net|semanticscholar\.org|mendeley\.com|ssrn\.com)$/i;
const PRESS_RELEASE_DOMAIN_RE = /(^|\.)(?:globenewswire\.com|prnewswire\.com|businesswire\.com|prweb\.com|newswire\.com|einnews\.com|marketwatch\.com\/press-release)$/i;
const NEWS_DOMAIN_RE = /(^|\.)(?:cnn\.com|edition\.cnn\.com|nytimes\.com|washingtonpost\.com|theguardian\.com|foxnews\.com|nbcnews\.com|reuters\.com|apnews\.com|bbc\.co\.uk|bbc\.com|forbes\.com|huffpost\.com|vox\.com)$/i;

// Document role priority (1 = highest). A verified original study with a thin
// snippet outranks a press release with a loud snippet.
export const DOCUMENT_ROLE_PRIORITY = Object.freeze({
  original_study_candidate: 1,
  official_study_page_candidate: 2,
  primary_statement_candidate: 3,
  official_response_candidate: 4,
  related_reanalysis_candidate: 5,
  methodology_or_review_candidate: 6,
  news_or_commentary_candidate: 7,
  advocacy_or_press_release_candidate: 8,
});

export function documentRolePriority(role) {
  return DOCUMENT_ROLE_PRIORITY[role] || 99;
}

function domainOf(candidate) {
  const raw = candidate?.domain || (() => {
    try { return new URL(candidate?.url || "").hostname; } catch { return ""; }
  })();
  return String(raw || "").toLowerCase().replace(/^www\./, "");
}

export function bearingTextLength(candidate) {
  return String(candidate?.bearingText || candidate?.snippet || "").trim().length;
}

export function hasApiAbstract(candidate) {
  if (candidate?.academicApiContent?.apiBacked) return true;
  const source = String(candidate?.bearingTextSource || "").toLowerCase();
  return source.includes("abstract") || source.includes("pubmed") || source.includes("crossref") || source.includes("openalex");
}

function academicIdentifiers(candidate) {
  const ids = candidate?.academicApiContent?.identifiers || {};
  const pmid = ids.pmid || /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i.exec(candidate?.url || "")?.[1] || null;
  const doi = ids.doi || /doi\.org\/([^\s?#]+)/i.exec(candidate?.url || "")?.[1] || null;
  const pmcid = ids.pmcid || /PMC\d+/i.exec(candidate?.url || "")?.[0] || null;
  return { pmid, doi, pmcid };
}

// Verified document role is derived ONLY from the document's own properties —
// never from the query's requested evidenceTargetType. A press release returned
// by an "original study" query is not an original study.
export function deriveVerifiedDocumentRole(candidate = {}) {
  const signals = [];
  const domain = domainOf(candidate);
  const { pmid, doi, pmcid } = academicIdentifiers(candidate);
  if (pmid) signals.push(`pmid:${pmid}`);
  if (doi) signals.push(`doi:${doi}`);
  if (pmcid) signals.push(`pmcid:${pmcid}`);
  if (candidate.academicApiContent?.apiBacked) signals.push("api_backed");
  if (candidate.protectedDocumentIdentity) signals.push("protected_identity");
  if (candidate.resolvedWorkIdentity) signals.push("resolved_work");
  const officialDomain = OFFICIAL_DOMAIN_RE.test(domain) && !ACADEMIC_SOCIAL_DOMAIN_RE.test(domain);
  if (officialDomain) signals.push(`official_domain:${domain}`);

  const identityRole = String(candidate.identityRole || candidate.identityBearingType || "").toLowerCase();

  // Press releases are never studies, regardless of the query that found them.
  if (PRESS_RELEASE_DOMAIN_RE.test(domain)) {
    return { role: "advocacy_or_press_release_candidate", verified: false, signals: [...signals, `press_release_domain:${domain}`] };
  }

  const hasBibId = Boolean(pmid || doi || pmcid || candidate.academicApiContent?.apiBacked);

  // Study-identity discovery role labels take precedence when present; map them
  // to the spec vocabulary.
  const roleMap = {
    original_study: "original_study_candidate",
    official_study_page: "official_study_page_candidate",
    reanalysis: "related_reanalysis_candidate",
    attribution_document: "primary_statement_candidate",
    official_response: "official_response_candidate",
    methodology: "methodology_or_review_candidate",
    review: "methodology_or_review_candidate",
    systematic_review: "methodology_or_review_candidate",
    commentary: "news_or_commentary_candidate",
    news: "news_or_commentary_candidate",
  };
  if (roleMap[identityRole]) {
    const verified = hasBibId || officialDomain || candidate.protectedDocumentIdentity === true;
    return { role: roleMap[identityRole], verified, signals };
  }

  if (hasBibId) {
    return { role: "original_study_candidate", verified: true, signals };
  }
  if (officialDomain) {
    return { role: "official_study_page_candidate", verified: true, signals };
  }
  // Recognizable news/commentary outlets are labeled but NOT verified documents.
  if (NEWS_DOMAIN_RE.test(domain)) {
    return { role: "news_or_commentary_candidate", verified: false, signals: [...signals, `news_domain:${domain}`] };
  }
  return null;
}

// Verify a study-identity resolved work by its OWN properties, for anchor
// hygiene in retrievalContext (a press-release title must never become a
// required study anchor). Reuses the document-role derivation.
export function isVerifiedResolvedWork(work = {}) {
  const identifier = String(work?.identifier || "");
  if (/PMID\s*\d+|DOI\s+\S+|\bPMC\d+/i.test(identifier)) return true;
  const role = deriveVerifiedDocumentRole({
    url: work?.url || "",
    title: work?.title || "",
    academicApiContent: work?.academicApiContent
      || (/PMID|DOI|PMC/i.test(identifier) ? { apiBacked: true } : null),
    identityRole: work?.identityRole,
    protectedDocumentIdentity: work?.verifiedDocumentIdentity,
  });
  return Boolean(role?.verified);
}

// Numeric rank for source-type quality (higher is better), used as a weak
// ordering signal well below bearing.
function sourceTypeRank(candidate) {
  const role = deriveVerifiedDocumentRole(candidate);
  if (role?.verified) return 4;
  if (role) return 3;
  const domain = domainOf(candidate);
  if (OFFICIAL_DOMAIN_RE.test(domain) && !ACADEMIC_SOCIAL_DOMAIN_RE.test(domain)) return 3;
  if (PRESS_RELEASE_DOMAIN_RE.test(domain)) return 0;
  return 1;
}

function providerScore(candidate) {
  const value = Number(candidate?.score);
  return Number.isFinite(value) ? value : 0;
}

function deterministicScore(candidate) {
  const value = Number(candidate?.deterministicBearingScore);
  return Number.isFinite(value) ? value : -1; // unknown sorts below any real score
}

// Comparator for choosing which occurrence becomes the canonical record when
// duplicate URLs collapse. Prefers verified identity, then API abstract, then
// richer bearing text, then source-type quality, then (weakly) provider score.
// Returns positive if `a` should win over `b`.
export function richnessComparator(a, b) {
  const av = deriveVerifiedDocumentRole(a)?.verified ? 1 : 0;
  const bv = deriveVerifiedDocumentRole(b)?.verified ? 1 : 0;
  if (av !== bv) return av - bv;
  const aa = hasApiAbstract(a) ? 1 : 0;
  const ba = hasApiAbstract(b) ? 1 : 0;
  if (aa !== ba) return aa - ba;
  const at = bearingTextLength(a);
  const bt = bearingTextLength(b);
  if (at !== bt) return at - bt;
  const as = sourceTypeRank(a);
  const bs = sourceTypeRank(b);
  if (as !== bs) return as - bs;
  return providerScore(a) - providerScore(b);
}

// Merge two occurrences of the same canonical URL: keep the richer record as the
// base, but adopt the richer bearing text if the other occurrence has it, and
// union ALL provenance (queries, providers, purpose lanes, target assignments,
// provider scores, bearing-text variants).
export function mergeCanonicalOccurrence(existing, incoming) {
  const keepA = richnessComparator(existing, incoming) >= 0;
  const base = keepA ? existing : incoming;
  const other = keepA ? incoming : existing;

  // Adopt the richest bearing text across both occurrences.
  let bearingText = base.bearingText;
  let bearingTextSource = base.bearingTextSource;
  if (bearingTextLength(other) > String(bearingText || "").trim().length) {
    bearingText = other.bearingText || other.snippet;
    bearingTextSource = other.bearingTextSource || bearingTextSource;
  }

  const occurrenceOf = (c) => ({
    query: c.query || null,
    provider: c.provider || c.source || null,
    providerScore: Number.isFinite(Number(c.score)) ? Number(c.score) : null,
    purposeLane: c.purposeLane || c.retrievalPurpose || null,
    evidenceTargetId: c.evidenceTargetId || null,
    evidenceTargetType: c.evidenceTargetType || null,
    bearingRequirement: c.bearingRequirement || null,
    bearingCriteria: c.bearingCriteria || null,
    weakBearing: Boolean(c.weakBearing),
    queryExpansionSourceClaimIds: c.queryExpansionSourceClaimIds || [],
    queryExpansionAudit: c.queryExpansionAudit || null,
    snippet: c.snippet || null,
    bearingTextSource: c.bearingTextSource || null,
  });

  const provenance = [
    ...(base.retrievalProvenance || base.targetProvenance || [occurrenceOf(base)]),
    ...(other.retrievalProvenance || other.targetProvenance || [occurrenceOf(other)]),
  ];

  return {
    ...base,
    bearingText,
    bearingTextSource,
    // Preserve the richer academic content if either side had it.
    academicApiContent: base.academicApiContent || other.academicApiContent || null,
    targetProvenance: provenance,
    retrievalProvenance: provenance,
  };
}

function candidateKey(candidate) {
  return canonicalizeUrl(candidate?.url) || candidate?.url || candidate?.id || "";
}

export function logCandidateDrop({ claim, taskContentId = null, stage, candidate, reason }) {
  const role = deriveVerifiedDocumentRole(candidate);
  const provenance = candidate?.targetProvenance || candidate?.retrievalProvenance || [];
  logger.log(`[CANDIDATE_DROP_AUDIT] ${JSON.stringify({
    event: "candidate_drop",
    taskContentId,
    claimId: claim?.id ?? null,
    droppedAtStage: stage,
    droppedReason: String(reason || "unspecified").slice(0, 200),
    title: String(candidate?.title || "").slice(0, 200),
    url: String(candidate?.url || "").slice(0, 500),
    canonicalUrl: candidateKey(candidate).slice(0, 500),
    provider: candidate?.provider || candidate?.source || null,
    queryText: String(candidate?.query || "").slice(0, 200),
    purposeLane: candidate?.purposeLane || candidate?.retrievalPurpose || null,
    targetId: candidate?.evidenceTargetId ?? null,
    targetType: candidate?.evidenceTargetType || null,
    providerScore: Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : null,
    deterministicBearingScore: Number.isFinite(Number(candidate?.deterministicBearingScore)) ? Number(candidate.deterministicBearingScore) : null,
    verifiedDocumentRole: role?.role || null,
    wasVerifiedReservedSlotEligible: Boolean(role?.verified),
    bearingTextLength: bearingTextLength(candidate),
    hasApiAbstract: hasApiAbstract(candidate),
    allProvenanceCount: Array.isArray(provenance) ? provenance.length : 0,
    selectedCanonicalTextSource: candidate?.bearingTextSource || (candidate?.bearingText ? "bearing_text" : "search_snippet"),
  })}`);
}

// Coarse bounded union used right after dedupe, BEFORE deterministic bearing.
// It only enforces count safety valves (per lane, per claim); it never cuts on
// provider score alone. Verified documents are never dropped by this stage.
// Returns { kept, dropped:[{candidate, reason}] }.
export function boundCandidateUnion({ candidates = [], bounds }) {
  const b = bounds || DEFAULT_SURVIVAL_BOUNDS;
  const dropped = [];
  const kept = [];
  const laneMembers = new Map(); // lane -> indices into `kept`
  let nonVerifiedCount = 0;

  // Preserve INPUT ORDER. The caps are coarse safety valves that only bite when
  // a lane or the claim exceeds its bound; when they do, we evict the weakest
  // by richness (NOT provider score) rather than reordering the whole pool.
  for (const candidate of candidates) {
    const role = deriveVerifiedDocumentRole(candidate);
    // Verified documents bypass the coarse caps entirely.
    if (role?.verified) {
      kept.push(candidate);
      continue;
    }
    const lane = candidate.purposeLane || candidate.retrievalPurpose || "unknown";
    const members = laneMembers.get(lane) || [];

    if (members.length >= b.maxCandidatesPerPurposeLane) {
      // Lane is full: keep the incoming only if it is richer than the weakest
      // current member of the lane; otherwise drop the incoming.
      const weakestIdx = members.reduce(
        (wi, idx) => (richnessComparator(kept[idx], kept[wi]) < 0 ? idx : wi),
        members[0],
      );
      if (richnessComparator(candidate, kept[weakestIdx]) > 0) {
        dropped.push({ candidate: kept[weakestIdx], reason: `${DROP_REASONS.MAX_PER_PURPOSE_LANE}:${lane}` });
        kept[weakestIdx] = candidate; // replace in place preserves position/order
      } else {
        dropped.push({ candidate, reason: `${DROP_REASONS.MAX_PER_PURPOSE_LANE}:${lane}` });
      }
      continue;
    }

    if (nonVerifiedCount >= b.maxPreBearingCandidatesPerClaim) {
      dropped.push({ candidate, reason: DROP_REASONS.MAX_PRE_BEARING_PER_CLAIM });
      continue;
    }

    members.push(kept.length);
    laneMembers.set(lane, members);
    kept.push(candidate);
    nonVerifiedCount += 1;
  }
  return { kept, dropped };
}

// Order candidates so the ones that should enter the LLM bearing batch come
// first, and return which fall beyond the cap (excluded from LLM, but they
// survive downstream with their deterministic score). Selection priority:
// verified document role -> deterministic bearing -> bearing-text richness ->
// source-type quality -> provider score (weak tie-break). Verified documents get
// reserved slots so a thin-snippet verified study is never crowded out.
function identifierStrength(candidate) {
  const { pmid, doi, pmcid } = academicIdentifiers(candidate);
  if (pmid) return 4;
  if (doi) return 3;
  if (pmcid) return 2;
  if (candidate?.academicApiContent?.apiBacked) return 1;
  return 0;
}

function targetFit(candidate) {
  // A candidate assigned to a specific evaluation target/lane fits better than an
  // unrouted one. Coarse, weak signal below role priority.
  return candidate?.evidenceTargetId != null ? 1 : 0;
}

// Order candidates for the LLM bearing batch. Verified documents get RESERVED
// slots and BYPASS the deterministic-bearing gate: a verified original study
// with a thin snippet (low deterministic score) must survive ahead of a press
// release with a loud snippet. Non-verified candidates compete on deterministic
// bearing. Provider score is only a final tie-break. Candidates beyond the cap
// are excluded from the LLM batch but survive downstream with deterministic
// scores; callers log them at DETERMINISTIC_BEARING_GATE.
export function orderForLlmBearing({ candidates = [], bounds }) {
  const b = bounds || DEFAULT_SURVIVAL_BOUNDS;
  const scored = candidates.map((candidate) => ({ candidate, role: deriveVerifiedDocumentRole(candidate) }));

  // Verified reserved slots, ranked by: role priority -> target fit ->
  // identifier strength -> bearing-text richness -> deterministic (tie-break).
  const verifiedRank = (e) => [
    -documentRolePriority(e.role?.role),      // higher priority = larger (negate rank number)
    targetFit(e.candidate),
    identifierStrength(e.candidate),
    bearingTextLength(e.candidate),
    deterministicScore(e.candidate),
  ];
  // Non-verified competition, ordered by deterministic bearing first.
  const generalRank = (e) => [
    e.role?.verified ? 1 : 0,                  // any extra verified still outrank noise
    deterministicScore(e.candidate),
    bearingTextLength(e.candidate),
    sourceTypeRank(e.candidate),
    providerScore(e.candidate),
  ];
  const byRank = (rankFn) => (a, c) => {
    const ra = rankFn(a);
    const rc = rankFn(c);
    for (let i = 0; i < ra.length; i += 1) {
      if (ra[i] !== rc[i]) return rc[i] - ra[i];
    }
    return 0;
  };

  const verifiedAll = scored.filter((e) => e.role?.verified).sort(byRank(verifiedRank));
  const reserved = verifiedAll.slice(0, b.maxVerifiedDocumentCandidates);
  const reservedKeys = new Set(reserved.map((e) => candidateKey(e.candidate)));
  const rest = scored
    .filter((e) => !reservedKeys.has(candidateKey(e.candidate)))
    .sort(byRank(generalRank));

  const remainingSlots = Math.max(0, b.maxLlmBearingCandidatesPerClaim - reserved.length);
  const selectedRest = rest.slice(0, remainingSlots);
  const excludedRest = rest.slice(remainingSlots);

  const ordered = [...reserved, ...selectedRest, ...excludedRest].map((e) => e.candidate);
  const excludedFromLlm = excludedRest.map((e) => e.candidate);
  return { ordered, excludedFromLlm, llmBatchSize: reserved.length + selectedRest.length };
}
