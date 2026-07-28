// CF5 PromptCF5-v002 experiment. Does NOT modify prompts.js (production, currently
// PromptCF5-v0001). Builds the v002 candidate by taking an exact copy of v0001's
// system+task text and programmatically replacing every occurrence of
// "proposition"/"propositions" with the nonsense token "qzavrympthunexoljibwok" via a
// single word-boundary regex substitution — not hand-edited, so there is no risk of a
// missed or extra occurrence. The substitution is verified against the live production
// text at import time (throws if v0001's text has drifted since this file was written).
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";
import { buildCf5ClaimGenerationPrompt } from "./prompts.js";

export const PROMPT_CF5_V002_VERSION = "PromptCF5-v0002";
const NONSENSE_TOKEN = "qzavrympthunexoljibwok";

// Exact copy of PromptCF5-v0001's SYSTEM + TASK text (see prompts.js). Kept here as a
// literal string, not derived at runtime, so the diff between v0001 and v0002 stays
// auditable as plain text (prompt_v0002.txt / prompt_diff.txt) independent of any
// import-time computation.
const CF5_SYSTEM_V0001 = `ClaimFoundry discovers what reality must look like for an article to be true.

Identify the minimal set of externally gradable propositions whose truth values
determine whether the article's argument succeeds.

Use only the supplied article and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.`;

const CF5_TASK_V0001 = `TASK

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

// Verify the literal copy above still matches production PromptCF5-v0001 exactly.
// Throws loudly rather than silently testing against a stale baseline.
function assertMatchesProduction() {
  const live = buildCf5ClaimGenerationPrompt({
    article: { title: "{{T}}", authors: ["{{A}}"], publisher: "{{P}}", publishedAt: "{{D}}" },
    units: [{ unitId: "{{U}}", text: "{{TXT}}" }],
  });
  if (live.system !== CF5_SYSTEM_V0001) {
    throw new Error("promptCF5v002.js's copy of PromptCF5-v0001 SYSTEM text has drifted from production prompts.js — update the copy before running this experiment.");
  }
  const liveTaskIndex = live.user.indexOf("TASK");
  if (live.user.slice(liveTaskIndex) !== CF5_TASK_V0001) {
    throw new Error("promptCF5v002.js's copy of PromptCF5-v0001 TASK text has drifted from production prompts.js — update the copy before running this experiment.");
  }
}
assertMatchesProduction();

function swapToNonsenseToken(text) {
  return text.replace(/\bpropositions\b/g, `${NONSENSE_TOKEN}s`).replace(/\bproposition\b/g, NONSENSE_TOKEN);
}

const CF5_SYSTEM_V0002 = swapToNonsenseToken(CF5_SYSTEM_V0001);
const CF5_TASK_V0002 = swapToNonsenseToken(CF5_TASK_V0001);

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

export function buildPromptCF5v002({ article, units }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

${CF5_TASK_V0002}`;
  return { system: CF5_SYSTEM_V0002, user, responseSchema: CF5_CLAIMS_SCHEMA_V1 };
}

export { CF5_SYSTEM_V0001, CF5_TASK_V0001, CF5_SYSTEM_V0002, CF5_TASK_V0002, NONSENSE_TOKEN };
