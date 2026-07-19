// Deterministic assertionSource credibility classification for the Call-1 split
// arm (pipeline-y-canonical-relation-split-v1, Host Step, runs after Call 1B).
// This is a string-classification pass over what 1B already produced — the model
// is NEVER asked to self-grade its own source's credibility. Three tiers:
//   author_voice        — matches an article author, OR no source cited beneath
//                          the article's own statement (weakest tier: effectively
//                          hearsay until independently corroborated).
//   institutional       — a named institution, agency, document, or study distinct
//                          from the article's authors.
//   attributed_testimony— a named person quoted/paraphrased, distinct from the
//                          authors and not an institution.
// Feeds host selection as a TIE-BREAKER (not a filter) and gives the existing
// sourceStrategy override a clean pre-computed signal.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const norm = (value) => clean(value).toLowerCase().replace(/^the\s+/, "").replace(/[.,]+$/, "");

const AUTHOR_VOICE_LABEL = /^(?:the\s+)?(?:article|author|authors|analysis|article\s+voice|article\s+author|reporter|writer|byline)$/i;

const INSTITUTION_CUE = /\b(?:university|institute|institution|agency|administration|department|ministry|commission|committee|centers?|center|centre|bureau|council|foundation|association|organization|organisation|company|corporation|inc|llc|ltd|journal|study|studies|report|analysis by|survey|trial|review|court|board|office|program|programme|laborator(?:y|ies))\b/i;
// A multi-letter all-caps token in a source label is almost always an org/agency
// acronym. Generic on purpose — never enumerate specific institutions (that would be
// fixture contamination; see fixtureContamination.test.js).
const ACRONYM_CUE = /\b[A-Z]{2,6}\b/;

const PERSON_CUE = /^(?:dr|mr|ms|mrs|prof|professor|sen|rep|gov|president)\.?\s+[a-z]/i;
const TWO_NAME = /^[A-Z][a-z]+(?:['-][A-Za-z]+)?\s+[A-Z][a-z]+/;

export function classifyAssertionSource(assertionSource, { articleAuthors = [] } = {}) {
  const source = clean(assertionSource);
  if (!source || AUTHOR_VOICE_LABEL.test(source)) return "author_voice";

  const authors = articleAuthors.map(norm).filter(Boolean);
  const target = norm(source);
  if (authors.some((author) => author === target
    || author.includes(target) || target.includes(author))) {
    return "author_voice";
  }

  if (INSTITUTION_CUE.test(source) || ACRONYM_CUE.test(source)) return "institutional";
  if (PERSON_CUE.test(source) || TWO_NAME.test(source)) return "attributed_testimony";
  // A single bare proper noun that is neither an author nor institution-cued is
  // most safely read as a named speaker (testimony) rather than the weakest tier.
  if (/^[A-Z][a-z]+$/.test(source)) return "attributed_testimony";
  return "author_voice";
}

// Ranking used by selection as a tie-breaker: prefer independently-sourced claims
// over the article's own echo when propositions are otherwise near-identical.
export const SOURCE_CLASS_RANK = Object.freeze({
  institutional: 3, attributed_testimony: 2, author_voice: 1 });
