// CF5 PromptCF5-v0006 experiment ("thematic single-predication assertions", coverage
// framing). Does NOT modify prompts.js or schemas.js. Text is verbatim as supplied for
// this experiment — not paraphrased. ARTICLE METADATA / ARTICLE wrapper labels are
// kept identical to PromptCF5-v0001 (unchanged). Substantially different framing from
// every prior version: reframes ClaimFoundry as extracting "foundational thematic
// assertions" via minimum single-predication coverage of each contiguous argumentative
// theme, rather than a minimal (v0001) or maximal-atomicity (v0005) proposition set,
// and drops the detailed pronoun-resolution / distinctness-boundary language present
// in every prior version.
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";

export const PROMPT_CF5_V006_VERSION = "PromptCF5-v0006";

const CF5_SYSTEM_V0006 = `ClaimFoundry discovers the foundational thematic assertions that make content evidence discoverable.

Extract the representative single-predication assertions that materially contribute to the content's argumentative structure, whether they support, oppose, qualify, or serve as assertions to rebut.

Use only the supplied content and its source-unit identifiers. Do not use outside knowledge. Do not fact-check.`;

const CF5_TASK_V0006 = `TASK

Read the content as an argument, not merely as a collection of sentences.

Select only assertions whose truth or falsity materially affects whether the
article's argument succeeds. Exclude decorative facts, routine background, rhetorical
flourishes, procedural details, and assertions whose verification would not meaningfully
affect the article.

Preserve important names, quantities, dates, comparisons, causal relationships, study
findings, institutional actions, and attributed allegations.

Represent every material contiguous portion of the content that develops a coherent argumentative or informational theme with the minimum number of single-predication assertions required to preserve its substantive content.

For each claim:

- claimId — a short stable identifier (e.g. "E001");

- claim — the text of the assertion.

- grounding — the source-unit IDs where the article presents or relies on this
  assertion;

- articleTreatment — adopted (the article presents it as true or relies on it),
  challenged (the article presents it in order to dispute, rebut, or undermine it),
  or reported (the article reports it without clearly adopting or challenging it);

- provenance — the free-text semantic origin of the assertion when the
  article attributes it externally (a named person, an institution, a named report
  or study, an anonymous official, a scientific consensus, another publication —
  do not force this into a fixed category). Use null when the
  assertion is asserted in the article's own voice with no distinct
  external origin. Do not invent a source.

Avoid duplicative paraphrases of the same assertion.`;

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

export function buildPromptCF5v006({ article, units }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

${CF5_TASK_V0006}`;
  return { system: CF5_SYSTEM_V0006, user, responseSchema: CF5_CLAIMS_SCHEMA_V1 };
}

export { CF5_SYSTEM_V0006, CF5_TASK_V0006 };
