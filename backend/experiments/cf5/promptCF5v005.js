// CF5 PromptCF5-v0005 experiment ("maximize atomicity, no count ceiling"). Does NOT
// modify prompts.js or schemas.js. Text is verbatim as supplied for this experiment —
// not paraphrased. ARTICLE METADATA / ARTICLE wrapper labels are kept identical to
// PromptCF5-v0001 (unchanged). This version is a substantial, deliberate departure
// from every prior version: it explicitly reverses the minimality framing ("Your goal
// is NOT to minimize the number of propositions... minimize the semantic content of
// each proposition") and drops the 8-15 count ceiling entirely.
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";

export const PROMPT_CF5_V005_VERSION = "PromptCF5-v0005";

const CF5_SYSTEM_V0005 = `ClaimFoundry discovers what reality must look like for an article to be true.

Identify the externally gradable propositions whose truth values determine
whether the article's argument succeeds.

Use only the supplied article and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.`;

const CF5_TASK_V0005 = `TASK

Read the article as an argument, not merely as a collection of sentences.

Identify every material proposition whose truth or falsity could materially affect
whether the article's argument succeeds.

A proposition is material if determining its truth would meaningfully change the
evaluation of the article.

Exclude decorative facts, routine background, rhetorical flourishes, procedural
details, and propositions whose verification would not materially affect the
article.

Preserve important names, quantities, dates, comparisons, causal relationships,
study findings, institutional actions, and attributed allegations.

Include important challenged or opponent propositions when evaluating them is
necessary to understand whether the article succeeds.

Your goal is NOT to minimize the number of propositions.

Your goal is to minimize the semantic content of each proposition.

Each proposition must be independently evidence-testable.

A proposition is independently evidence-testable if it can receive one evidence
verdict without another part of the same proposition reasonably receiving a
different verdict.

If different parts could reasonably receive different evidence verdicts, produce
separate propositions.

Do not combine propositions simply because they appear in the same sentence,
paragraph, quotation, study, event, report, or argument.

A proposition may be broad in scope, but it should express only one externally
gradable relationship.

Produce every material independently evidence-testable proposition needed to
evaluate the article.

Do not omit a proposition because another proposition appears more important.

Do not merge propositions in order to reduce the number of outputs.

When uncertain whether to merge or split, prefer separate propositions.
Selection can remove unnecessary propositions later; merged propositions cannot
be reliably separated after extraction.


For each claim:

- claimId — a short stable identifier (e.g. "E001");

- claim — a self-contained, externally gradable proposition.

  Resolve pronouns and vague references inside the text so the proposition is
  understandable outside the article.

  It must be investigable outside the article.

  Each proposition should express exactly one independently evidence-testable
  relationship.

  Do not split merely because a sentence contains "and."

  Instead, split whenever different parts could reasonably receive different
  evidence verdicts or require materially different evidence.

  Conversely, do not split when all parts necessarily stand or fall together
  under the same body of evidence.

- grounding — the source-unit IDs where the article presents or relies on this
  proposition;

- articleTreatment — adopted (the article presents it as true or relies on it),
  challenged (the article presents it in order to dispute, rebut, or undermine
  it), or reported (the article reports it without clearly adopting or
  challenging it);

- provenance — the free-text semantic origin of the proposition when the article
  attributes it externally (a named person, an institution, a named report or
  study, an anonymous official, a scientific consensus, another publication —
  do not force this into a fixed category). Use null when the proposition is
  asserted in the article's own voice with no distinct external origin. Do not
  invent a source.


Avoid duplicative paraphrases of the same proposition.

Do not treat propositions as duplicative merely because they concern the same
topic, institution, person, allegation, controversy, or overall conclusion.

Two propositions are distinct when they require materially different evidence,
concern different studies, datasets, events, reports, mechanisms, actors, or
time periods, or could reasonably receive independent evidence verdicts.

When propositions are distinct, include both.

Only omit a proposition as duplicative when it is substantially another wording
of the same proposition.`;

function articleMetadata(article = {}) {
  return [
    `Title: ${article.title || "Unknown"}`,
    `Author or byline: ${(article.authors ?? []).join(", ") || "Not supplied"}`,
    `Publication: ${article.publisher || "Not supplied"}`,
    `Publication date: ${article.publishedAt || "Not supplied"}`,
  ].join("\n");
}

function serializeUnits(units = []) {
  return units.map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n");
}

export function buildPromptCF5v005({ article, units }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

${CF5_TASK_V0005}`;
  return { system: CF5_SYSTEM_V0005, user, responseSchema: CF5_CLAIMS_SCHEMA_V1 };
}

export { CF5_SYSTEM_V0005, CF5_TASK_V0005 };
