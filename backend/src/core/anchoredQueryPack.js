import { tokenizeBearingText } from "./evidenceNeed.js";
import { retrievalContextForTarget } from "./retrievalContext.js";
import {
  DEFAULT_PURPOSE_LANE,
  NEUTRAL_INTENT,
  NEUTRAL_STANCE_GOAL,
  isGlueQuery,
  isInstructionLikeQuery,
  lanesForTargetType,
  normalizePurposeLane,
  providerProfileForLane,
} from "./evidencePurposeLanes.js";

const GENERIC_SUFFIX_RE = /\b(?:primary source corroboration|official records evidence|independent confirmation|fact check contrary evidence|official denial records|methodology criticism false|context and limitations|methodology analysis|primary source chronology)\b/i;
const WORK_REFERENCE_RE = /\b(?:the|this|that|their)?\s*(?:study|data|report|analysis|paper|protocol|results|evidence)\b/i;

const clean = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const unique = (values, limit = 30) => [...new Set((values || []).map((value) => clean(value)).filter(Boolean))].slice(0, limit);

function containsPhrase(query, phrase) {
  return clean(query).toLowerCase().includes(clean(phrase).toLowerCase());
}

function resolvedAnchors(context) {
  return (context?.resolvedWorks || []).flatMap((work) => [work.title, work.identifier, work.authors]).filter(Boolean);
}

export function validateAnchoredQuery(query, context = {}, targetType = "substantive") {
  const text = clean(query);
  const tokens = tokenizeBearingText(text);
  const reasons = [];
  if (tokens.length < 3) reasons.push("query_too_short");

  // Purpose-based rejections (never stance-based).
  if (isInstructionLikeQuery(text)) reasons.push("instruction_like_query");
  if (isGlueQuery(text)) reasons.push("glue_query");
  // Verbatim claim restatement retrieves the source article and its echoes; it
  // is not an evidentiary query.
  const claimText = clean(context.objectClaimText || context.targetText || "").toLowerCase();
  if (claimText && text.toLowerCase() === claimText) reasons.push("verbatim_claim_restatement");

  const people = context.speakerEntities || [];
  const organizations = context.organizations || [];
  const anchors = unique([
    ...(context.requiredAnchors || []),
    ...organizations,
    ...resolvedAnchors(context),
    ...(context.dates || []),
    ...(context.populations || []),
  ], 40);
  const matchedAnchors = anchors.filter((anchor) => containsPhrase(text, anchor));
  const namesPerson = people.some((person) => containsPhrase(text, person));
  if (namesPerson) {
    const personTokens = new Set(people.flatMap(tokenizeBearingText));
    const disambiguatingTokens = tokens.filter((token) => !personTokens.has(token));
    const hasOrgOrTopic = organizations.some((organization) => containsPhrase(text, organization)) ||
      matchedAnchors.some((anchor) => !people.includes(anchor));
    if (disambiguatingTokens.length < 2 || !hasOrgOrTopic) reasons.push("named_person_without_disambiguating_context");
  }
  if (GENERIC_SUFFIX_RE.test(text) && matchedAnchors.length < 2) reasons.push("generic_suffix_without_identity");
  if (context.studyResolutionRequired && ["substantive", "study_identity"].includes(targetType)) {
    if (matchedAnchors.length < 2 && resolvedAnchors(context).every((anchor) => !containsPhrase(text, anchor))) {
      reasons.push("unresolved_study_without_clue_bundle");
    }
  }
  if (anchors.length > 0 && WORK_REFERENCE_RE.test(text) && matchedAnchors.length < 2) {
    reasons.push("underspecified_work_reference");
  }
  if ((context.dates || []).length && ["study_identity", "substantive"].includes(targetType) &&
      !(context.dates || []).some((date) => containsPhrase(text, date)) &&
      resolvedAnchors(context).every((anchor) => !containsPhrase(text, anchor))) {
    reasons.push("material_date_or_resolved_work_missing");
  }
  return { valid: reasons.length === 0, reasons, matchedAnchors };
}

function queryObject(text, purposeLane, context, target = {}) {
  const lane = normalizePurposeLane(purposeLane, DEFAULT_PURPOSE_LANE);
  return {
    claimId: target.claimId || null,
    query: clean(text, 500),
    // Purpose lane = the evidentiary job, never a desired stance.
    purposeLane: lane,
    providerProfile: target.providerProfile || providerProfileForLane(lane),
    reasonForQuery: target.reasonForQuery || `deterministic_${lane}`,
    // Legacy stance fields retained neutral for backward compatibility only.
    intent: NEUTRAL_INTENT,
    stanceGoal: NEUTRAL_STANCE_GOAL,
    matchedPart: "retrieval_context",
    evidenceLaneId: target.evidenceLaneId || null,
    evidenceTargetId: context.evaluationTargetId || target.evidenceTargetId || null,
    evidenceTargetType: context.evaluationTargetType || target.evidenceTargetType || "other",
    bearingRequirement: target.bearingRequirement || "direct_truth_value",
  };
}

