import { ER1_REQUEST_SCHEMA_VERSION } from "../contract.js";

export const ER1_REQUEST_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ER1_REQUEST_SCHEMA_VERSION,
  title: "ER1 request",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "packageId", "expectedPackageSchemaVersion",
    "expectedPackageHash", "idempotencyKey", "options"],
  properties: {
    schemaVersion: { const: ER1_REQUEST_SCHEMA_VERSION },
    packageId: { type: "string", pattern: "^cf1pkg_[A-Za-z0-9_-]+$", maxLength: 160 },
    expectedPackageSchemaVersion: { const: "cf1.claimPackage.v1" },
    expectedPackageHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
    options: {
      type: "object", additionalProperties: false,
      required: ["profile"],
      properties: {
        profile: { enum: ["standard", "fast", "deep"] },
        deadlineMs: { type: "integer", minimum: 10_000, maximum: 300_000 },
        maxFetches: { type: "integer", minimum: 1, maximum: 50 },
        allowFollowUpWave: { type: "boolean" },
        balancePolicy: {
          type: "object", additionalProperties: false,
          required: ["mode", "desiredBearing"],
          properties: {
            mode: { enum: ["natural", "seek_multiple_bearings", "custom"] },
            desiredBearing: {
              type: "array", uniqueItems: true, maxItems: 3,
              items: { enum: ["support", "refute", "qualify"] },
            },
            minimumIndependentSourcesPerBearing: { type: "integer", minimum: 0, maximum: 3 },
          },
        },
      },
    },
    discoveryLimits: {
      type: "object", additionalProperties: false,
      properties: {
        maxTargets: { type: "integer", minimum: 1, maximum: 12 },
        maxProviderQueriesGlobal: { type: "integer", minimum: 1, maximum: 70 },
        maxProviderQueriesPerTarget: { type: "integer", minimum: 1, maximum: 5 },
        maxCandidatesPerQuery: { type: "integer", minimum: 1, maximum: 8 },
        maxCandidatesGlobal: { type: "integer", minimum: 1, maximum: 200 },
        maxCandidatesPerTarget: { type: "integer", minimum: 1, maximum: 30 },
        maxSameDomainPerTarget: { type: "integer", minimum: 1, maximum: 4 },
        minNormalizedCandidatesPerTarget: { type: "integer", minimum: 0, maximum: 12 },
        minNormalizedCandidatesPerTargetLaneFamily: { type: "integer", minimum: 0, maximum: 4 },
        minContextWorkCandidatesGlobal: { type: "integer", minimum: 0, maximum: 12 },
        maxContextWorkCandidatesGlobal: { type: "integer", minimum: 0, maximum: 20 },
        deadlineMs: { type: "integer", minimum: 1_000, maximum: 30_000 },
        concurrency: { type: "integer", minimum: 1, maximum: 12 },
      },
    },
    consumerRef: { type: ["string", "null"], maxLength: 200 },
  },
});
