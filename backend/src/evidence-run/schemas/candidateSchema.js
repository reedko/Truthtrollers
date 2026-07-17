import { ER1_CANDIDATE_SCHEMA_VERSION, ER1_PREFETCH_STATUSES } from "../contract.js";

const strings = { type: "array", items: { type: "string" }, uniqueItems: true };

export const ER1_CANDIDATE_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ER1_CANDIDATE_SCHEMA_VERSION,
  title: "ER1 pre-fetch source candidate",
  type: "object",
  additionalProperties: false,
  required: ["candidateId", "runId", "packageId", "targetIds", "identityTaskIds",
    "queryLaneIds", "provider", "query", "rank", "title", "url", "normalizedUrl",
    "canonicalUrl", "snippet", "publishedAt", "authors", "venue", "identifiers",
    "sourceRoleHints", "retrievalPromiseScore", "retrievalPromiseReasons",
    "preFetchTargetFit", "preFetchStatus", "dedupeKey", "diagnostics", "routeProvenance"],
  properties: {
    candidateId: { type: "string", pattern: "^er1cand_" },
    runId: { type: "string", pattern: "^er1run_" },
    packageId: { type: "string", pattern: "^cf1pkg_" },
    targetIds: strings, identityTaskIds: strings, queryLaneIds: strings,
    provider: { type: "string", minLength: 1, maxLength: 80 },
    query: { type: "string", minLength: 1, maxLength: 2_000 },
    rank: { type: "integer", minimum: 1 },
    title: { type: "string", maxLength: 1_000 }, url: { type: "string", maxLength: 4_000 },
    normalizedUrl: { type: "string", maxLength: 4_000 },
    canonicalUrl: { type: ["string", "null"], maxLength: 4_000 },
    snippet: { type: "string", maxLength: 2_000 },
    publishedAt: { type: ["string", "null"], maxLength: 80 },
    authors: strings, venue: { type: ["string", "null"], maxLength: 500 },
    identifiers: {
      type: "object", additionalProperties: false, required: ["doi", "pmid", "pmcid"],
      properties: { doi: strings, pmid: strings, pmcid: strings },
    },
    sourceRoleHints: strings,
    retrievalPromiseScore: { type: "number", minimum: 0, maximum: 1 },
    retrievalPromiseReasons: strings,
    preFetchTargetFit: { type: ["object", "null"] },
    preFetchStatus: { enum: ER1_PREFETCH_STATUSES },
    dedupeKey: { type: "string", minLength: 1, maxLength: 5_000 }, diagnostics: strings,
    routeProvenance: { type: "array", items: { type: "object" } },
  },
});
