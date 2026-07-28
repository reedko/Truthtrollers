// CF5 Prompt Experiment 2 — proposition-independence clarification. Does NOT modify
// prompts.js. Prompt A for this experiment is the current production prompt (the
// wording adopted from Experiment 1) — use buildCf5ClaimGenerationPrompt from
// prompts.js directly for Prompt A. This file builds Prompt B only: Prompt A plus
// exactly one sentence, inserted immediately after the "materially different
// evidence...independent evidence verdicts" sentence.
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";

const CF5_TASK_VARIANT_B = `TASK

Read the article as an argument, not merely as a collection of sentences.

Select only propositions whose truth or falsity materially affects whether the
article's argument succeeds. Exclude decorative facts, routine background, rhetorical
flourishes, procedural details, and claims whose verification would not meaningfully
affect the article.

Preserve important names, quantities, dates, comparisons, causal relationships, study
findings, institutional actions, and attributed allegations.

Include important challenged or opponent claims when evaluating them is necessary to
understand whether the article succeeds.

Produce a minimal set rather than every checkable statement. Aim for approximately
8-15 claims, but do not manufacture claims to reach that range, and do not omit an
essential claim to stay below it.

For each claim:

- claimId — a short stable identifier (e.g. "E001");
- claim — a self-contained, externally gradable proposition. Resolve pronouns and
  vague references inside the text; it must be investigable outside the article. Do
  not split a proposition merely because it contains "and" — split only when its
  components would require materially different evidence trails or could receive
  independent verdicts;
- grounding — the source-unit IDs where the article presents or relies on this
  proposition;
- articleTreatment — adopted (the article presents it as true or relies on it),
  challenged (the article presents it in order to dispute, rebut, or undermine it), or
  reported (the article reports it without clearly adopting or challenging it);
- provenance — the free-text semantic origin of the proposition when the article
  attributes it externally (a named person, an institution, a named report or study,
  an anonymous official, a scientific consensus, another publication — do not force
  this into a fixed category). Use null when the proposition is asserted in the
  article's own voice with no distinct external origin — do not invent a source.

Avoid duplicative paraphrases of the same proposition.

Do not treat propositions as duplicative merely because they concern the same topic,
institution, person, allegation, controversy, or overall conclusion.

Two propositions are distinct when they require materially different evidence,
concern different studies, datasets, events, reports, mechanisms, actors, or time
periods, or could reasonably receive independent evidence verdicts.

Two propositions are also distinct when either proposition could reasonably be true
while the other is false.

When propositions are distinct, include both.

Only omit a proposition as duplicative when it is substantially another wording of
the same proposition.`;

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

const CF5_SYSTEM = `ClaimFoundry discovers what reality must look like for an article to be true.

Identify the minimal set of externally gradable propositions whose truth values
determine whether the article's argument succeeds.

Use only the supplied article and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.`;

export function buildCf5ClaimGenerationPromptExperiment2VariantB({ article, units }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

${CF5_TASK_VARIANT_B}`;
  return { system: CF5_SYSTEM, user, responseSchema: CF5_CLAIMS_SCHEMA_V1 };
}
