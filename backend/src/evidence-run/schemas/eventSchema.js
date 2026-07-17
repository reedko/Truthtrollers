import { ER1_EVENT_SCHEMA_VERSION, ER1_EVENT_TYPES } from "../contract.js";

export const ER1_EVENT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ER1_EVENT_SCHEMA_VERSION,
  title: "ER1 progressive event",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "runId", "packageId", "sequence", "timestamp", "type", "data"],
  properties: {
    schemaVersion: { const: ER1_EVENT_SCHEMA_VERSION },
    runId: { type: "string", pattern: "^er1run_" },
    packageId: { type: "string", pattern: "^cf1pkg_" },
    sequence: { type: "integer", minimum: 1 },
    timestamp: { type: "string", format: "date-time" },
    type: { enum: ER1_EVENT_TYPES },
    taskId: { type: ["string", "null"] },
    sourceId: { type: ["string", "null"] },
    assertionId: { type: ["string", "null"] },
    data: { type: "object" },
  },
});
