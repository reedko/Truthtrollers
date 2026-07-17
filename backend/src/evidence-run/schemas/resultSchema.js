import { ER1_SCHEMA_VERSION, ER1_RUN_STATUSES, ER1_SOURCE_ROLES, ER1_BEARING_TYPES,
  ER1_ASSERTION_STATUSES, ER1_ACQUISITION_LEVELS, ER1_UNRESOLVED_REASONS } from "../contract.js";

const nullableString = (maxLength) => ({ type: ["string", "null"], maxLength });
const stringIds = { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true };

const grounding = {
  type: "object", additionalProperties: false,
  required: ["sourceUnitIds", "sourceExcerpt", "startOffset", "endOffset"],
  properties: {
    sourceUnitIds: stringIds,
    sourceExcerpt: { type: "string", minLength: 1, maxLength: 10_000 },
    startOffset: { type: "integer", minimum: 0 },
    endOffset: { type: "integer", minimum: 1 },
  },
};

const targetLink = {
  type: "object", additionalProperties: false,
  required: ["selectedClaimId", "targetId", "bearing", "confidence", "rationale"],
  properties: {
    selectedClaimId: { type: "string", minLength: 1 },
    targetId: { type: "string", minLength: 1 },
    bearing: { enum: ER1_BEARING_TYPES },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string", minLength: 1, maxLength: 2_000 },
    claimComponentAddressed: nullableString(500),
  },
};

const assertion = {
  type: "object", additionalProperties: false,
  required: ["assertionId", "sourceId", "assertionText", "assertionSource", "sourceRole",
    "status", "grounding", "targetLinks", "extractionProvenance"],
  properties: {
    assertionId: { type: "string", pattern: "^er1ast_" },
    sourceId: { type: "string", pattern: "^er1src_" },
    assertionText: { type: "string", minLength: 1, maxLength: 2_000 },
    assertionSource: nullableString(500),
    sourceRole: { enum: ER1_SOURCE_ROLES },
    status: { enum: ER1_ASSERTION_STATUSES },
    grounding,
    targetLinks: { type: "array", items: targetLink },
    extractionProvenance: {
      type: "object", additionalProperties: false,
      required: ["method", "model", "promptVersion", "extractedAt"],
      properties: {
        method: { enum: ["model", "deterministic", "hybrid"] },
        model: nullableString(120), promptVersion: nullableString(120),
        extractedAt: { type: "string", format: "date-time" },
      },
    },
    rejectionReason: nullableString(100),
  },
};

const source = {
  type: "object", additionalProperties: false,
  required: ["sourceId", "canonicalUrl", "contentHash", "title", "authors", "publisher",
    "publicationDate", "identifiers", "acquisitionLevel", "provenance"],
  properties: {
    sourceId: { type: "string", pattern: "^er1src_" },
    canonicalUrl: nullableString(4_000), originalUrl: nullableString(4_000),
    contentHash: nullableString(64), title: nullableString(1_000),
    authors: { type: "array", items: { type: "string", maxLength: 500 } },
    publisher: nullableString(500), publicationDate: nullableString(40),
    identifiers: { type: "object", additionalProperties: { type: "string", maxLength: 500 } },
    acquisitionLevel: { enum: ER1_ACQUISITION_LEVELS },
    provenance: { type: "object" },
  },
};

export const ER1_RESULT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ER1_SCHEMA_VERSION,
  title: "Immutable ER1 result",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "pipelineVersion", "resultId", "runId", "packageIdentity",
    "status", "createdAt", "completedAt", "targets", "sources", "assertions", "rejections",
    "criticFindings", "usage", "timings", "artifactManifest", "projection", "resultHash"],
  properties: {
    schemaVersion: { const: ER1_SCHEMA_VERSION }, pipelineVersion: { type: "string" },
    resultId: { type: "string", pattern: "^er1res_" }, runId: { type: "string", pattern: "^er1run_" },
    packageIdentity: {
      type: "object", additionalProperties: false,
      required: ["packageId", "schemaVersion", "packageHash"],
      properties: {
        packageId: { type: "string", pattern: "^cf1pkg_" },
        schemaVersion: { const: "cf1.claimPackage.v1" },
        packageHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      },
    },
    status: { enum: ER1_RUN_STATUSES }, createdAt: { type: "string", format: "date-time" },
    completedAt: { type: "string", format: "date-time" },
    targets: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["taskId", "selectedClaimId", "targetIds", "status", "assertionIds", "unresolvedReason"],
        properties: {
          taskId: { type: "string", pattern: "^er1task_" }, selectedClaimId: { type: "string" },
          targetIds: stringIds, status: { enum: ["satisfied", "partial", "unresolved"] },
          assertionIds: stringIds,
          unresolvedReason: { oneOf: [{ enum: ER1_UNRESOLVED_REASONS }, { type: "null" }] },
        },
      },
    },
    sources: { type: "array", items: source }, assertions: { type: "array", items: assertion },
    rejections: { type: "array", items: { type: "object" } },
    criticFindings: { type: "array", items: { type: "object" } },
    usage: { type: "object" }, timings: { type: "object" },
    artifactManifest: { $ref: "er1.artifacts.v1" },
    projection: {
      type: "object", additionalProperties: false,
      required: ["status", "projectedAt", "diagnostics"],
      properties: {
        status: { enum: ["not_requested", "pending", "completed", "failed"] },
        projectedAt: { type: ["string", "null"], format: "date-time" },
        diagnostics: { type: "array", items: { type: "string", maxLength: 1_000 } },
      },
    },
    resultHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
  $defs: { assertion, source, targetLink, grounding },
});
