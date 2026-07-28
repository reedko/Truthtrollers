// CF4 Phase 2 strict schemas. Array maxima are transport ceilings, never count targets.

export const CF4_STANCE_ASSERTIONS_SCHEMA_V1 = Object.freeze({
  name: "cf4_stance_assertions_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["stanceAssertions"],
    properties: {
      stanceAssertions: {
        type: "array",
        minItems: 1,
        maxItems: 15,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["assertionText", "groundingUnitIds"],
          properties: {
            assertionText: { type: "string", minLength: 1 },
            groundingUnitIds: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
          },
        },
      },
    },
  },
});

export const CF4_SELECTION_SCHEMA_V1 = Object.freeze({
  name: "cf4_selection_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["selectedAssertionIds"],
    properties: {
      selectedAssertionIds: {
        type: "array",
        maxItems: 15,
        items: { type: "string" },
      },
    },
  },
});
