// CF5 minimal vertical slice — dedicated prompts, built fresh per
// CF5_ARCHITECTURE_MIGRATION_PLAN_2026-07-26_v3.md. Not adapted from any CF1 prompt.
import { CF5_CLAIMS_SCHEMA_V1, CF5_REPAIR_SCHEMA_V1 } from "./schemas.js";
import { CF5_EXPERIMENTAL_FIELDS_SCHEMA_V1 } from "./experimentalSchemas.js";

export const CF5_GENERATION_PROMPT_VERSION = "PromptCF5-v0001";
export const CF5_REPAIR_PROMPT_VERSION = "cf5-repair-v1";
export const CF5_EXPERIMENTAL_PROMPT_VERSION = "cf5-experimental-v1";

function articleMetadata(article = {}) {
  return [
    `Title: ${article.title || "Unknown"}`,
    `Author or byline: ${(article.authors ?? []).join(", ") || "Not supplied"}`,
    `Publication: ${article.publisher || "Not supplied"}`,
    `Publication date: ${article.publishedAt || "Not supplied"}`,
  ].join("\n");
}

export function serializeUnits(units = []) {
  return units.map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n");
}

const CF5_SYSTEM = `ClaimFoundry discovers what reality must look like for an article to be true.

Identify the minimal set of externally gradable propositions whose truth values
determine whether the article's argument succeeds.

Use only the supplied article and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.`;

const CF5_TASK = `TASK

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

When propositions are distinct, include both.

Only omit a proposition as duplicative when it is substantially another wording of
the same proposition.`;

export function buildCf5ClaimGenerationPrompt({ article, units }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

${CF5_TASK}`;
  return { system: CF5_SYSTEM, user, responseSchema: CF5_CLAIMS_SCHEMA_V1 };
}

const CF5_REPAIR_SYSTEM = `You repair specific evaluation claims that failed hard structural validation.

Use only the supplied article, its source-unit identifiers, the failed claims, and the
stated validation errors. Do not use outside knowledge. Do not fact-check.

Repair only the identified defects. Do not add, delete, merge, or substantially
rewrite an otherwise-valid claim unless doing so is necessary to resolve the named
error.`;

export function buildCf5RepairPrompt({ article, units, failedClaims, errors, validUnitIds }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

VALID SOURCE-UNIT IDS

${validUnitIds.join(", ")}

FAILED CLAIMS

${JSON.stringify(failedClaims, null, 2)}

VALIDATION ERRORS

${JSON.stringify(errors, null, 2)}

TASK

Return corrected versions of exactly the failed claims above, using their existing
claimId values, with the same field meanings as the original task. Fix only what the
validation errors identify.`;
  return { system: CF5_REPAIR_SYSTEM, user, responseSchema: CF5_REPAIR_SCHEMA_V1 };
}

// Experimental fields — isolated per v3 §5. Not used by the canonical generation call.
const CF5_EXPERIMENTAL_SYSTEM = `${CF5_SYSTEM}

You are also producing experimental fields under test. They are not part of the
canonical output and will be evaluated separately for whether they add real
information beyond the proposition itself.`;

const CF5_EXPERIMENTAL_TASK = `${CF5_TASK}

For each claim, additionally supply these experimental fields, under test and not yet
part of the canonical schema:

- verificationQuestion — one plain-language question whose answer would settle the
  claim. Do not simply convert the proposition into a question if that adds no
  information a researcher wouldn't already have from the proposition itself.
- supportCondition — what a researcher would need to find to consider this
  proposition supported. Give concrete evidentiary criteria, not a restatement of the
  proposition.
- refutationCondition — what a researcher would need to find to consider this
  proposition refuted. Give concrete evidentiary criteria, not simply the negation of
  the proposition.
- qualificationCondition — what a researcher might find that would meaningfully
  qualify the proposition without fully confirming or refuting it.
- citedWorkNames — names of specific studies, reports, datasets, or documents the
  claim rests on, only when named in the article and not already fully captured by the
  claim text itself. Empty array if none.`;

export function buildCf5ExperimentalPrompt({ article, units }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

${CF5_EXPERIMENTAL_TASK}`;
  return { system: CF5_EXPERIMENTAL_SYSTEM, user, responseSchema: CF5_EXPERIMENTAL_FIELDS_SCHEMA_V1 };
}
