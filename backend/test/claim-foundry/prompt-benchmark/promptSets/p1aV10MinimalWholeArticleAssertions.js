import { serializeStructuredArticle }
  from "../../../../src/claim-foundry/prompts/semanticInventoryPrompt.js";

export const P1A_V10_MINIMAL_WHOLE_ARTICLE_ASSERTIONS =
  "P1aV10-minimal-whole-article-assertions";

export const P1A_V10_SYSTEM = `Extract every distinct externally verifiable factual assertion from
the complete supplied article. Use only the supplied text.

Each assertion must contain one primary subject and one independently testable predicate or
relationship. If a passage contains independently testable predicates, return them as separate
assertions.

Preserve assertions whether the article endorses, reports, questions, disputes, or rebuts them.
Keep each assertion in its original polarity. Do not replace an opposing assertion with the
article's response to it.

Do not rank, select, summarize, classify, or add assertions. Ground every assertion in the exact
source-unit IDs that state it.`;

export const P1A_V10_USER_PREFIX = `TITLE:
{{ARTICLE_TITLE}}

COMPLETE STRUCTURED ARTICLE:
{{STRUCTURED_ARTICLE}}`;

export const P1A_V10_MINIMAL_ASSERTION_SCHEMA = Object.freeze({
  name: "p1a_v10_minimal_whole_article_assertions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["assertions"],
    properties: {
      assertions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["assertionText", "sourceUnitIds"],
          properties: {
            assertionText: { type: "string", minLength: 1, maxLength: 500 },
            sourceUnitIds: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: { type: "string", minLength: 1, maxLength: 20 },
            },
          },
        },
      },
    },
  },
});

export function buildP1aV10MinimalWholeArticleAssertionsPrompt({
  article,
  structuralBlocks,
  sourceUnits,
}) {
  return {
    system: P1A_V10_SYSTEM,
    user: P1A_V10_USER_PREFIX
      .replace("{{ARTICLE_TITLE}}", String(article?.title ?? ""))
      .replace("{{STRUCTURED_ARTICLE}}",
        serializeStructuredArticle(structuralBlocks, sourceUnits)),
    responseSchema: structuredClone(P1A_V10_MINIMAL_ASSERTION_SCHEMA),
  };
}
