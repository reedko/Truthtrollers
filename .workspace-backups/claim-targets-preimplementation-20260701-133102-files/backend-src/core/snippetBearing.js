import logger from "../utils/logger.js";
import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { applyQuantitativeStanceGuard } from "./quantitativeClaimGuard.js";
import { normalizeBearingText, tokenizeBearingText } from "./evidenceNeed.js";

export const BEARING_SHADOW_METHOD = "deterministic_v1";
export const BEARING_SHADOW_CONFIG_VERSION = 1;
export const DEFAULT_MIN_BEARING_TO_SCRAPE = 0.35;
export const SNIPPET_BEARING_LLM_METHOD = "snippet_bearing_llm_v1";
export const SNIPPET_BEARING_PROMPT_VERSION = 1;
export const DEFAULT_MAX_SNIPPET_CANDIDATES = 12;

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
  return 0.5;
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
  const snippet = normalizeBearingText(candidate.snippet);
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

  const topicOnlyPenalty = subject >= 0.5 && relation < 0.2 && object < 0.2 ? 0.3 : 0;
  const genericPagePenalty = GENERIC_PAGE_RE.test(normalizedText) && object < 0.35 ? 0.15 : 0;
  const noClaimPenalty = !SUBSTANTIVE_RE.test(normalizedText) && relation < 0.2 ? 0.2 : 0;
  const directnessGate = Math.max(relation, object) < 0.2 ? 0.55 : 1;

  const weighted =
    0.20 * subject +
    0.25 * relation +
    0.25 * object +
    0.08 * scope +
    0.08 * mustInclude +
    0.07 * attributionOrCausal +
    0.07 * targetFit;
  const score = round4(
    weighted * directnessGate - topicOnlyPenalty - genericPagePenalty - noClaimPenalty,
  );
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

  return {
    score,
    components,
    wouldScrape: score >= minBearingToScrape,
    decision: score >= minBearingToScrape ? "scrape" : score >= 0.15 ? "maybe" : "skip",
    reason: `Strongest components: ${strongest || "none"}; penalties=${round4(penalties)}.`,
    method: BEARING_SHADOW_METHOD,
    configVersion: BEARING_SHADOW_CONFIG_VERSION,
  };
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
    deterministicBearingComponents: result.components,
    bearingShadowDecision: result.decision,
    bearingShadowReason: result.reason,
    bearingShadowMethod: result.method,
    bearingShadowConfigVersion: result.configVersion,
    bearingShadowWouldScrape: result.wouldScrape,
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

export function combineBearingPreScores(deterministicScore, llmScore) {
  const deterministic = nullableScore(deterministicScore) ?? 0;
  const llm = nullableScore(llmScore);
  if (llm === null) {
    return {
      bearingPreScore: deterministic,
      scorerDisagreement: null,
      method: BEARING_SHADOW_METHOD,
    };
  }
  return {
    bearingPreScore: round4(0.75 * llm + 0.25 * deterministic),
    scorerDisagreement: round4(Math.abs(llm - deterministic)),
    method: "combined_pre_bearing_v1",
  };
}

