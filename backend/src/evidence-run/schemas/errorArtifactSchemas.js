import { ER1_ARTIFACT_SCHEMA_VERSION } from "../contract.js";

export const ER1_ERROR_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "er1.error.v1",
  title: "ER1 error",
  type: "object",
  additionalProperties: false,
  required: ["code", "message", "retryable", "stage"],
  properties: {
    code: { type: "string", pattern: "^ER1_[A-Z0-9_]+$", maxLength: 100 },
    message: { type: "string", minLength: 1, maxLength: 2_000 },
    retryable: { type: "boolean" },
    stage: { type: "string", minLength: 1, maxLength: 80 },
    details: { type: ["object", "null"] },
  },
});

export const ER1_ARTIFACT_MANIFEST_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ER1_ARTIFACT_SCHEMA_VERSION,
  title: "ER1 artifact manifest",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "runId", "packageId", "createdAt", "artifacts"],
  properties: {
    schemaVersion: { const: ER1_ARTIFACT_SCHEMA_VERSION },
    runId: { type: "string", pattern: "^er1run_" },
    packageId: { type: "string", pattern: "^cf1pkg_" },
    createdAt: { type: "string", format: "date-time" },
    artifacts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "relativePath", "sha256", "mediaType", "stage"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          relativePath: { type: "string", minLength: 1, maxLength: 500 },
          sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          mediaType: { enum: ["application/json", "text/markdown"] },
          stage: { type: "string", minLength: 1, maxLength: 80 },
        },
      },
    },
  },
});
