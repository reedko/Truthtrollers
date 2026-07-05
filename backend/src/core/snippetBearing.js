import logger from "../utils/logger.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { applyQuantitativeStanceGuard } from "./quantitativeClaimGuard.js";
import { normalizeBearingText, tokenizeBearingText } from "./evidenceNeed.js";
import { deriveVerifiedDocumentRole } from "./candidateSurvival.js";

export const BEARING_SHADOW_METHOD = "deterministic_v1";
export const BEARING_SHADOW_CONFIG_VERSION = 1;
export const DEFAULT_MIN_BEARING_TO_SCRAPE = 0.35;
export const SNIPPET_BEARING_LLM_METHOD = "snippet_bearing_llm_v1";
export const SNIPPET_BEARING_PROMPT_VERSION = 1;
export const DEFAULT_MAX_SNIPPET_CANDIDATES = 12;
// Per-target LLM sub-batch size (see assessSnippetBearingBatch). The per-claim
// total stays bounded by the caller's maxCandidates; target-splitting only makes
// each LLM call smaller and target-focused, so it does not raise cost.
export const DEFAULT_MAX_CANDIDATES_PER_TARGET_BATCH = 6;

// The five verified document roles that must never be scored as irrelevant on a
// thin snippet, and the role-appropriate fallback bearing they receive.
const VERIFIED_FALLBACK_BY_ROLE = Object.freeze({
  original_study_candidate: { bearingType: "origin", expectedStance: "background", floor: 0.4, component: "object" },
  official_study_page_candidate: { bearingType: "origin", expectedStance: "background", floor: 0.38, component: "object" },
  primary_statement_candidate: { bearingType: "direct", expectedStance: "support", floor: 0.35, component: "attribution" },
  official_response_candidate: { bearingType: "direct", expectedStance: "nuance", floor: 0.35, component: "relation" },
  related_reanalysis_candidate: { bearingType: "indirect", expectedStance: "nuance", floor: 0.35, component: "warrant" },
});

// Jaccard-style containment of the claim's own allegation wording inside the
// candidate text. High containment from a NON-INDEPENDENT source is allegation
// repetition, not proof.
function claimRestatementSimilarity(claimText, candidateText) {
  const claimTokens = new Set(tokenizeBearingText(claimText));
  if (claimTokens.size === 0) return 0;
  const candTokens = new Set(tokenizeBearingText(candidateText));
  let shared = 0;
  for (const token of claimTokens) if (candTokens.has(token)) shared += 1;
  return shared / claimTokens.size; // containment of claim within candidate
}

// Allegation repetition requires a POSITIVELY-identified amplifier source
// (press release or news/commentary). An unverified/unknown web page is NOT
// treated as a non-independent amplifier — it may be genuine direct evidence,
// so we do not suppress it here (the LLM classifies it when available). Only
// sources we can name as amplifiers are eligible for the allegation-repetition
// down-weight.
function isNonIndependentAmplifier(role) {
  return role?.role === "advocacy_or_press_release_candidate" ||
    role?.role === "news_or_commentary_candidate";
}

// Classify the deterministic bearing of a candidate for a specific target using
// existing signals only: verifiedDocumentRole + evidenceTargetType + the
// deterministic components. Returns flags + a fallback category. This never
// invents a parallel classifier.
export function classifyDeterministicBearing(evidenceNeed = {}, candidate = {}, result = {}) {
  const role = deriveVerifiedDocumentRole(candidate);
  const components = result.components || {};
  const targetType = String(candidate.evidenceTargetType || "").toLowerCase();
  const claimText = evidenceNeed.effectiveClaimText || evidenceNeed.claimText || "";
  const candidateText = `${candidate.title || ""} ${candidate.bearingText || candidate.snippet || ""}`;

  const restatement = claimRestatementSimilarity(claimText, candidateText);
  // Allegation repetition: the candidate largely restates the claim's own
  // allegation AND the source is a named amplifier (press release / news). A
  // plain unverified page that happens to state the claim is NOT flagged — it
  // may be genuine direct evidence.
  const allegationRepetition = restatement >= 0.7 && isNonIndependentAmplifier(role);

  const hasPredicate = (components.relation || 0) > 0.2 || (components.object || 0) > 0.35;
  const attributionOnly = ((components.attributionOrCausal || 0) > 0.5 || targetType === "attribution")
    && !hasPredicate;
  const topicOnly = (components.subject || 0) >= 0.5 && !hasPredicate
    && (components.attributionOrCausal || 0) <= 0.5 && !role?.verified;

  let fallbackCategory = "topic_only";
  if (role?.role === "original_study_candidate") fallbackCategory = "original_study";
  else if (role?.role === "official_study_page_candidate") fallbackCategory = "study_page";
  else if (role?.role === "related_reanalysis_candidate" || role?.role === "methodology_or_review_candidate") fallbackCategory = "methodology_reanalysis";
  else if (role?.role === "official_response_candidate") fallbackCategory = "official_response";
  else if (role?.role === "primary_statement_candidate" || attributionOnly) fallbackCategory = "attribution_only";
  else if (allegationRepetition) fallbackCategory = "allegation_repetition";
  else if (["systematic_review", "meta_analysis"].includes(targetType)) fallbackCategory = "background_causal";
  else if (hasPredicate && !allegationRepetition) fallbackCategory = "direct";

  return { role, allegationRepetition, attributionOnly, topicOnly, fallbackCategory, restatement: round4(restatement) };
}

const EXPECTED_STANCES = new Set(["support", "refute", "nuance", "background", "insufficient"]);
const PRE_BEARING_TYPES = new Set(["direct", "indirect", "context", "origin", "steelman", "none"]);
const TRIAGE_DECISIONS = new Set(["scrape", "maybe", "skip"]);
const ADDRESSED_COMPONENTS = new Set(["whole_claim", "subject", "relation", "object", "scope", "attribution", "warrant", "none"]);

const SNIPPET_BEARING_FALLBACK_SYSTEM = `You assess whether search-result titles and snippets are likely to contain evidence that bears on one exact case claim.

Bearing means likely truth-value impact on the specific claim. It is not source quality, authority, confidence, stance, political agreement, or broad topical relevance.

Return strict JSON only. Include every candidateKey exactly once.`;

