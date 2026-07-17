import { ER1_STATE_SCHEMA_VERSION, ER1_RUN_STATUSES } from "../contract.js";

const idArray = { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true };

export const ER1_STATE_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ER1_STATE_SCHEMA_VERSION,
  title: "ER1 agent state",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "pipelineVersion", "runId", "packageIdentity", "status", "budgets", "usage",
    "tasks", "identityRegistry", "candidates", "sources", "assertions", "criticFindings",
    "events", "steps", "startedAt", "updatedAt"],
  properties: {
    schemaVersion: { const: ER1_STATE_SCHEMA_VERSION },
    pipelineVersion: { type: "string", minLength: 1, maxLength: 80 },
    runId: { type: "string", pattern: "^er1run_" },
    packageIdentity: {
      type: "object", additionalProperties: false,
      required: ["packageId", "schemaVersion", "packageHash"],
      properties: {
        packageId: { type: "string", pattern: "^cf1pkg_" },
        schemaVersion: { const: "cf1.claimPackage.v1" },
        packageHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      },
    },
    status: { enum: ER1_RUN_STATUSES },
    budgets: {
      type: "object", additionalProperties: false,
      required: ["deadlineMs", "maxFetches", "maxFollowUpWaves"],
      properties: {
        deadlineMs: { type: "integer", minimum: 1 },
        maxFetches: { type: "integer", minimum: 0 },
        maxFollowUpWaves: { type: "integer", minimum: 0, maximum: 1 },
      },
    },
    usage: {
      type: "object", additionalProperties: false,
      required: ["elapsedMs", "providerCalls", "fetches", "modelCalls", "inputTokens", "outputTokens"],
      properties: {
        elapsedMs: { type: "integer", minimum: 0 }, providerCalls: { type: "integer", minimum: 0 },
        fetches: { type: "integer", minimum: 0 }, modelCalls: { type: "integer", minimum: 0 },
        inputTokens: { type: "integer", minimum: 0 }, outputTokens: { type: "integer", minimum: 0 },
      },
    },
    tasks: { type: "array", items: { $ref: "#/$defs/task" } },
    identityRegistry: { type: "array", items: { type: "object" } },
    candidates: { type: "array", items: { type: "object" } },
    sources: { type: "array", items: { type: "object" } },
    assertions: { type: "array", items: { $ref: "er1.result.v1#/$defs/assertion" } },
    criticFindings: { type: "array", items: { type: "object" } },
    events: idArray,
    steps: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["stepId", "stage", "status", "startedAt", "endedAt", "inputRefs", "outputRefs"],
        properties: {
          stepId: { type: "string", minLength: 1 }, stage: { type: "string", minLength: 1 },
          status: { enum: ["running", "completed", "skipped", "failed"] },
          startedAt: { type: "string", format: "date-time" },
          endedAt: { type: ["string", "null"], format: "date-time" },
          inputRefs: idArray, outputRefs: idArray,
        },
      },
    },
    startedAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    completedAt: { type: ["string", "null"], format: "date-time" },
    error: { oneOf: [{ $ref: "er1.error.v1" }, { type: "null" }] },
  },
  $defs: {
    task: {
      type: "object", additionalProperties: false,
      required: ["taskId", "selectedClaimId", "targetIds", "claimText", "status"],
      properties: {
        taskId: { type: "string", pattern: "^er1task_" },
        selectedClaimId: { type: "string", minLength: 1 }, targetIds: idArray,
        claimText: { type: "string", minLength: 1, maxLength: 2_000 },
        status: { enum: ["planned", "active", "satisfied", "partial", "unresolved"] },
      },
    },
  },
});
