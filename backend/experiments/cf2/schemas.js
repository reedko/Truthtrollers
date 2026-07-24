const sourceUnitIds = {
  type: "array",
  minItems: 1,
  maxItems: 12,
  items: { type: "string", pattern: "^U[0-9]{4,}$" },
};

export const CF2_DISCOVERY_SCHEMA_V1 = Object.freeze({
  name: "cf2_fact_docket_discovery_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["thesisAssertion", "candidates"],
    properties: {
      thesisAssertion: { type: "string", minLength: 1, maxLength: 600 },
      candidates: {
        type: "array",
        maxItems: 18,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rawAssertion", "groundingUnitIds"],
          properties: {
            rawAssertion: { type: "string", minLength: 1, maxLength: 700 },
            groundingUnitIds: sourceUnitIds,
          },
        },
      },
    },
  },
});

export const CF2_SOURCE_KINDS = Object.freeze([
  "person",
  "institution",
  "study",
  "document",
  "article_voice",
  "unknown",
]);

export function cf2FinalizationSchema(candidateIds = []) {
  return {
    name: "cf2_fact_docket_finalization_v1",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["assertions"],
      properties: {
        assertions: {
          type: "array",
          maxItems: 18,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "candidateId",
              "assertionText",
              "groundingUnitIds",
              "articleTreatment",
              "effectIfTrue",
              "sourceName",
              "sourceKind",
              "sourceUnitIds",
            ],
            properties: {
              candidateId: { type: "string", enum: candidateIds },
              assertionText: { type: "string", minLength: 1, maxLength: 600 },
              groundingUnitIds: sourceUnitIds,
              articleTreatment: {
                type: "string",
                enum: ["adopted", "challenged", "reported"],
              },
              effectIfTrue: {
                type: "string",
                enum: ["strengthens", "weakens", "no_effect"],
              },
              sourceName: { type: ["string", "null"], maxLength: 300 },
              sourceKind: { type: "string", enum: [...CF2_SOURCE_KINDS] },
              sourceUnitIds: {
                type: "array",
                maxItems: 12,
                items: { type: "string", pattern: "^U[0-9]{4,}$" },
              },
            },
          },
        },
      },
    },
  };
}

export const CF2_ATTRIBUTION_SOURCE_KINDS = Object.freeze([
  "person",
  "institution",
  "study",
  "document",
  "article_voice",
  "unknown",
]);

export function cf2AttributionSchema(candidateIds = []) {
  return {
    name: "cf2_attribution_recovery_v1",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["attributions"],
      properties: {
        attributions: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "candidateId",
              "supplierName",
              "supplierKind",
              "supplierUnitIds",
              "supplierBasis",
              "evidenceAnchors",
            ],
            properties: {
              candidateId: { type: "string", enum: candidateIds },
              supplierName: { type: ["string", "null"], maxLength: 300 },
              supplierKind: {
                type: "string",
                enum: [...CF2_ATTRIBUTION_SOURCE_KINDS],
              },
              supplierUnitIds: {
                type: "array",
                maxItems: 12,
                items: { type: "string", pattern: "^U[0-9]{4,}$" },
              },
              supplierBasis: {
                type: "string",
                enum: [
                  "direct_attribution",
                  "quotation_speaker",
                  "document_statement",
                  "article_voice",
                  "unresolved",
                ],
              },
              evidenceAnchors: {
                type: "array",
                maxItems: 6,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "kind", "unitIds"],
                  properties: {
                    name: { type: "string", minLength: 1, maxLength: 300 },
                    kind: {
                      type: "string",
                      enum: [
                        "person",
                        "institution",
                        "study",
                        "document",
                        "dataset",
                        "regulation",
                        "other",
                      ],
                    },
                    unitIds: {
                      type: "array",
                      minItems: 1,
                      maxItems: 12,
                      items: { type: "string", pattern: "^U[0-9]{4,}$" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
