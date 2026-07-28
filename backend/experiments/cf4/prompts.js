import {
  CF4_SELECTION_SCHEMA_V1,
  CF4_STANCE_ASSERTIONS_SCHEMA_V1,
} from "./schemas.js";

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

export function serializeInventory(inventory = []) {
  return inventory.map((item) =>
    `${item.assertionId} [${item.groundingUnitIds.join(", ")}]: ${item.assertionText}`)
    .join("\n");
}

export function serializeStanceAssertions(assertions = []) {
  return assertions.map((item) =>
    `${item.stanceId} [${item.groundingUnitIds.join(", ")}]: ${item.assertionText}`)
    .join("\n");
}

const STANCE_SYSTEM = `You produce article-grounded factual assertions that can be used
as semantic comparison targets.

Use only the supplied article and its source-unit identifiers. Do not use outside
knowledge. Do not fact-check.`;

export function buildCf4StanceAssertionsPrompt({ article, units }) {
  const user = `ARTICLE METADATA

${articleMetadata(article)}

ARTICLE

${serializeUnits(units)}

TASK

Return a bounded set of concise, article-grounded assertions that covers the factual case
on which the article most depends. Each assertion must be specific enough to serve as a
useful comparison target for selecting load-bearing assertions from the article.

Exclude incidental details and repetitive paraphrases. Return fewer assertions when
fewer are warranted. For each assertion, return the source-unit identifiers that ground
it.`;
  return {
    system: STANCE_SYSTEM,
    user,
    responseSchema: CF4_STANCE_ASSERTIONS_SCHEMA_V1,
  };
}

const SELECTION_SYSTEM = `You identify which supplied assertions an article's case most
depends on.

Use only the supplied stance assertions and candidate assertion list. Do not use outside
knowledge. Do not fact-check. Do not create or rewrite assertions.`;

export function buildCf4SelectionPrompt({ stanceAssertions, inventory }) {
  const user = `STANCE ASSERTIONS

${serializeStanceAssertions(stanceAssertions)}

CANDIDATE ASSERTIONS

${serializeInventory(inventory)}

TASK

Return the existing assertionIds of the candidate assertions the article's case most
depends on — the ones whose falsity would most damage its case, whoever states them and
however they are framed. Include an assertion the article disputes when its case depends
on defeating it.

Use the complete stance-assertion set as semantic comparison targets, not as quotas.
Do not select weak or redundant candidates merely to populate every target. Exclude
background, context, and rhetoric that the case does not rest on. Return fewer assertions
when fewer are warranted.`;
  return {
    system: SELECTION_SYSTEM,
    user,
    responseSchema: CF4_SELECTION_SCHEMA_V1,
  };
}