const SNIPPET_BEARING_FALLBACK_USER = `CASE CLAIM:
{{claimJson}}

EVIDENCE NEED:
{{evidenceNeedJson}}

SEARCH CANDIDATES:
{{candidatesJson}}

For every candidate, return:
- candidateKey: copy the provided stable key exactly
- url: copy the provided URL exactly
- bearingPreScore: 0.0-1.0 estimate that the page contains evidence affecting the exact claim
- expectedStance: support|refute|nuance|background|insufficient (provisional; do not copy query intent)
- bearingType: direct|indirect|context|origin|steelman|none
- claimComponentAddressed: whole_claim|subject|relation|object|scope|attribution|warrant|none
- triageDecision: scrape|maybe|skip
- reason: one short exact-claim explanation

Rules:
1. Do not reward same-topic overlap alone. High bearing requires likely alignment with the claim's subject, relation/predicate, object/outcome, scope, attribution, causal strength, or warrant.
2. Do not use publisher prestige or domain authority as bearing. A high-authority page can have low bearing; a low-quality page can have high bearing.
3. A snippet is high-bearing only if it likely contains evidence that could support, refute, or materially qualify the exact claim.
4. Association/correlation only partially bears on a causal claim unless causal or mechanistic evidence is explicit.
5. For "X said Y", whether X said Y and whether Y is true are separate. State which component the snippet appears to address.
6. An article-level fact-check does not refute every embedded subclaim unless the snippet addresses this exact subclaim.
7. Do not infer expected stance from the search query's support/refute label.
8. If a snippet is vague, score conservatively. Use maybe only when it appears to be an origin/primary source or a genuinely direct steelman path.
9. Background that does not change scope or warrant is low-bearing.

Return exactly:
{"results":[{"candidateKey":"c0","url":"...","bearingPreScore":0.0,"expectedStance":"insufficient","bearingType":"none","claimComponentAddressed":"none","triageDecision":"skip","reason":"..."}]}`;

const EVIDENCE_ARTIFACTS = {
  primary_source: ["transcript", "statement", "press release", "official report", "primary source", "testimony", "speech"],
  original_study: ["study", "trial", "cohort", "experiment", "research paper", "original research"],
  systematic_review: ["systematic review", "meta-analysis", "meta analysis", "review of studies"],
  government_source: ["government report", "agency report", "official data", "public health report"],
  expert_critique: ["expert critique", "methodological critique", "peer review", "commentary"],
  fact_check: ["fact check", "fact-check", "debunk", "verification"],
  dataset: ["dataset", "data set", "data release", "statistics", "table"],
  opposing_argument: ["counterargument", "response", "rebuttal", "critique"],
  news_report: ["news report", "reported", "investigation"],
  other: ["study", "report", "data", "evidence", "analysis", "transcript"],
};

const GENERIC_PAGE_RE = /\b(home|homepage|category|topics?|tag|archive|about us|overview|resources|latest news|search results|index)\b/i;
const SUBSTANTIVE_RE = /\b(cause[sd]?|associated|correlated|increase[sd]?|decrease[sd]?|higher|lower|found|shows?|reported|said|states?|confirmed|contradicts?|refutes?|no evidence|data|study|trial|report|review|dataset|transcript|\d+(?:\.\d+)?%)\b/i;
const CAUSAL_RE = /\b(cause[sd]?|causal|leads? to|results? in|mechanism|produces?|triggers?)\b/i;
const ASSOCIATION_ONLY_RE = /\b(associated|association|correlated|correlation|linked with|relationship)\b/i;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function round4(value) {
  return Math.round(clamp01(value) * 10000) / 10000;
}

function bounded(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function nullableScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return round4(parsed);
}

function normalizedEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function fillPromptTemplate(template, values) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

function termForms(term) {
  const normalized = normalizeBearingText(term);
  const tokens = tokenizeBearingText(normalized);
  return { normalized, tokens };
}

function tokenStem(token) {
  if (token.length <= 4) return token;
  return token
    .replace(/(?:ization|isation)$/, "ize")
    .replace(/(?:ations?|ments?)$/, "")
    .replace(/(?:ing|ers?|ed|es|s)$/, "");
}

function termMatchesText(term, normalizedText, tokenSet, stemSet) {
  const { normalized, tokens } = termForms(term);
  if (!normalized) return false;
  if (tokens.length > 1 && normalizedText.includes(normalized)) return true;
  if (tokens.length === 1) {
    const token = tokens[0];
    return tokenSet.has(token) || stemSet.has(tokenStem(token));
  }
  return tokens.every((token) => tokenSet.has(token) || stemSet.has(tokenStem(token)));
}

function overlapScore(terms, normalizedText, tokenSet, stemSet, { phraseBonus = false } = {}) {
  const cleanTerms = [...new Set((terms || []).map(normalizeBearingText).filter(Boolean))];
  if (cleanTerms.length === 0) return 0;
  let matched = 0;
  let bonus = 0;
  for (const term of cleanTerms) {
    if (!termMatchesText(term, normalizedText, tokenSet, stemSet)) continue;
    matched += 1;
    if (phraseBonus && term.includes(" ") && normalizedText.includes(term)) bonus += 0.15;
  }
  return clamp01(matched / cleanTerms.length + Math.min(0.3, bonus));
}

function scopeAlignment(scopeTerms, normalizedText, tokenSet, stemSet) {
  if (!scopeTerms?.length) return 0.5;
  return overlapScore(scopeTerms, normalizedText, tokenSet, stemSet, { phraseBonus: true });
}

function attributionOrCausalAlignment(need, normalizedText, tokenSet, stemSet) {
  if (need.claimType === "attribution" || need.isAttribution) {
    const speaker = need.speakerEntity ? [need.speakerEntity] : [];
    const speakerScore = overlapScore(speaker, normalizedText, tokenSet, stemSet, { phraseBonus: true });
    const originLanguage = /\b(said|stated|claimed|transcript|speech|interview|testimony|statement|according to)\b/i.test(normalizedText) ? 1 : 0;
    return clamp01(0.7 * speakerScore + 0.3 * originLanguage);
  }
  if (need.claimType === "causal") {
    if (CAUSAL_RE.test(normalizedText)) return 1;
    if (ASSOCIATION_ONLY_RE.test(normalizedText)) return 0.3;
    return 0;
  }
  // This component is not applicable to ordinary factual claims. Returning a
  // neutral 0.5 here used to give every factual candidate free bearing weight
  // and made the component look like an observed signal in audit logs.
  return 0;
}

