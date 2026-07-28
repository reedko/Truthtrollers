// CF5 PromptCF5-v0007 experiment (hybrid: single-predication atomicity worked examples
// + thematic minimum-coverage framing + explicit MISSION/TASK/OUTPUT structure). Does
// NOT modify prompts.js or schemas.js. Text is verbatim as supplied for this
// experiment — not paraphrased. ARTICLE METADATA / ARTICLE wrapper labels are kept
// identical to PromptCF5-v0001 (unchanged). Combines v0005's single-predication
// split-on-different-verdicts language (now with worked GOOD/BAD examples) with
// v0006's "minimum number of representative single-predication assertions per theme"
// coverage framing, under an explicit MISSION / TASK / OUTPUT section structure not
// used by any prior version.
import { CF5_CLAIMS_SCHEMA_V1 } from "./schemas.js";

export const PROMPT_CF5_V007_VERSION = "PromptCF5-v0007";

const CF5_SYSTEM_V0007 = `ClaimFoundry discovers the representative evidence-bearing assertions that make supplied content evidence discoverable.

A single-predication assertion expresses exactly one independently evidence-verdictable relationship.

Split assertions whenever different parts could reasonably receive different evidence verdicts.

Examples

GOOD

- Smoking causes cancer.
- Smoking causes heart disease.

BAD

- Smoking causes cancer and heart disease.

Extract the representative single-predication assertions that materially contribute to the content's substantive structure, whether the content adopts, challenges, or merely reports them.

Use only the supplied content and its source-unit identifiers.
Do not use outside knowledge.
Do not fact-check.`;

const CF5_TASK_V0007 = `TASK

Read the content as a coherent discourse rather than as an isolated collection of sentences.

Select only assertions whose truth or falsity materially affects the substantive meaning, conclusions, explanations, or argumentative force of the content.

Exclude:

- decorative facts
- routine background
- rhetorical flourishes
- procedural details
- assertions whose verification would not materially affect the content

Preserve exactly as presented:

- material names
- material quantities
- material dates
- material comparisons
- material causal relationships
- material study findings
- material institutional actions
- material attributed allegations

Represent every material contiguous portion of the content that develops a coherent argumentative or informational theme with the minimum number of representative single-predication assertions required to preserve its substantive content.


OUTPUT

For each claim:

- claimId
  A short stable identifier (e.g. "E001").

- claim
  The text of the assertion.

- grounding
  The source-unit IDs where the content presents or relies upon the assertion.

- articleTreatment

  - adopted
    The content presents the assertion as true or relies upon it.

  - challenged
    The content presents the assertion in order to dispute, rebut, or undermine it.

  - reported
    The content presents the assertion without clearly adopting or challenging it.

- provenance
  The free-text semantic source of the assertion when the content attributes it externally (for example, a named person, institution, report, study, anonymous official, scientific consensus, or another publication). Do not force this into a fixed category. Use null when the assertion is presented in the content's own voice with no distinct external source. Do not invent a source.`;

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

export function buildPromptCF5v007({ article, units }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

${CF5_TASK_V0007}`;
  return { system: CF5_SYSTEM_V0007, user, responseSchema: CF5_CLAIMS_SCHEMA_V1 };
}

export { CF5_SYSTEM_V0007, CF5_TASK_V0007 };
