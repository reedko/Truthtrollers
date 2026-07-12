// scripts/testing/lib/tm4Declarativeness.mjs
//
// Declarativeness/falsifiability audit for TM4 selected claims (test-only).
//
// A good selected claim preserves a hard proposition (actor + predicate +
// object, ideally with numbers/dates/studies/laws). A bad one has decayed
// into a topic summary ("raises concerns about vaccine safety messaging").

export const SOFTENING_PHRASES = [
  /raises? concerns? about/i,
  /questions? whether/i,
  /debate over/i,
  /controversy (around|over)/i,
  /issues? related to/i,
  /handling of (vaccine[- ]related )?(information|data)/i,
  /public health messaging/i,
  /claims? about/i,
  /vaccine safety concerns?/i,
  /concerns? (about|regarding|over)/i,
  /discussion (of|about|around)/i,
  /the (topic|subject) of/i,
];

const HARD_PREDICATE_RE = /\b(manipulat\w*|destroy\w*|order\w*|conceal\w*|suppress\w*|fabricat\w*|falsif\w*|caus\w*|increas\w*|decreas\w*|exceed\w*|contain\w*|remov\w*|revealed?|showed?|found|reported?|occurred|classif\w*|set the stage|paved the way|had \d|is \d+|are \d+|was|were|did not|does not|higher|lower|times)\b/i;
const NUMBER_DATE_RE = /\d/;
const STUDY_LAW_RE = /\b(stud(y|ies)|report|trial|analysis|transcript|meeting|act|law|amendment|dataset|VAERS|documentary)\b/i;
const ENTITY_RE = /\b([A-Z][a-z]+ [A-Z][a-z]+|\bCDC\b|\bFDA\b|\bWHO\b|\bNIH\b|\bEPA\b|thimerosal|aluminum|formaldehyde|MMR|DTaP|DTP|VAERS)\b/;

const extractSet = (text, re) => new Set((String(text || "").match(new RegExp(re, "g")) || []).map((s) => s.toLowerCase()));

/**
 * Audit one selected claim against its raw origin.
 * @returns {
 *   softeningPhrases, softeningIntroduced, hardPredicatePreserved,
 *   namedEntitiesPreserved, numbersPreserved, declarativeScore (0-5),
 *   topicSummaryWarning
 * }
 */
export function auditDeclarativeness({ selectedText, rawText = "", embeddedSubstantiveClaim = "" }) {
  const sel = String(selectedText || "");
  const origin = `${rawText} ${embeddedSubstantiveClaim}`;

  const softening = SOFTENING_PHRASES.filter((re) => re.test(sel)).map((re) => re.source);
  const softeningInOrigin = SOFTENING_PHRASES.some((re) => re.test(rawText));

  const hardPredicate = HARD_PREDICATE_RE.test(sel);
  const originHadPredicate = HARD_PREDICATE_RE.test(origin);

  const selEntities = extractSet(sel, ENTITY_RE);
  const originEntities = extractSet(origin, ENTITY_RE);
  const lostEntities = [...originEntities].filter((e) => !selEntities.has(e));
  const entitiesPreserved = originEntities.size === 0 || lostEntities.length / originEntities.size <= 0.5;

  const numbersPreserved = !NUMBER_DATE_RE.test(origin) || NUMBER_DATE_RE.test(sel);
  const studyLawPreserved = !STUDY_LAW_RE.test(origin) || STUDY_LAW_RE.test(sel);

  let score = 5;
  if (softening.length && !softeningInOrigin) score -= 2;
  if (!hardPredicate && originHadPredicate) score -= 2;
  if (!hardPredicate && !originHadPredicate) score -= 1;
  if (!entitiesPreserved) score -= 1;
  if (!numbersPreserved) score -= 1;
  if (!studyLawPreserved) score -= 0.5;
  score = Math.max(0, Math.round(score * 2) / 2);

  const topicSummaryWarning = (softening.length > 0 && !hardPredicate) ||
    (!hardPredicate && !NUMBER_DATE_RE.test(sel) && sel.length < 90);

  return {
    softeningPhrases: softening,
    softeningIntroduced: softening.length > 0 && !softeningInOrigin,
    hardPredicatePreserved: hardPredicate || !originHadPredicate,
    namedEntitiesPreserved: entitiesPreserved,
    lostEntities,
    numbersPreserved,
    studyLawPreserved,
    declarativeScore: score,
    topicSummaryWarning,
  };
}