function deterministicCoverageConfidence({
  evidenceNeed,
  subject,
  relation,
  object,
  mustInclude,
  attributionOrCausal,
  targetFit,
}) {
  const attributionApplicable = evidenceNeed.claimType === "attribution" || evidenceNeed.isAttribution;
  const causalApplicable = evidenceNeed.claimType === "causal";
  const predicateObserved = Math.max(relation, object) >= 0.2;
  const typedSignalObserved = (attributionApplicable || causalApplicable) && attributionOrCausal > 0;
  const multiTermRequirementObserved = (evidenceNeed.mustIncludeTerms?.length || 0) >= 2 && mustInclude >= 0.9;
  const targetArtifactObserved = targetFit >= 0.65;

  if (predicateObserved || typedSignalObserved || multiTermRequirementObserved) return 1;
  if (targetArtifactObserved && subject >= 0.5) return 0.7;
  if (subject >= 0.5 || mustInclude > 0 || targetFit > 0) return 0.25;
  return 0;
}

function targetFitScore(evidenceTargets, normalizedText) {
  const targetTypes = [...new Set((evidenceTargets || []).map((target) => target.evidenceTargetType || "other"))];
  if (targetTypes.length === 0) return 0;
  let best = 0;
  for (const type of targetTypes) {
    const terms = EVIDENCE_ARTIFACTS[type] || EVIDENCE_ARTIFACTS.other;
    const matched = terms.filter((term) => normalizedText.includes(normalizeBearingText(term))).length;
    best = Math.max(best, matched > 0 ? Math.min(1, 0.65 + 0.15 * (matched - 1)) : 0);
  }
  return best;
}

/**
 * Pure Phase 1 scorer. It never mutates the evidence need or candidate and it
 * deliberately excludes publisher/domain authority from its inputs.
 */
export function scoreSnippetBearingDeterministic(evidenceNeed = {}, candidate = {}, options = {}) {
  const title = normalizeBearingText(candidate.title);
  const snippet = normalizeBearingText(candidate.bearingText || candidate.snippet);
  const normalizedText = `${title} ${snippet}`.trim();
  const minBearingToScrape = Number.isFinite(Number(options.minBearingToScrape))
    ? Number(options.minBearingToScrape)
    : DEFAULT_MIN_BEARING_TO_SCRAPE;

  const emptyComponents = {
    subject: 0,
    relation: 0,
    object: 0,
    scope: 0,
    mustInclude: 0,
    attributionOrCausal: 0,
    targetFit: 0,
    topicOnlyPenalty: 0,
    genericPagePenalty: 0,
    noClaimPenalty: 0,
  };

  if (!normalizedText) {
    return {
      score: 0,
      components: { ...emptyComponents, noClaimPenalty: 0.2 },
      wouldScrape: false,
      decision: "skip",
      reason: "No title or snippet text was available.",
      method: BEARING_SHADOW_METHOD,
      configVersion: BEARING_SHADOW_CONFIG_VERSION,
    };
  }

  const tokens = tokenizeBearingText(normalizedText);
  const tokenSet = new Set(tokens);
  const stemSet = new Set(tokens.map(tokenStem));
  const subject = overlapScore(evidenceNeed.subjectTerms, normalizedText, tokenSet, stemSet, { phraseBonus: true });
  const relation = overlapScore(evidenceNeed.relationTerms, normalizedText, tokenSet, stemSet);
  const object = overlapScore(evidenceNeed.objectTerms, normalizedText, tokenSet, stemSet, { phraseBonus: true });
  const scope = scopeAlignment(evidenceNeed.scopeTerms, normalizedText, tokenSet, stemSet);
  const mustInclude = overlapScore(evidenceNeed.mustIncludeTerms, normalizedText, tokenSet, stemSet, { phraseBonus: true });
  const attributionOrCausal = attributionOrCausalAlignment(evidenceNeed, normalizedText, tokenSet, stemSet);
  const targetFit = targetFitScore(evidenceNeed.evidenceTargets, normalizedText);
  const deterministicConfidence = deterministicCoverageConfidence({
    evidenceNeed,
    subject,
    relation,
    object,
    mustInclude,
    attributionOrCausal,
    targetFit,
  });

  // A genuine predicate-level bearing signal — beyond a bare topic match:
  //   - attributionOrCausal > 0.5: explicit attribution/causal language detected;
  //     ordinary factual claims use 0 because this component is not applicable
  //   - mustInclude >= 0.9 with either (a) some predicate/object present or
  //     (b) multiple mustInclude terms all matched (can't be a trivial single-keyword match)
  const mustIncludeTermCount = (evidenceNeed.mustIncludeTerms?.length ?? 0);
  const hasBearingSignal = (attributionOrCausal > 0.5)
    || (mustInclude >= 0.9 && (relation > 0 || object > 0))
    || (mustInclude >= 0.9 && mustIncludeTermCount >= 2);

  const topicOnlyPenalty = subject >= 0.5 && relation < 0.2 && object < 0.2 && !hasBearingSignal ? 0.3 : 0;
  const genericPagePenalty = GENERIC_PAGE_RE.test(normalizedText) && object < 0.35 ? 0.15 : 0;
  const noClaimPenalty = !SUBSTANTIVE_RE.test(normalizedText) && relation < 0.2 && !hasBearingSignal ? 0.2 : 0;
  // Soften the directness gate when bearing signals are present; strong attribution/must-include
  // compensates for relation/object not appearing verbatim in a short truncated snippet.
  const directnessGate = Math.max(relation, object) < 0.2 ? (hasBearingSignal ? 0.8 : 0.55) : 1;

  const weighted =
    0.20 * subject +
    0.25 * relation +
    0.25 * object +
    0.08 * scope +
    0.08 * mustInclude +
    0.07 * attributionOrCausal +
    0.07 * targetFit;
  const rawScore = round4(
    weighted * directnessGate - topicOnlyPenalty - genericPagePenalty - noClaimPenalty,
  );
  // Minimum floor applied only when hasBearingSignal is true — prevents genuine
  // attribution/entity matches from being zeroed by heavy penalties on short snippets.
  let score = rawScore;
  if (hasBearingSignal) {
    if (mustInclude >= 0.9 && attributionOrCausal > 0.5) {
      score = Math.max(score, 0.35);
    } else if (mustInclude >= 0.9 || (attributionOrCausal > 0.7 && subject >= 0.5)) {
      score = Math.max(score, 0.25);
    } else if (subject >= 0.5) {
      score = Math.max(score, 0.15);
    }
  }
  const components = {
    subject: round4(subject),
    relation: round4(relation),
    object: round4(object),
    scope: round4(scope),
    mustInclude: round4(mustInclude),
    attributionOrCausal: round4(attributionOrCausal),
    targetFit: round4(targetFit),
    topicOnlyPenalty,
    genericPagePenalty,
    noClaimPenalty,
  };
  const strongest = Object.entries({ subject, relation, object, scope, mustInclude, attributionOrCausal, targetFit })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name, value]) => `${name}=${round4(value)}`)
    .join(", ");
  const penalties = topicOnlyPenalty + genericPagePenalty + noClaimPenalty;

  const baseResult = {
    score,
    confidence: round4(deterministicConfidence),
    components,
    wouldScrape: score >= minBearingToScrape,
    decision: score >= minBearingToScrape ? "scrape" : score >= 0.15 ? "maybe" : "skip",
    reason: `Strongest components: ${strongest || "none"}; penalties=${round4(penalties)}${score > rawScore ? `; floor_applied: raw=${rawScore}` : ""}.`,
    method: BEARING_SHADOW_METHOD,
    configVersion: BEARING_SHADOW_CONFIG_VERSION,
  };
  // Target-aware classification (existing signals only): distinguishes direct
  // evidence, attribution-only, allegation repetition, verified documents, and
  // topic-only so downstream fallback does not reward repeated allegations as
  // proof or discard quiet verified documents.
  const classification = classifyDeterministicBearing(evidenceNeed, candidate, baseResult);
  return { ...baseResult, ...classification };
}

