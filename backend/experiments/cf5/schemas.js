// CF5 minimal vertical slice — canonical schema. Exactly the five fields authorized by
// CF5_ARCHITECTURE_MIGRATION_PLAN_2026-07-26_v3.md's minimal semantic nucleus
// (claim/grounding/articleTreatment/provenance) plus claimId (addressing
// infrastructure, not semantic content). No other field may be added to this schema
// without re-earning a place through the defect-catalog procedure in that document's
// §5 — see experimentalSchemas.js for the isolated, non-canonical fields under test.

export const CF5_CLAIMS_SCHEMA_V1 = Object.freeze({
  name: "cf5_claims_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["claims"],
    properties: {
      claims: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claimId", "claim", "grounding", "articleTreatment", "provenance"],
          properties: {
            claimId: { type: "string", minLength: 1 },
            claim: { type: "string", minLength: 1 },
            grounding: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
            articleTreatment: {
              type: "string",
              enum: ["adopted", "challenged", "reported"],
            },
            provenance: { type: ["string", "null"] },
          },
        },
      },
    },
  },
});

// Repair schema is the same per-claim shape, addressed to a specific enumerated set of
// claimIds. The repair call must not be able to add fields the canonical schema
// doesn't have.
export const CF5_REPAIR_SCHEMA_V1 = Object.freeze({
  name: "cf5_repair_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["repairedClaims"],
    properties: {
      repairedClaims: {
        type: "array",
        minItems: 1,
        items: CF5_CLAIMS_SCHEMA_V1.schema.properties.claims.items,
      },
    },
  },
});
