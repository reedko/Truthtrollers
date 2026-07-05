import { tokenizeBearingText } from "./evidenceNeed.js";
import { isVerifiedResolvedWork } from "./candidateSurvival.js";
import logger from "../utils/logger.js";

const MAX_PASSAGE = 1200;

function clean(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function unique(values, limit = 16) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const normalized = clean(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function list(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function targetValue(target, camel, snake = camel) {
  return target?.[camel] ?? target?.[snake] ?? "";
}

function findNearbyArticlePassage(articleText, anchors) {
  const text = clean(articleText, 120000);
  if (!text) return "";
  const lower = text.toLowerCase();
  let position = -1;
  for (const anchor of unique(anchors, 20)) {
    if (anchor.length < 3) continue;
    const found = lower.indexOf(anchor.toLowerCase());
    if (found >= 0 && (position < 0 || found < position)) position = found;
  }
  if (position < 0) return "";
  const startFloor = Math.max(0, position - Math.floor(MAX_PASSAGE / 2));
  const endCeiling = Math.min(text.length, position + Math.floor(MAX_PASSAGE / 2));
  const priorBoundary = Math.max(
    text.lastIndexOf(". ", startFloor),
    text.lastIndexOf("\n", startFloor),
  );
  const nextSentence = text.indexOf(". ", endCeiling);
  const start = priorBoundary >= 0 ? priorBoundary + 2 : startFloor;
  const end = nextSentence >= 0 && nextSentence - start <= MAX_PASSAGE
    ? nextSentence + 1
    : Math.min(text.length, start + MAX_PASSAGE);
  return clean(text.slice(start, end), MAX_PASSAGE);
}

function extractYears(values) {
  return unique(values.flatMap((value) => String(value || "").match(/\b(?:19|20)\d{2}\b/g) || []), 12);
}

function extractNumbersAndScope(values) {
  return unique(values.flatMap((value) => String(value || "").match(
    /\b(?:\d+(?:\.\d+)?%?|\d+(?:\.\d+)?\s*(?:days?|weeks?|months?|years?|doses?|mg|mcg|kg|hz|ghz)|under\s+\d+|over\s+\d+)\b/gi,
  ) || []), 16);
}

function organizationLike(value) {
  return /\b(?:CDC|FDA|WHO|NIH|agency|association|center|centres?|department|foundation|government|institute|institution|ministry|organization|university)\b/i.test(value);
}

function unresolvedWorkReference(values) {
  const text = values.filter(Boolean).join(" ");
  // A generic request for "evidence", "studies", or "analysis" does not
  // identify a particular work. Requiring study resolution in that situation
  // can invalidate every query for a broad thesis. Demand an identity cue or a
  // work-specific allegation instead.
  if (/\b(?:PMID|PMCID|PMC\s*\d+|DOI\s*:|10\.\d{4,9}\/)/i.test(text)) return true;
  if (/\b(?:this|that|the|cited|referenced|identified|named|original|underlying|2004|2014)\s+(?:study|dataset|data|report|analysis|paper|protocol)\b/i.test(text)) return true;
  if (/\b(?:study|dataset|report|analysis|paper|protocol)\b.{0,80}\b(?:by|from|published|authored|conducted|cohort|subgroup)\b/i.test(text)) return true;
  if (/\b(?:data|analysis|results?|protocol)\b.{0,120}\b(?:manipulat|omit|exclud|destroy|suppress|conceal|fabricat|alter)\w*/i.test(text)) return true;
  return false;
}

function resolvedWorkForTarget(target) {
  const title = clean(targetValue(target, "studyTitle", "study_title"), 700);
  const identifier = clean(targetValue(target, "studyIdentifier", "study_identifier"), 255);
  if (!title && !identifier) return null;
  return {
    title: title || null,
    authors: clean(targetValue(target, "studyAuthors", "study_authors"), 500) || null,
    year: Number(targetValue(target, "studyYear", "study_year")) || null,
    identifier: identifier || null,
    population: clean(targetValue(target, "populationScope", "population_scope"), 500) || null,
    resolutionStatus: clean(targetValue(target, "resolutionStatus", "resolution_status"), 40) || "unresolved",
  };
}

export function buildRetrievalContextsForClaim(claim = {}, {
  articleText = "",
  caseSubjectTerms = [],
} = {}) {
  const visibleClaimText = clean(claim.originalText || claim.visibleClaimText || claim.text, 1000);
  const objectClaimText = clean(claim.objectClaim || claim.objectClaimText || claim.searchText || claim.text, 1000);
  const targets = Array.isArray(claim.evaluationTargets) && claim.evaluationTargets.length
    ? claim.evaluationTargets
    : [{
        evaluationTargetId: claim.evaluationTargetId || null,
        targetType: "substantive",
        targetText: objectClaimText,
        objectText: objectClaimText,
      }];

  return targets.map((target) => {
    const evaluationTargetId = Number(targetValue(target, "evaluationTargetId", "evaluation_target_id")) || null;
    const evaluationTargetType = clean(targetValue(target, "targetType", "target_type"), 60) || "substantive";
    const targetText = clean(targetValue(target, "targetText", "target_text") || objectClaimText, 1000);
    const subject = clean(targetValue(target, "subjectEntity", "subject_entity"), 500);
    const object = clean(targetValue(target, "objectText", "object_text"), 1000);
    const allegedAction = clean(targetValue(target, "allegedAction", "alleged_action"), 500);
    const population = clean(targetValue(target, "populationScope", "population_scope"), 500);
    const studyTitle = clean(targetValue(target, "studyTitle", "study_title"), 700);
    const studyAuthors = clean(targetValue(target, "studyAuthors", "study_authors"), 500);
    const studyIdentifier = clean(targetValue(target, "studyIdentifier", "study_identifier"), 255);
    const sourceExcerpt = clean(targetValue(target, "sourceExcerpt", "source_excerpt"), 1000);
    const speakerEntities = unique([
      claim.speakerEntity,
      evaluationTargetType === "attribution" ? subject : "",
    ], 8);
    const namedEntities = unique([
      ...list(claim.namedEntities),
      subject,
      ...speakerEntities,
    ], 16);
    const passageAnchors = unique([
      ...speakerEntities,
      ...namedEntities,
      ...list(claim.studiesOrDocuments),
      studyTitle,
      studyIdentifier,
      ...caseSubjectTerms,
    ], 20);
    const articlePassageContext = findNearbyArticlePassage(articleText, passageAnchors);
    const evidenceStrings = [
      visibleClaimText,
      objectClaimText,
      targetText,
      object,
      sourceExcerpt,
      articlePassageContext,
    ];
    const resolvedWork = resolvedWorkForTarget(target);
    const inheritedResolvedWorks = (Array.isArray(claim.resolvedWorks) ? claim.resolvedWorks : [])
      .filter((work) => work && typeof work === "object")
      .filter((work) => !work.evaluationTargetId || Number(work.evaluationTargetId) === evaluationTargetId);
    const resolvedWorks = [
      ...(resolvedWork ? [resolvedWork] : []),
      ...inheritedResolvedWorks,
    ].filter((work, index, all) => all.findIndex((candidate) =>
      (candidate.identifier || candidate.title) === (work.identifier || work.title)
    ) === index).slice(0, 5);
    const studyResolutionRequired = resolvedWorks.length === 0 && unresolvedWorkReference(evidenceStrings);
    const studyClues = unique([
      ...list(claim.studiesOrDocuments),
      studyTitle,
      studyAuthors,
      studyIdentifier,
      studyResolutionRequired ? "Referenced study/document identity unresolved" : "",
    ], 12);
    const sourceCitations = unique([
      claim.sourceCitedInArticle,
      targetValue(target, "studyIdentifier", "study_identifier"),
    ], 12);
    const dates = unique([
      ...list(claim.dates),
      ...extractYears(evidenceStrings),
    ], 12);
    const organizations = unique(namedEntities.filter(organizationLike), 10);
    // Anchor hygiene: only VERIFIED resolved works (study/original/official/
    // primary documents identified by their own properties) may contribute their
    // title/authors to requiredAnchors. An unverified work — a press release,
    // news story, advocacy page, or commentary — must never become a required
    // study anchor (that is the GlobeNewswire poisoning). Its identifier (if any)
    // is a verification signal and may stay; its title/authors are demoted out of
    // required anchors and logged. (Follow-up §2.)
    const resolvedWorkAnchors = resolvedWorks.flatMap((work) => {
      if (isVerifiedResolvedWork(work)) {
        return [work.title, work.identifier, work.authors].filter(Boolean);
      }
      logger.warn(`[RESOLVED_WORK_ANCHOR_DEMOTED] ${JSON.stringify({
        event: "resolved_work_anchor_demoted",
        claimId: claim?.id ?? null,
        evaluationTargetId,
        title: clean(work.title, 200),
        url: clean(work.url, 500),
        reason: "unverified_resolved_work_not_promoted_to_required_anchor",
      })}`);
      // Keep only a concrete bibliographic identifier as provenance (usually
      // empty for press releases); never the title.
      return [work.identifier].filter(Boolean);
    });
    const requiredAnchors = unique([
      ...speakerEntities,
      ...organizations,
      ...list(claim.evidenceNeed?.mustIncludeTerms),
      ...list(claim.evidenceNeed?.subjectTerms).filter((term) => tokenizeBearingText(term).length <= 5),
      ...dates,
      ...studyClues.filter((clue) => clue !== "Referenced study/document identity unresolved"),
      ...resolvedWorkAnchors,
    ], 20);

    return {
      visibleClaimText,
      objectClaimText,
      evaluationTargetId,
      evaluationTargetType,
      targetText,
      speakerEntities,
      organizations,
      namedEntities,
      dates,
      numbersAndScope: extractNumbersAndScope(evidenceStrings),
      populations: unique([population], 8),
      allegedActions: unique([allegedAction], 8),
      studyClues,
      sourceCitations,
      articlePassageContext,
      resolvedWorks,
      requiredAnchors,
      studyResolutionRequired,
    };
  });
}

export function retrievalContextForTarget(claim, targetId) {
  const contexts = Array.isArray(claim?.retrievalContexts) ? claim.retrievalContexts : [];
  const numericTargetId = Number(targetId) || null;
  return contexts.find((context) =>
    numericTargetId && Number(context.evaluationTargetId) === numericTargetId
  ) || claim?.retrievalContext || contexts[0] || null;
}