export function isBearingShadowEnabled(env = process.env) {
  if (env.ENABLE_BEARING_SHADOW === "false") return false;
  if (env.ENABLE_BEARING_SHADOW === "true") return true;
  return env.NODE_ENV !== "production";
}

export function isSnippetBearingLlmEnabled(env = process.env) {
  return env.ENABLE_SNIPPET_BEARING_LLM === "true";
}

export function addDeterministicBearingShadow(evidenceNeed, candidate, options = {}) {
  const result = scoreSnippetBearingDeterministic(evidenceNeed, candidate, options);
  return {
    ...candidate,
    canonicalUrl: canonicalizeUrl(candidate.url) || candidate.url || null,
    deterministicBearingScore: result.score,
    deterministicBearingConfidence: result.confidence,
    deterministicBearingComponents: result.components,
    bearingShadowDecision: result.decision,
    bearingShadowReason: result.reason,
    bearingShadowMethod: result.method,
    bearingShadowConfigVersion: result.configVersion,
    bearingShadowWouldScrape: result.wouldScrape,
    // Target-aware classification flags for role-aware fallback + audit.
    deterministicFallbackCategory: result.fallbackCategory,
    deterministicAllegationRepetition: result.allegationRepetition,
    deterministicAttributionOnly: result.attributionOnly,
    deterministicTopicOnly: result.topicOnly,
  };
}

/**
 * Enrich candidates without mutating, filtering, sorting, deduplicating, or
 * otherwise changing their order. Phase 1 instrumentation must remain a map.
 */
export function scoreCandidatesInBearingShadow(evidenceNeed, candidates, options = {}) {
  if (!Array.isArray(candidates)) return [];
  return candidates.map((candidate) =>
    addDeterministicBearingShadow(evidenceNeed, candidate, options),
  );
}

export function combineBearingPreScores(deterministicScore, llmScore, deterministicConfidence = 1) {
  const deterministic = nullableScore(deterministicScore) ?? 0;
  const llm = nullableScore(llmScore);
  if (llm === null) {
    return {
      bearingPreScore: deterministic,
      scorerDisagreement: null,
      method: BEARING_SHADOW_METHOD,
    };
  }
  const confidence = nullableScore(deterministicConfidence) ?? 0;
  // Missing lexical overlap is not proof of non-bearing. When deterministic
  // coverage is weak, preserve the semantic scorer instead of multiplying it
  // below the scrape threshold. A confident deterministic score may still
  // contribute up to 35%, but it is never an implicit veto.
  const deterministicWeight = 0.35 * confidence;
  const llmWeight = 1 - deterministicWeight;
  const weighted_avg = round4(llmWeight * llm + deterministicWeight * deterministic);
  return {
    bearingPreScore: round4(Math.max(deterministic, weighted_avg)),
    scorerDisagreement: round4(Math.abs(llm - deterministic)),
    method: "combined_pre_bearing_confidence_v2",
  };
}

function buildSnippetCandidatePayload(candidates, maxCandidates) {
  return candidates.slice(0, maxCandidates).map((candidate, index) => ({
    candidateKey: `c${index}`,
    url: bounded(candidate.url, 2048),
    title: bounded(candidate.title, 300),
    snippet: bounded(candidate.bearingText || candidate.snippet, 600),
    searchSnippet: bounded(candidate.searchSnippet ?? candidate.snippet, 600),
    bearingTextSource: candidate.bearingTextSource || "search_snippet",
    domain: bounded(candidate.domain, 255),
    provider: candidate.provider || candidate.source || "unknown",
    providerRank: candidate.providerRank ?? null,
    query: bounded(candidate.query, 300),
    searchIntent: candidate.searchIntent || null,
    stanceGoal: candidate.stanceGoal || null,
    evidenceTargetType: candidate.evidenceTargetType || null,
    deterministicBearingScore: candidate.deterministicBearingScore ?? null,
    deterministicComponents: candidate.deterministicBearingComponents || null,
  }));
}