function buildSnippetCandidatePayload(candidates, maxCandidates) {
  return candidates.slice(0, maxCandidates).map((candidate, index) => ({
    candidateKey: `c${index}`,
    url: bounded(candidate.url, 2048),
    title: bounded(candidate.title, 300),
    snippet: bounded(candidate.snippet, 600),
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

function fallbackLlmCandidate(candidate, error = null) {
  const combined = combineBearingPreScores(candidate.deterministicBearingScore, null);
  return {
    ...candidate,
    llmBearingPreScore: null,
    bearingPreScore: combined.bearingPreScore,
    scorerDisagreement: null,
    expectedStance: "insufficient",
    bearingType: "none",
    claimComponentAddressed: "none",
    triageDecision: candidate.bearingShadowDecision || "maybe",
    triageReason: error ? bounded(`LLM fallback: ${error}`, 500) : candidate.bearingShadowReason || "Deterministic fallback.",
    bearingPreMethod: combined.method,
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

/**
 * Score up to one compact batch per claim. The returned candidates are always
 * produced with map(), preserving count and order. No result is gated here.
 */
export async function assessSnippetBearingBatch({
  claim,
  evidenceNeed,
  candidates,
  llm,
  promptManager = null,
  taskContentId = null,
  maxCandidates = DEFAULT_MAX_SNIPPET_CANDIDATES,
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { candidates: [], attempted: false, errors: [] };
  }

  const safeMax = Math.max(1, Math.min(DEFAULT_MAX_SNIPPET_CANDIDATES, Number(maxCandidates) || DEFAULT_MAX_SNIPPET_CANDIDATES));
  const payload = buildSnippetCandidatePayload(candidates, safeMax);
  if (!llm || typeof llm.generate !== "function") {
    const fallbackCandidates = candidates.map((candidate) => fallbackLlmCandidate(candidate, "LLM unavailable"));
    logSnippetBearingLlmBatch({ taskContentId, claim, candidates: fallbackCandidates, errors: ["llm_unavailable"], elapsedMs: 0, failed: true });
    return { candidates: fallbackCandidates, attempted: false, errors: ["llm_unavailable"] };
  }

  let system = SNIPPET_BEARING_FALLBACK_SYSTEM;
  let userTemplate = SNIPPET_BEARING_FALLBACK_USER;
  const promptErrors = [];
  if (promptManager) {
    try {
      const systemPrompt = await promptManager.getPrompt("snippet_bearing_assessment_system", {
        system: SNIPPET_BEARING_FALLBACK_SYSTEM,
        user: "",
        parameters: {},
      });
      const userPrompt = await promptManager.getPrompt("snippet_bearing_assessment_user", {
        system: "",
        user: SNIPPET_BEARING_FALLBACK_USER,
        parameters: {},
      });
      system = systemPrompt.system || SNIPPET_BEARING_FALLBACK_SYSTEM;
      userTemplate = userPrompt.user || SNIPPET_BEARING_FALLBACK_USER;
    } catch (error) {
      promptErrors.push(`prompt_fallback:${error.message}`);
    }
  }

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

  try {
    const response = await llm.generate({
      system,
      user,
      schemaHint,
      temperature: 0,
      maxRetries: 1,
      timeout: 15000,
    });
    const { validatedByKey, errors: validationErrors } = validateSnippetBearingBatchResult(response, payload);
    const payloadKeyByIndex = new Map(payload.map((item, index) => [index, item.candidateKey]));
    const enriched = candidates.map((candidate, index) => {
      const key = payloadKeyByIndex.get(index);
      if (!key) return fallbackLlmCandidate(candidate, "outside batch cap");
      const assessment = validatedByKey.get(key);
      if (!assessment) return fallbackLlmCandidate(candidate, `missing or invalid ${key}`);
      const quantitativeGuard = applyQuantitativeStanceGuard({
        taskClaimText: claim?.text,
        evidenceText: `${candidate.title || ""} ${candidate.snippet || ""}`,
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
      const combined = combineBearingPreScores(candidate.deterministicBearingScore, guardedAssessment.llmBearingPreScore);
      return {
        ...candidate,
        ...guardedAssessment,
        quantitativeGuard: quantitativeGuard || null,
        bearingPreScore: combined.bearingPreScore,
        scorerDisagreement: combined.scorerDisagreement,
        bearingPreMethod: combined.method,
      };
    });
    const errors = [...promptErrors, ...validationErrors];
    logSnippetBearingLlmBatch({
      taskContentId,
      claim,
      candidates: enriched,
      errors,
      elapsedMs: Date.now() - startedAt,
      failed: false,
    });
    return { candidates: enriched, attempted: true, errors };
  } catch (error) {
    const errors = [...promptErrors, bounded(error.message, 300)];
    const fallbackCandidates = candidates.map((candidate) => fallbackLlmCandidate(candidate, error.message));
    logSnippetBearingLlmBatch({
      taskContentId,
      claim,
      candidates: fallbackCandidates,
      errors,
      elapsedMs: Date.now() - startedAt,
      failed: true,
    });
    return { candidates: fallbackCandidates, attempted: true, errors };
  }
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
    provider: candidate?.provider || candidate?.source || "unknown",
    providerRank: candidate?.providerRank ?? null,
    providerScore: candidate?.providerScore ?? candidate?.score ?? null,
    query: bounded(candidate?.query, 500),
    searchIntent: candidate?.searchIntent || null,
    matchedPart: candidate?.matchedPart || null,
    evidenceTargetType: candidate?.evidenceTargetType || null,
    stanceGoal: candidate?.stanceGoal || null,
    deterministicBearingScore: candidate?.deterministicBearingScore ?? null,
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