// Build deterministic queries that each fill a DISTINCT evidentiary purpose lane
// for the target — not a support/refute/nuance stance bucket. Query wording is
// neutral; stance is classified after retrieval.
export function buildDeterministicAnchoredQueries(context = {}, target = {}) {
  const person = (context.speakerEntities || [])[0] || "";
  const organization = (context.organizations || [])[0] || "";
  const work = (context.resolvedWorks || [])[0] || {};
  const workAnchor = work.identifier || work.title || (context.studyClues || []).find((clue) => !/identity unresolved/i.test(clue)) || "";
  const date = (context.dates || [])[0] || "";
  const population = (context.populations || [])[0] || work.population || "";
  const action = (context.allegedActions || [])[0] || "";
  const topic = unique(context.requiredAnchors || [], 10)
    .filter((anchor) => ![person, organization, workAnchor, date].includes(anchor))
    .slice(0, 3).join(" ");
  const core = unique([person, organization, workAnchor, date, topic, action], 10).join(" ");
  if (!core) return [];

  const type = context.evaluationTargetType || "substantive";
  const lanes = lanesForTargetType(type);
  const laneAt = (index) => lanes[index] || lanes[lanes.length - 1] || DEFAULT_PURPOSE_LANE;

  // Candidate query text per purpose lane. We only emit lanes whose text is
  // meaningfully anchored; empty-anchor lanes are dropped by validation.
  const byLane = {
    attribution_record: `${person} ${organization} ${topic} statement transcript`,
    official_response: `${organization} ${person} ${topic} ${date} official response`,
    source_context: `${person} ${organization} ${workAnchor} ${date} background context`,
    study_identity: `${workAnchor} ${person} ${date} ${topic} ${population} study`,
    original_document: `${workAnchor} ${date} ${population} ${topic} primary source`,
    independent_reanalysis: `${workAnchor} ${date} ${topic} independent reanalysis replication`,
    independent_methodology: `${workAnchor} ${population} ${topic} methodology analysis`,
    alleged_conduct: core,
    inference_limitations: `${workAnchor} ${date} ${topic} limitations independent review`,
    causal_background: `${topic} ${population} systematic review meta-analysis`,
    legal_or_policy_context: `${organization} ${topic} ${date} legislation regulation policy`,
  };

  if (type === "study_identity") {
    return [queryObject(byLane.study_identity, "study_identity", context, target)];
  }

  // Emit up to three distinct purpose lanes appropriate to the target type.
  const selectedLanes = [...new Set([laneAt(0), laneAt(1), laneAt(2)])];
  return selectedLanes
    .map((lane) => (byLane[lane] ? queryObject(byLane[lane], lane, context, target) : null))
    .filter(Boolean);
}

function purposeLaneOf(query) {
  return normalizePurposeLane(query.purposeLane, DEFAULT_PURPOSE_LANE);
}

export function buildAnchoredQueryPack({ claim, existingQueries = [], limit = 9 } = {}) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  // Cap repeats of the same purpose lane so one lane cannot crowd out the
  // others. This is purpose diversity, NOT a stance quota.
  const MAX_PER_LANE = 3;
  const laneCounts = new Map();
  const consider = (query) => {
    const context = retrievalContextForTarget(claim, query.evidenceTargetId);
    const validation = validateAnchoredQuery(query.query, context || {}, query.evidenceTargetType || context?.evaluationTargetType);
    const key = clean(query.query).toLowerCase();
    const lane = purposeLaneOf(query);
    if (!validation.valid) {
      rejected.push({ query: clean(query.query), purposeLane: lane, reasons: validation.reasons });
      return;
    }
    if (!key || seen.has(key)) return;
    if ((laneCounts.get(lane) || 0) >= MAX_PER_LANE) return;
    seen.add(key);
    laneCounts.set(lane, (laneCounts.get(lane) || 0) + 1);
    accepted.push({
      ...query,
      purposeLane: lane,
      providerProfile: query.providerProfile || providerProfileForLane(lane),
      intent: NEUTRAL_INTENT,
      stanceGoal: NEUTRAL_STANCE_GOAL,
      retrievalContext: context || null,
    });
  };
  existingQueries.forEach(consider);
  for (const context of claim?.retrievalContexts || []) {
    const target = existingQueries.find((query) =>
      Number(query.evidenceTargetId) === Number(context.evaluationTargetId)
    ) || { claimId: claim?.id, evidenceTargetId: context.evaluationTargetId, evidenceTargetType: context.evaluationTargetType };
    buildDeterministicAnchoredQueries(context, target).forEach(consider);
  }
  // An eligible claim must never silently receive zero searches. Validation is
  // a quality filter, not authority to erase a thesis or substantive target.
  // If every generated query was rejected, preserve one bounded deterministic
  // query based on the best substantive evaluation target.
  if (accepted.length === 0) {
    const contexts = claim?.retrievalContexts || [];
    const context = contexts.find((item) => item.evaluationTargetType === "substantive") || contexts[0] || {};
    const target = existingQueries.find((query) =>
      Number(query.evidenceTargetId) === Number(context.evaluationTargetId)
    ) || {
      claimId: claim?.id,
      evidenceTargetId: context.evaluationTargetId,
      evidenceTargetType: context.evaluationTargetType || "substantive",
      bearingRequirement: "warrant_test",
    };
    const fallbackText = clean(
      context.targetText || context.objectClaimText || claim?.objectClaim || claim?.text,
      500,
    );
    if (tokenizeBearingText(fallbackText).length >= 3) {
      accepted.push({
        ...queryObject(fallbackText, "alleged_conduct", context, target),
        deterministicFallback: true,
        fallbackReason: "all_generated_queries_rejected",
      });
    }
  }
  return { queries: accepted.slice(0, Math.max(1, limit)), rejected };
}