/**
 * Validate a model response without trusting its order. A known candidateKey
 * and matching URL are both required; malformed/missing items fall back alone.
 */
export function validateSnippetBearingBatchResult(response, candidatePayload) {
  const rawResults = Array.isArray(response?.results) ? response.results : [];
  const payloadByKey = new Map(candidatePayload.map((candidate) => [candidate.candidateKey, candidate]));
  const validatedByKey = new Map();
  const errors = [];

  for (const raw of rawResults) {
    const key = String(raw?.candidateKey || "").trim();
    const expected = payloadByKey.get(key);
    if (!expected) {
      errors.push(`unknown_candidate_key:${key || "missing"}`);
      continue;
    }
    if (validatedByKey.has(key)) {
      errors.push(`duplicate_candidate_key:${key}`);
      continue;
    }
    const expectedUrl = canonicalizeUrl(expected.url) || expected.url;
    const returnedUrl = canonicalizeUrl(raw?.url) || String(raw?.url || "");
    if (!returnedUrl || returnedUrl !== expectedUrl) {
      errors.push(`url_mismatch:${key}`);
      continue;
    }
    const llmScore = nullableScore(raw?.bearingPreScore);
    if (llmScore === null) {
      errors.push(`invalid_score:${key}`);
      continue;
    }
    validatedByKey.set(key, {
      llmBearingPreScore: llmScore,
      expectedStance: normalizedEnum(raw?.expectedStance, EXPECTED_STANCES, "insufficient"),
      bearingType: normalizedEnum(raw?.bearingType, PRE_BEARING_TYPES, "none"),
      claimComponentAddressed: normalizedEnum(raw?.claimComponentAddressed, ADDRESSED_COMPONENTS, "none"),
      triageDecision: normalizedEnum(raw?.triageDecision, TRIAGE_DECISIONS, "maybe"),
      triageReason: bounded(raw?.reason, 500),
    });
  }

  return { validatedByKey, errors };
}

// Role-aware deterministic fallback used when the LLM bearing did not complete
// for a candidate. It (1) preserves verified documents with a role-appropriate
// floor even when their snippet is thin, and (2) prevents repeated allegations
// from non-independent sources from earning high substantive bearing.
function fallbackLlmCandidate(candidate, error = null) {
  const combined = combineBearingPreScores(
    candidate.deterministicBearingScore,
    null,
    candidate.deterministicBearingConfidence,
  );

  const role = deriveVerifiedDocumentRole(candidate);
  const verifiedFallback = role?.verified ? VERIFIED_FALLBACK_BY_ROLE[role.role] : null;
  const allegationRepetition = Boolean(candidate.deterministicAllegationRepetition);
  const category = candidate.deterministicFallbackCategory || "topic_only";
  const det = Number(candidate.deterministicBearingScore) || 0;

  let bearingPreScore = combined.bearingPreScore;
  let expectedStance = "insufficient";
  let bearingType = "none";
  let claimComponentAddressed = "none";
  let fallbackReason = category;

  if (verifiedFallback) {
    // (D/E) Verified documents are never scored as irrelevant on a thin snippet.
    bearingPreScore = Math.max(bearingPreScore, verifiedFallback.floor);
    bearingType = verifiedFallback.bearingType;
    expectedStance = verifiedFallback.expectedStance;
    claimComponentAddressed = verifiedFallback.component;
    fallbackReason = `verified_document_floor:${role.role}`;
  } else if (category === "allegation_repetition" || allegationRepetition) {
    // (C/D) A repeated allegation from a named amplifier addresses at most
    // attribution/context — never the substantive misconduct as proof.
    bearingPreScore = Math.min(bearingPreScore, 0.2);
    bearingType = "context";
    expectedStance = "background";
    claimComponentAddressed = "attribution";
    fallbackReason = "allegation_repetition_non_independent";
  } else if (category === "attribution_only") {
    // Attribution/primary-statement evidence bears on WHO said it, never as
    // substantive proof of the misconduct.
    bearingType = "indirect";
    expectedStance = det >= 0.35 ? "support" : "background";
    claimComponentAddressed = "attribution";
    fallbackReason = "attribution_only";
  } else if (category === "background_causal") {
    bearingType = "context";
    expectedStance = "background";
    claimComponentAddressed = "object";
    fallbackReason = "background_causal";
  } else if (category === "direct" && det >= 0.15) {
    bearingType = det >= 0.35 ? "direct" : "indirect";
    expectedStance = det >= 0.35 ? "support" : "insufficient";
    claimComponentAddressed = det >= 0.35 ? "relation" : "none";
    fallbackReason = "direct";
  } else if (det >= 0.15) {
    // Preserve whatever the deterministic scorer found for ordinary candidates.
    expectedStance = det >= 0.35 ? "support" : "insufficient";
    bearingType = det >= 0.35 ? "indirect" : "none";
    claimComponentAddressed = det >= 0.35 ? "relation" : "none";
    fallbackReason = category === "topic_only" ? "topic_only" : "deterministic_only";
  }

  return {
    ...candidate,
    llmBearingPreScore: null,
    bearingPreScore,
    scorerDisagreement: null,
    expectedStance,
    bearingType,
    claimComponentAddressed,
    triageDecision: bearingPreScore >= DEFAULT_MIN_BEARING_TO_SCRAPE ? "scrape" : candidate.bearingShadowDecision || "maybe",
    triageReason: error ? bounded(`LLM fallback: ${error}`, 500) : candidate.bearingShadowReason || "Deterministic fallback.",
    bearingPreMethod: verifiedFallback ? "deterministic_verified_floor" : combined.method,
    fallbackUsed: true,
    fallbackReason,
    verifiedDocumentRole: role?.role || null,
    deterministicAllegationRepetition: allegationRepetition,
    deterministicAttributionOnly: Boolean(candidate.deterministicAttributionOnly),
  };
}

