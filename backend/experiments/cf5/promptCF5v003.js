// CF5 PromptCF5-v0003 experiment ("Basis" ontology). Does NOT modify prompts.js or
// schemas.js. Text is verbatim as supplied for this experiment — not paraphrased.
// ARTICLE METADATA / ARTICLE wrapper labels are kept identical to PromptCF5-v0001
// (unchanged, per "no code changes / prompt text only" — only the SYSTEM+TASK text
// supplied for this experiment differs; the surrounding article-injection scaffold is
// untouched so the experiment is scoped to the ontology framing only).
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";

export const PROMPT_CF5_V003_VERSION = "PromptCF5-v0003";

const CF5_SYSTEM_V0003 = `ClaimFoundry discovers the minimal evidentiary basis required to evaluate a piece of content.

Determine the minimal evidentiary basis.

The basis consists of the smallest complete set of independently testable basis elements whose evidentiary status collectively determines whether the substantive content is supported or refuted by credible evidence.

Use only the supplied content and its source-unit identifiers.
Do not use outside knowledge.
Do not fact-check.`;

const CF5_TASK_V0003 = `TASK

Read the content as substantive representations about the world.

Select only basis elements belonging to the evidentiary basis.

Exclude decorative material, routine background, rhetorical flourishes, procedural details, and basis elements whose evidentiary status would not materially affect evaluation of the substantive content.

Preserve important names, quantities, dates, comparisons, causal relationships, study findings, institutional actions, and attributed allegations.

Include important challenged or opposing basis elements when their evaluation is necessary to evaluate the substantive content.

Produce the smallest complete basis.

Aim for approximately 8–15 basis elements, but never manufacture elements to reach that range and never omit an essential element merely to stay below it.

For each basis element:

- claimId — a short stable identifier (e.g. "E001");

- claim — the basis element, written so it is understandable and independently investigable outside the content. Resolve pronouns and vague references.

- grounding — the source-unit IDs where the content presents or relies upon the basis element.

- articleTreatment — adopted, challenged, or reported.

- provenance — the semantic origin when attributed externally. Use null when asserted only in the content's own voice. Do not invent provenance.

Avoid duplicate basis elements.`;

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

export function buildPromptCF5v003({ article, units }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

${CF5_TASK_V0003}`;
  return { system: CF5_SYSTEM_V0003, user, responseSchema: CF5_CLAIMS_SCHEMA_V1 };
}

export { CF5_SYSTEM_V0003, CF5_TASK_V0003 };
