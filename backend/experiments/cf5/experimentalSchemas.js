// CF5 experimental fields — isolated per v3's §5 test plan. NOT part of the canonical
// output contract (schemas.js). These are evaluated on a held-out fixture subset and
// must not leak into canonical claim generation or persisted canonical artifacts.

export const CF5_EXPERIMENTAL_FIELDS_SCHEMA_V1 = Object.freeze({
  name: "cf5_experimental_fields_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["experimentalClaims"],
    properties: {
      experimentalClaims: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "claimId", "claim", "grounding", "articleTreatment", "provenance",
            "verificationQuestion", "supportCondition", "refutationCondition",
            "qualificationCondition", "citedWorkNames",
          ],
          properties: {
            claimId: { type: "string", minLength: 1 },
            claim: { type: "string", minLength: 1 },
            grounding: { type: "array", minItems: 1, items: { type: "string" } },
            articleTreatment: { type: "string", enum: ["adopted", "challenged", "reported"] },
            provenance: { type: ["string", "null"] },
            verificationQuestion: { type: "string", minLength: 1 },
            supportCondition: { type: "string", minLength: 1 },
            refutationCondition: { type: "string", minLength: 1 },
            qualificationCondition: { type: "string", minLength: 1 },
            citedWorkNames: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
});