function logSnippetBearingLlmBatch({ taskContentId, claim, candidates, errors, elapsedMs, failed }) {
  const loggedCandidates = candidates.slice(0, DEFAULT_MAX_SNIPPET_CANDIDATES);
  const record = {
    event: "snippet_bearing_llm_shadow",
    taskContentId: taskContentId ?? null,
    claimId: claim?.id ?? null,
    claimText: bounded(claim?.text, 500),
    candidateCount: candidates.length,
    omittedResultCount: Math.max(0, candidates.length - loggedCandidates.length),
    failed: Boolean(failed),
    errors: (errors || []).slice(0, 20).map((error) => bounded(error, 300)),
    elapsedMs,
    method: SNIPPET_BEARING_LLM_METHOD,
    promptVersion: SNIPPET_BEARING_PROMPT_VERSION,
    results: loggedCandidates.map((candidate) => ({
      url: bounded(candidate.url, 1000),
      deterministicScore: candidate.deterministicBearingScore ?? null,
      llmScore: candidate.llmBearingPreScore ?? null,
      combinedScore: candidate.bearingPreScore ?? null,
      disagreement: candidate.scorerDisagreement ?? null,
      expectedStance: candidate.expectedStance || null,
      bearingType: candidate.bearingType || null,
      component: candidate.claimComponentAddressed || null,
      decision: candidate.triageDecision || null,
      reason: bounded(candidate.triageReason, 500),
    })),
  };
  logger.log(`[BEARING_LLM_SHADOW] ${JSON.stringify(record)}`);
  return record;
}

function candidateUrlKey(candidate) {
  return canonicalizeUrl(candidate?.url) || candidate?.url || candidate?.id || "";
}

// Turn one validated LLM assessment + its candidate into an enriched candidate.
function enrichWithAssessment(candidate, assessment, claim) {
  const quantitativeGuard = applyQuantitativeStanceGuard({
    taskClaimText: claim?.text,
    evidenceText: `${candidate.title || ""} ${candidate.bearingText || candidate.snippet || ""}`,
    proposedStance: assessment.expectedStance,
  });
  const guardedAssessment = quantitativeGuard
    ? {
        ...assessment,
        expectedStance: quantitativeGuard.stance,
        ...(quantitativeGuard.stance === "insufficient" ? {
          llmBearingPreScore: Math.min(assessment.llmBearingPreScore, 0.2),
          bearingType: "context",
          claimComponentAddressed: "scope",
          triageDecision: "maybe",
        } : {}),
        triageReason: bounded(`${quantitativeGuard.reason} ${assessment.triageReason || ""}`, 500),
      }
    : assessment;
  const combined = combineBearingPreScores(
    candidate.deterministicBearingScore,
    guardedAssessment.llmBearingPreScore,
    candidate.deterministicBearingConfidence,
  );
  return {
    ...candidate,
    ...guardedAssessment,
    quantitativeGuard: quantitativeGuard || null,
    llmBearingScore: guardedAssessment.llmBearingPreScore ?? null,
    bearingPreScore: combined.bearingPreScore,
    scorerDisagreement: combined.scorerDisagreement,
    bearingPreMethod: combined.method,
    fallbackUsed: false,
    fallbackReason: null,
  };
}

// Run ONE LLM sub-batch. Returns a Map(urlKey -> enriched) for candidates the
// LLM successfully assessed. Throws on LLM failure/timeout so the caller can
// split-and-retry.
async function callSnippetBearingSubBatch({ subCandidates, claim, evidenceNeed, llm, system, userTemplate, timeout }) {
  const payload = buildSnippetCandidatePayload(subCandidates, subCandidates.length);
  const user = fillPromptTemplate(userTemplate, {
    claimJson: JSON.stringify({
      claimId: claim?.id ?? null,
      claimText: bounded(claim?.text, 1000),
      originalText: bounded(claim?.originalText, 1000),
    }),
    evidenceNeedJson: JSON.stringify(evidenceNeed || {}),
    candidatesJson: JSON.stringify(payload),
  });
  const schemaHint = `{"results":[{"candidateKey":"c0","url":"https://...","bearingPreScore":0.0,"expectedStance":"support|refute|nuance|background|insufficient","bearingType":"direct|indirect|context|origin|steelman|none","claimComponentAddressed":"whole_claim|subject|relation|object|scope|attribution|warrant|none","triageDecision":"scrape|maybe|skip","reason":"short explanation"}]}`;
  const startedAt = Date.now();
  const response = await llm.generate({ system, user, schemaHint, temperature: 0, maxRetries: 1, timeout });
  const { validatedByKey, errors } = validateSnippetBearingBatchResult(response, payload);
  const keyByIndex = new Map(payload.map((item, index) => [index, item.candidateKey]));
  const resultByUrl = new Map();
  subCandidates.forEach((candidate, index) => {
    const assessment = validatedByKey.get(keyByIndex.get(index));
    if (assessment) resultByUrl.set(candidateUrlKey(candidate), enrichWithAssessment(candidate, assessment, claim));
  });
  return { resultByUrl, errors, elapsedMs: Date.now() - startedAt };
}

/**
 * Assess snippet bearing for a claim, resilient to LLM timeouts:
 *  - candidates are split into per-TARGET sub-batches (A), each small, so a slow
 *    call is less likely to time out and a failure is contained to one target;
 *  - sub-batches run with Promise.allSettled — completed results are always
 *    preserved (C); one target's failure never collapses the whole claim (B);
 *  - a timed-out sub-batch is HALVED and retried once before its candidates fall
 *    back (B), and the fallback is role-aware (D/E).
 * The per-claim LLM budget stays bounded by maxCandidates, so target-splitting
 * does not increase cost.
 */
