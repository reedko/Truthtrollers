const strings = (maxItems, maxLength = 500) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});

export const CF1_BLOCK_OBSERVATION_SCHEMA = Object.freeze({
  name: "cf1_block_observation_v2",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["blockAnnotations", "candidateAssertions", "namedWorksAndIdentifiers",
      "possibleCrossBlockLinks", "localWarnings"],
    properties: {
      blockAnnotations: { type: "array", maxItems: 999, items: {
        type: "object", additionalProperties: false,
        required: ["blockId", "semanticFunction", "articleStance", "speakerEntities", "relatedBlockIds", "confidence"],
        properties: { blockId: { type: "string" }, semanticFunction: { type: "string" },
          articleStance: { type: "string" }, speakerEntities: strings(20, 300),
          relatedBlockIds: strings(30, 100), confidence: { type: "number", minimum: 0, maximum: 1 } },
      } },
      candidateAssertions: { type: "array", maxItems: 300, items: {
        type: "object", additionalProperties: false,
        required: ["candidateId", "text", "sourceUnitIds", "speakerEntity",
          "assertionForm", "articleUse", "namedEntities", "namedWorks", "numbersAndDates"],
        properties: { candidateId: { type: "string" }, text: { type: "string", maxLength: 2_000 },
          sourceUnitIds: strings(40, 100),
          speakerEntity: { type: ["string", "null"], maxLength: 300 }, assertionForm: { type: "string" },
          articleUse: { type: "string" }, namedEntities: strings(30, 300), namedWorks: strings(20),
          numbersAndDates: strings(20, 100) },
      } },
      namedWorksAndIdentifiers: { type: "array", maxItems: 100, items: {
        type: "object", additionalProperties: false, required: ["blockId", "kind", "value", "sourceUnitIds"],
        properties: { blockId: { type: "string" }, kind: { type: "string" },
          value: { type: "string", maxLength: 500 }, sourceUnitIds: strings(12, 100) },
      } },
      possibleCrossBlockLinks: { type: "array", maxItems: 100, items: {
        type: "object", additionalProperties: false, required: ["blockIds", "relationship", "rationale"],
        properties: { blockIds: strings(12, 100), relationship: { type: "string", maxLength: 100 },
          rationale: { type: "string", maxLength: 1_000 } },
      } },
      localWarnings: strings(20),
    },
  },
});
