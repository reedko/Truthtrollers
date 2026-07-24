const unitIds = {
  type: "array",
  minItems: 1,
  maxItems: 12,
  items: { type: "string", pattern: "^U[0-9]{4,}$" },
};

const explicitSourceKinds = ["person", "institution", "study", "document"];
const attributionOperators = [
  "said",
  "claimed",
  "reported",
  "revealed",
  "alleged",
  "found",
  "concluded",
  "stated",
  "denied",
  "wrote",
  "testified",
  "announced",
  "declared",
  "proved",
  "showed",
  "demonstrated",
  "according_to",
];

const evidenceAnchor = {
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
    unitIds,
  },
};

export function cf2V6DecompositionSchema(candidateIds = []) {
  return {
    name: "cf2_v6_bounded_attribution_decomposition",
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
              "attributionLayers",
              "substantiveAssertion",
              "groundingUnitIds",
              "articleTreatment",
              "effectIfTrue",
            ],
            properties: {
              candidateId: { type: "string", enum: candidateIds },
              attributionLayers: {
                type: "array",
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "supplierName",
                    "supplierKind",
                    "operator",
                    "assertedContent",
                    "sourceUnitIds",
                  ],
                  properties: {
                    supplierName: { type: "string", minLength: 1, maxLength: 300 },
                    supplierKind: {
                      type: "string",
                      enum: explicitSourceKinds,
                    },
                    operator: {
                      type: "string",
                      enum: attributionOperators,
                    },
                    assertedContent: { type: "string", minLength: 1, maxLength: 600 },
                    sourceUnitIds: unitIds,
                  },
                },
              },
              substantiveAssertion: { type: "string", minLength: 1, maxLength: 600 },
              groundingUnitIds: unitIds,
              articleTreatment: {
                type: "string",
                enum: ["adopted", "challenged", "reported"],
              },
              effectIfTrue: {
                type: "string",
                enum: ["strengthens", "weakens", "no_effect"],
              },
            },
          },
        },
      },
    },
  };
}

export function cf2V6EvidenceAnchorSchema(candidateIds = []) {
  return {
    name: "cf2_v6_evidence_anchor_enrichment",
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
            required: ["candidateId", "evidenceAnchors"],
            properties: {
              candidateId: { type: "string", enum: candidateIds },
              evidenceAnchors: {
                type: "array",
                maxItems: 6,
                items: evidenceAnchor,
              },
            },
          },
        },
      },
    },
  };
}