export async function assessSnippetBearingBatch({
  claim,
  evidenceNeed,
  candidates,
  llm,
  promptManager = null,
  taskContentId = null,
  maxCandidates = DEFAULT_MAX_SNIPPET_CANDIDATES,
  maxCandidatesPerTargetBatch = DEFAULT_MAX_CANDIDATES_PER_TARGET_BATCH,
  subBatchTimeoutMs = 15000,
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { candidates: [], attempted: false, errors: [] };
  }

  const finalize = (finalCandidates, { errors = [], attempted, failed }) => {
    logSnippetBearingLlmBatch({ taskContentId, claim, candidates: finalCandidates, errors, elapsedMs: 0, failed });
    logSnippetBearingResults({ taskContentId, claim, candidates: finalCandidates });
    return { candidates: finalCandidates, attempted, errors };
  };

  if (!llm || typeof llm.generate !== "function") {
    const fallbackCandidates = candidates.map((candidate) => fallbackLlmCandidate(candidate, "LLM unavailable"));
    return finalize(fallbackCandidates, { errors: ["llm_unavailable"], attempted: false, failed: true });
  }

  // Per-claim LLM budget. Candidates are already ordered by the survival layer;
  // only the first `safeMax` enter the LLM, the rest fall back.
  const safeMax = Math.max(1, Math.min(DEFAULT_MAX_SNIPPET_CANDIDATES, Number(maxCandidates) || DEFAULT_MAX_SNIPPET_CANDIDATES));
  const llmCandidates = candidates.slice(0, safeMax);
  const overflowCandidates = candidates.slice(safeMax);
  const perTargetBatch = Math.max(1, Number(maxCandidatesPerTargetBatch) || DEFAULT_MAX_CANDIDATES_PER_TARGET_BATCH);

  // Load prompts once.
  let system = SNIPPET_BEARING_FALLBACK_SYSTEM;
  let userTemplate = SNIPPET_BEARING_FALLBACK_USER;
  const promptErrors = [];
  if (promptManager) {
    try {
      const systemPrompt = await promptManager.getPrompt("snippet_bearing_assessment_system", { system: SNIPPET_BEARING_FALLBACK_SYSTEM, user: "", parameters: {} });
      const userPrompt = await promptManager.getPrompt("snippet_bearing_assessment_user", { system: "", user: SNIPPET_BEARING_FALLBACK_USER, parameters: {} });
      system = systemPrompt.system || SNIPPET_BEARING_FALLBACK_SYSTEM;
      userTemplate = userPrompt.user || SNIPPET_BEARING_FALLBACK_USER;
    } catch (error) {
      promptErrors.push(`prompt_fallback:${error.message}`);
    }
  }

  // Group by target (A), then chunk each target group into sub-batches.
  const groups = new Map();
  for (const candidate of llmCandidates) {
    const targetKey = String(candidate.evidenceTargetId ?? candidate.evidenceTargetType ?? "_claim");
    if (!groups.has(targetKey)) groups.set(targetKey, []);
    groups.get(targetKey).push(candidate);
  }
  const subBatches = [];
  for (const [targetKey, group] of groups) {
    for (let i = 0; i < group.length; i += perTargetBatch) {
      subBatches.push({ targetKey, items: group.slice(i, i + perTargetBatch) });
    }
  }

  const ctx = { claim, evidenceNeed, llm, system, userTemplate, timeout: subBatchTimeoutMs };
  const errors = [...promptErrors];

  // Run every sub-batch; a rejection in one never rejects the others (B).
  const settled = await Promise.allSettled(subBatches.map(async (batch) => {
    const startedAt = Date.now();
    try {
      const { resultByUrl, errors: subErrors } = await callSnippetBearingSubBatch({ subCandidates: batch.items, ...ctx });
      return { resultByUrl, errors: subErrors };
    } catch (error) {
      // Log the exact failed batch (B) and split-and-retry once.
      logger.warn(`[SNIPPET_BEARING_BATCH_TIMEOUT] ${JSON.stringify({
        event: "snippet_bearing_batch_timeout",
        taskContentId,
        claimId: claim?.id ?? null,
        targetKey: batch.targetKey,
        batchSize: batch.items.length,
        candidateUrls: batch.items.map((c) => bounded(c.url, 200)),
        elapsedMs: Date.now() - startedAt,
        error: bounded(error.message, 300),
      })}`);
      const merged = new Map();
      const retryErrors = [`batch_timeout:${batch.targetKey}:${bounded(error.message, 120)}`];
      if (batch.items.length > 1) {
        const mid = Math.ceil(batch.items.length / 2);
        for (const half of [batch.items.slice(0, mid), batch.items.slice(mid)]) {
          try {
            const { resultByUrl } = await callSnippetBearingSubBatch({ subCandidates: half, ...ctx });
            for (const [k, v] of resultByUrl) merged.set(k, v);
          } catch (retryError) {
            retryErrors.push(`retry_failed:${bounded(retryError.message, 120)}`);
          }
        }
      }
      return { resultByUrl: merged, errors: retryErrors };
    }
  }));

  const assessedByUrl = new Map();
  for (const outcome of settled) {
    if (outcome.status !== "fulfilled") continue;
    for (const [k, v] of outcome.value.resultByUrl) assessedByUrl.set(k, v);
    errors.push(...(outcome.value.errors || []));
  }

  // Rebuild the full candidate list in original order (C): LLM result where it
  // completed, role-aware deterministic fallback otherwise.
  const finalCandidates = candidates.map((candidate) => {
    if (overflowCandidates.includes(candidate)) return fallbackLlmCandidate(candidate, "outside per-claim LLM budget");
    const assessed = assessedByUrl.get(candidateUrlKey(candidate));
    return assessed || fallbackLlmCandidate(candidate, "llm_bearing_incomplete");
  });

  const anyFailed = errors.some((error) => /timeout|retry_failed|fallback/i.test(String(error)));
  return finalize(finalCandidates, { errors, attempted: true, failed: anyFailed });
}

