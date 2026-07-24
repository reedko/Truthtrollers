import { serializeStructuredArticle }
  from "../../../../src/claim-foundry/prompts/semanticInventoryPrompt.js";

export const P1A_V11_MINIMAL_CHUNKED_ASSERTIONS =
  "P1aV11-minimal-four-chunk-assertions";

export const P1A_V11_SYSTEM = `Extract every distinct externally verifiable factual assertion from
the complete supplied article segment. Use only the supplied text.

Each assertion must contain one primary subject and one independently testable predicate or
relationship. If a passage contains independently testable predicates, return them as separate
assertions.

Preserve assertions whether the article endorses, reports, questions, disputes, or rebuts them.
Keep each assertion in its original polarity. Do not replace an opposing assertion with the
article's response to it.

Do not rank, select, summarize, classify, or add assertions. Ground every assertion in the exact
source-unit IDs that state it.`;

export const P1A_V11_USER_PREFIX = `TITLE:
{{ARTICLE_TITLE}}

ARTICLE SEGMENT {{CHUNK_ID}} ({{FIRST_UNIT_ID}} through {{LAST_UNIT_ID}}):
{{STRUCTURED_ARTICLE_SEGMENT}}`;

export const P1A_V11_MINIMAL_ASSERTION_SCHEMA = Object.freeze({
  name: "p1a_v11_minimal_chunked_assertions",
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

export function buildP1aV11MinimalChunkPrompt({ article, chunk, sourceUnits } = {}) {
  if (!chunk?.ownedUnitIds?.length || !chunk?.blocks?.length) {
    throw new TypeError("P1aV11 requires a nonempty owned chunk");
  }
  const owned = new Set(chunk.ownedUnitIds);
  const ownedUnits = (sourceUnits ?? []).filter((unit) => owned.has(unit.unitId));
  if (ownedUnits.length !== chunk.ownedUnitIds.length) {
    throw new TypeError("P1aV11 chunk refers to missing source units");
  }
  return {
    system: P1A_V11_SYSTEM,
    user: P1A_V11_USER_PREFIX
      .replace("{{ARTICLE_TITLE}}", String(article?.title ?? ""))
      .replace("{{CHUNK_ID}}", String(chunk.chunkId))
      .replace("{{FIRST_UNIT_ID}}", String(chunk.firstUnitId))
      .replace("{{LAST_UNIT_ID}}", String(chunk.lastUnitId))
      .replace("{{STRUCTURED_ARTICLE_SEGMENT}}",
        serializeStructuredArticle(chunk.blocks, ownedUnits)),
    responseSchema: structuredClone(P1A_V11_MINIMAL_ASSERTION_SCHEMA),
  };
}

export function normalizeAndVerifyP1aV11ChunkOutput({ output, chunk } = {}) {
  if (!Array.isArray(output?.assertions)) {
    throw new TypeError("P1aV11 output must contain an assertions array");
  }
  const owned = new Set(chunk?.ownedUnitIds ?? []);
  return output.assertions.map((assertion, index) => {
    const assertionText = String(assertion?.assertionText ?? "").trim();
    const sourceUnitIds = [...new Set(assertion?.sourceUnitIds ?? [])];
    if (!assertionText || !sourceUnitIds.length) {
      throw new TypeError(`P1aV11 ${chunk.chunkId} assertion ${index + 1} is empty`);
    }
    const outside = sourceUnitIds.filter((unitId) => !owned.has(unitId));
    if (outside.length) {
      throw new TypeError(`P1aV11 ${chunk.chunkId} assertion ${index + 1} cites units outside its chunk: ${outside.join(", ")}`);
    }
    return {
      candidateId: `${chunk.chunkId}-A${String(index + 1).padStart(3, "0")}`,
      assertionText,
      claimText: assertionText,
      sourceUnitIds,
      chunkId: chunk.chunkId,
    };
  });
}
