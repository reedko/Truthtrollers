// CF3 prompts — v2. System/user text transcribed verbatim from the CF3 Revision Spec
// (2026-07-24, "complete new state"). Model-facing word is "assertion" throughout
// (terminology lint enforces it). Discovery returns two arrays (challenged first); the
// argument call emits testableAssertion as a fresh field.
import { CF3_DISCOVERY_SCHEMA_V2, CF3_ARGUMENT_SCHEMA_V2 } from "./schemas.js";

export function serializeUnits(sourceUnits = []) {
  return sourceUnits.map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n");
}

const DISCOVERY_SYSTEM = `You extract assertions from a section of an article.

Use only the supplied text and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.

Preserve every assertion's original polarity. Never rewrite an assertion the
text disputes into the text's rebuttal of it.`;

export function buildCf3DiscoveryPrompt({ chunk }) {
  const user = `ARTICLE SECTION ${chunk.chunkIndex} OF ${chunk.chunkCount}

${serializeUnits(chunk.units)}

TASK

First, in challengedAssertions, return the assertions this section presents in
order to dispute — each stated as its original source made it. Return an empty
array only if the section disputes nothing.

Then, in assertions, return every other factual assertion in this section that
external evidence could verify — each worded so it can be checked as written,
with the source units that state it.`;
  return { system: DISCOVERY_SYSTEM, user, responseSchema: CF3_DISCOVERY_SCHEMA_V2 };
}

const ARGUMENT_SYSTEM = `You map the factual argument of an article and select the assertions most worth
verifying with external evidence.

Use only the supplied article, its source-unit identifiers, and the supplied
assertion inventory. Do not use outside knowledge. Do not fact-check.

Preserve every assertion's original polarity. Never rewrite an assertion the
article disputes into the article's rebuttal of it.`;

function articleMetadata(article = {}) {
  return [
    `Title: ${article.title || "Unknown"}`,
    `Author or byline: ${(article.authors ?? []).join(", ") || "Not supplied"}`,
    `Publication: ${article.publisher || "Not supplied"}`,
    `Publication date: ${article.publishedAt || "Not supplied"}`,
  ].join("\n");
}

export function serializeInventory(inventory = []) {
  return JSON.stringify(
    inventory.map((item) => ({
      assertionId: item.assertionId,
      assertionText: item.assertionText,
      groundingUnitIds: item.groundingUnitIds,
      challenged: item.challenged,
    })),
    null,
    2,
  );
}

export function buildCf3ArgumentPrompt({ article, sourceUnits, inventory, portfolioSize }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

PORTFOLIO SIZE

Select exactly ${portfolioSize} assertions.

ARTICLE

${serializeUnits(sourceUnits)}

ASSERTION INVENTORY

${serializeInventory(inventory)}

TASK

1. stanceAnchor — the article's central position, as one assertion.

2. selectedAssertionIds — exactly ${portfolioSize} inventory IDs that together
give a fact-checker the most complete and balanced basis for evaluating the
article's argument, including assertions the article disputes when its case
depends on defeating them.

3. For each selected assertion:

testableAssertion — the assertion external evidence would test, stated as the
underlying fact rather than as a report that someone stated it.

thesisEffect — assume the assertion is true. If that makes the stanceAnchor more
credible, strengthens; less credible, weakens; neither, no_effect. Ignore the
assertion's source, tone, and whether it seems true.

articleTreatment — the article adopts this assertion, challenges it, or reports
it. An assertion with an external originator can still be adopted or challenged.

assertionSource — the originator of the assertion, not whoever repeats or reports
it. Match kind to the named entity; a named ad, report, or document is not
article_voice. Use article_voice only when the article's own narrator originates
the assertion, and in that case use the byline as the name. A work cited as
evidence for an assertion is not automatically its source. Use unknown rather
than guess.

argumentBranchId — the distinct part of the argument this assertion belongs to.

4. argumentBranches — for each branch ID used, the factual question it represents.`;
  return { system: ARGUMENT_SYSTEM, user, responseSchema: CF3_ARGUMENT_SCHEMA_V2 };
}
