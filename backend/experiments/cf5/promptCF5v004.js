// CF5 PromptCF5-v0004 experiment ("Evidence Questions" ontology). Does NOT modify
// prompts.js or schemas.js. Text is verbatim as supplied for this experiment — not
// paraphrased. ARTICLE METADATA / ARTICLE wrapper labels are kept identical to
// PromptCF5-v0001 (unchanged, per "no code changes / prompt text only" — only the
// SYSTEM+TASK text supplied for this experiment differs).
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";

export const PROMPT_CF5_V004_VERSION = "PromptCF5-v0004";

const CF5_SYSTEM_V0004 = `ClaimFoundry discovers the independent evidence questions required to evaluate a piece of content.

Determine the smallest complete set of independent evidence questions whose answers collectively determine whether the substantive content is supported or refuted by credible evidence.

Use only the supplied content and its source-unit identifiers.
Do not use outside knowledge.
Do not fact-check.`;

const CF5_TASK_V0004 = `TASK

Read the content as substantive representations about the world.

Select only evidence questions whose answers materially affect evaluation of the substantive content.

Exclude decorative material, routine background, rhetorical flourishes, procedural details, and evidence questions whose answers would not materially affect evaluation.

Preserve important names, quantities, dates, comparisons, causal relationships, study findings, institutional actions, and attributed allegations.

Include evidence questions arising from important challenged or opposing representations when answering them is necessary to evaluate the substantive content.

Produce the smallest complete set of evidence questions.

Aim for approximately 8–15 evidence questions, but never manufacture questions to reach that range and never omit an essential question merely to stay below it.

For each evidence question:

- claimId — a short stable identifier (e.g. "E001");

- claim — the independently investigable factual content that the evidence question seeks to resolve, written so it is understandable outside the content. Resolve pronouns and vague references.

- grounding — the source-unit IDs where the content presents or relies upon it.

- articleTreatment — adopted, challenged, or reported.

- provenance — the semantic origin when attributed externally. Use null when asserted only in the content's own voice. Do not invent provenance.

Avoid duplicate evidence questions.`;

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

export function buildPromptCF5v004({ article, units }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

${CF5_TASK_V0004}`;
  return { system: CF5_SYSTEM_V0004, user, responseSchema: CF5_CLAIMS_SCHEMA_V1 };
}

export { CF5_SYSTEM_V0004, CF5_TASK_V0004 };