// Per-candidate bearing result audit (F).
function logSnippetBearingResults({ taskContentId, claim, candidates }) {
  const results = candidates.slice(0, DEFAULT_MAX_SNIPPET_CANDIDATES).map((candidate) => ({
    candidateId: bounded(candidateUrlKey(candidate), 500),
    claimId: claim?.id ?? null,
    targetId: candidate.evidenceTargetId ?? null,
    targetType: candidate.evidenceTargetType || null,
    verifiedDocumentRole: candidate.verifiedDocumentRole || (deriveVerifiedDocumentRole(candidate)?.role ?? null),
    deterministicBearingScore: candidate.deterministicBearingScore ?? null,
    llmBearingScore: candidate.llmBearingScore ?? candidate.llmBearingPreScore ?? null,
    finalBearingScore: candidate.bearingPreScore ?? null,
    finalBearingLabel: candidate.expectedStance || null,
    fallbackUsed: Boolean(candidate.fallbackUsed),
    fallbackReason: candidate.fallbackReason || null,
    attributionOnly: Boolean(candidate.deterministicAttributionOnly),
    allegationRepetition: Boolean(candidate.deterministicAllegationRepetition),
    topicOnly: Boolean(candidate.deterministicTopicOnly),
    bearingMethod: candidate.bearingPreMethod || null,
  }));
  logger.log(`[SNIPPET_BEARING_RESULT] ${JSON.stringify({
    event: "snippet_bearing_result",
    taskContentId: taskContentId ?? null,
    claimId: claim?.id ?? null,
    resultCount: results.length,
    results,
  })}`);
}

export function buildSnippetBearingCalibrationRecords({
  taskContentId = null,
  claim,
  candidates,
  evidence,
  selectedCandidateCount = 0,
  selectedCanonicalUrls = null,
}) {
  const postScoresByUrl = new Map();
  for (const item of evidence || []) {
    const key = canonicalizeUrl(item?.url) || item?.url;
    if (!key || !Number.isFinite(item?.bearingScore)) continue;
    postScoresByUrl.set(key, Math.max(postScoresByUrl.get(key) ?? 0, item.bearingScore));
  }
  const selectedUrlSet = Array.isArray(selectedCanonicalUrls)
    ? new Set(selectedCanonicalUrls.map((url) => canonicalizeUrl(url) || url))
    : null;
  return (candidates || []).map((candidate, index) => {
    const key = canonicalizeUrl(candidate?.url) || candidate?.url;
    const postScore = postScoresByUrl.has(key) ? postScoresByUrl.get(key) : null;
    return {
      event: "snippet_bearing_calibration",
      taskContentId,
      claimId: claim?.id ?? null,
      url: bounded(candidate?.url, 2048),
      deterministicScore: candidate?.deterministicBearingScore ?? null,
      llmPreScore: candidate?.llmBearingPreScore ?? null,
      combinedPreScore: candidate?.bearingPreScore ?? null,
      postScrapeScore: postScore,
      delta: Number.isFinite(postScore) && Number.isFinite(candidate?.bearingPreScore)
        ? round4(Math.abs(postScore - candidate.bearingPreScore))
        : null,
      actuallyScraped: selectedUrlSet ? selectedUrlSet.has(key) : index < selectedCandidateCount,
      method: candidate?.bearingPreMethod || null,
    };
  });
}

export function logSnippetBearingCalibration(input) {
  const records = buildSnippetBearingCalibrationRecords(input);
  const loggedRecords = records.slice(0, DEFAULT_MAX_SNIPPET_CANDIDATES);
  logger.log(`[BEARING_CALIBRATION] ${JSON.stringify({
    event: "snippet_bearing_calibration_batch",
    taskContentId: input?.taskContentId ?? null,
    claimId: input?.claim?.id ?? null,
    recordCount: records.length,
    omittedResultCount: Math.max(0, records.length - loggedRecords.length),
    results: loggedRecords,
  })}`);
  return records;
}

export function buildBearingShadowLogRecord({ taskContentId = null, claim, candidate, actualSelected }) {
  return {
    event: "snippet_bearing_shadow",
    taskContentId,
    claimId: claim?.id ?? null,
    claimText: bounded(claim?.text, 500),
    evidenceNeedVersion: claim?.evidenceNeed?.version ?? null,
    evidenceNeedMethod: claim?.evidenceNeed?.derivation?.method ?? null,
    url: bounded(candidate?.url, 2048),
    canonicalUrl: bounded(candidate?.canonicalUrl, 2048),
    title: bounded(candidate?.title, 500),
    snippet: bounded(candidate?.snippet, 1000),
    searchSnippet: bounded(candidate?.searchSnippet ?? candidate?.snippet, 1000),
    bearingText: bounded(candidate?.bearingText ?? candidate?.snippet, 1000),
    bearingTextSource: candidate?.bearingTextSource || "search_snippet",
    academicDiscoveryRoute: candidate?.academicDiscoveryRoute || null,
    discoveryRoutes: candidate?.discoveryRoutes || [],
    snippetVariants: (candidate?.snippetVariants || []).slice(0, 4).map((variant) => ({
      provider: variant.provider,
      rank: variant.rank,
      snippet: bounded(variant.snippet, 400),
    })),
    provider: candidate?.provider || candidate?.source || "unknown",
    providerRank: candidate?.providerRank ?? null,
    providerScore: candidate?.providerScore ?? candidate?.score ?? null,
    query: bounded(candidate?.query, 500),
    searchIntent: candidate?.searchIntent || null,
    matchedPart: candidate?.matchedPart || null,
    evidenceTargetType: candidate?.evidenceTargetType || null,
    stanceGoal: candidate?.stanceGoal || null,
    deterministicBearingScore: candidate?.deterministicBearingScore ?? null,
    deterministicBearingConfidence: candidate?.deterministicBearingConfidence ?? null,
    components: candidate?.deterministicBearingComponents || null,
    decision: candidate?.bearingShadowDecision || null,
    reason: bounded(candidate?.bearingShadowReason, 500),
    wouldScrape: Boolean(candidate?.bearingShadowWouldScrape),
    actualSelected: Boolean(actualSelected),
    llmBearingPreScore: candidate?.llmBearingPreScore ?? null,
    combinedBearingPreScore: candidate?.bearingPreScore ?? null,
    scorerDisagreement: candidate?.scorerDisagreement ?? null,
    method: candidate?.bearingShadowMethod || BEARING_SHADOW_METHOD,
    configVersion: candidate?.bearingShadowConfigVersion || BEARING_SHADOW_CONFIG_VERSION,
  };
}

export function logBearingShadowEvent(input) {
  const record = buildBearingShadowLogRecord(input);
  logger.log(`[BEARING_SHADOW] ${JSON.stringify(record)}`);
  return record;
}
