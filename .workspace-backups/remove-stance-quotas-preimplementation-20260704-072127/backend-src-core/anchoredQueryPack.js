import { tokenizeBearingText } from "./evidenceNeed.js";
import { retrievalContextForTarget } from "./retrievalContext.js";

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

function queryObject(text, intent, context, target = {}) {
  return {
    claimId: target.claimId || null,
    query: clean(text, 500),
    intent,
    stanceGoal: intent === "nuance" ? "context" : intent,
    matchedPart: "retrieval_context",
    evidenceLaneId: target.evidenceLaneId || null,
    evidenceTargetId: context.evaluationTargetId || target.evidenceTargetId || null,
    evidenceTargetType: context.evaluationTargetType || target.evidenceTargetType || "other",
    bearingRequirement: target.bearingRequirement || "direct_truth_value",
  };
}

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
  if (type === "attribution") {
    return [
      queryObject(`${person} ${organization} ${topic} statement transcript`, "support", context, target),
      queryObject(`${organization} response ${person} ${topic} statement`, "refute", context, target),
      queryObject(`${person} ${organization} ${workAnchor} ${date} chronology`, "nuance", context, target),
    ];
  }
  if (type === "study_identity") {
    return [queryObject(`${person} ${organization} ${date} ${topic} ${population} study`, "nuance", context, target)];
  }
  return [
    queryObject(core, "support", context, target),
    queryObject(`${organization} response ${person} ${workAnchor} ${date} ${action} ${topic}`, "refute", context, target),
    queryObject(`${workAnchor} ${date} ${population} methodology subgroup protocol ${organization} ${topic}`, "nuance", context, target),
  ];
}

function intentOf(query) {
  const value = String(query.intent || query.stanceGoal || "").toLowerCase();
  if (value.includes("support") || value === "origin") return "support";
  if (value.includes("refute")) return "refute";
  return "nuance";
}

export function buildAnchoredQueryPack({ claim, existingQueries = [], limit = 9 } = {}) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  const consider = (query) => {
    const context = retrievalContextForTarget(claim, query.evidenceTargetId);
    const validation = validateAnchoredQuery(query.query, context || {}, query.evidenceTargetType || context?.evaluationTargetType);
    const key = clean(query.query).toLowerCase();
    const intent = intentOf(query);
    if (!validation.valid) {
      rejected.push({ query: clean(query.query), reasons: validation.reasons });
      return;
    }
    if (!key || seen.has(key) || accepted.filter((item) => intentOf(item) === intent).length >= 3) return;
    seen.add(key);
    accepted.push({ ...query, intent, stanceGoal: intent === "nuance" ? "context" : intent, retrievalContext: context || null });
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
        ...queryObject(fallbackText, "nuance", context, target),
        deterministicFallback: true,
        fallbackReason: "all_generated_queries_rejected",
      });
    }
  }
  return { queries: accepted.slice(0, Math.max(1, limit)), rejected };
}
