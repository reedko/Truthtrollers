const strings = (maxItems, maxLength) => ({ type: "array", maxItems,
  items: { type: "string", minLength: 1, maxLength } });
const identifierHints = { type: "object", additionalProperties: false,
  required: ["doi", "pmid", "canonicalSourceIds"],
  properties: Object.fromEntries(["doi", "pmid", "canonicalSourceIds"]
    .map((key) => [key, strings(6, 180)])) };
const enrichment = { type: "object", additionalProperties: false,
  required: ["candidateId", "claimText", "verificationQuestion", "claimTrueIf", "claimFalseIf",
    "claimQualifiedIf", "themeBearing", "bestSourceTypes", "requiredEvidenceRoles",
    "mustMatch", "shouldMatch", "rejectIfOnly", "weakBearing", "warnings", "identifierHints",
    "relevantNamedWorkIds", "namedWorkRelevanceNote", "queryLaneSeeds"],
  properties: {
    candidateId: { type: "string", pattern: "^C\\d{2}$" },
    claimText: { type: "string", minLength: 1, maxLength: 240 },
    verificationQuestion: { type: "string", minLength: 1, maxLength: 360 },
    claimTrueIf: { type: "string", minLength: 1, maxLength: 360 },
    claimFalseIf: { type: "string", minLength: 1, maxLength: 360 },
    claimQualifiedIf: { type: "string", minLength: 1, maxLength: 360 },
    themeBearing: { type: "string", minLength: 20, maxLength: 240 },
    bestSourceTypes: { ...strings(8, 100), minItems: 1 },
    requiredEvidenceRoles: { type: "array", minItems: 1, maxItems: 8,
      items: { type: "string", enum: ["target-primary", "study-identity", "attribution-provenance",
        "official-response", "methodology-reanalysis", "primary-record", "context-background",
        "advocacy-restatement", "identifier-search"] } },
    mustMatch: { ...strings(10, 300), minItems: 1 }, shouldMatch: strings(10, 300),
    rejectIfOnly: { ...strings(10, 300), minItems: 1 },
    weakBearing: { type: "boolean" }, warnings: strings(8, 300), identifierHints,
    relevantNamedWorkIds: { type: "array", maxItems: 6,
      items: { type: "string", pattern: "^NW\\d{3}$" } },
    namedWorkRelevanceNote: { type: ["string", "null"], maxLength: 240 },
    queryLaneSeeds: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false,
      required: ["laneType", "query", "purpose"], properties: {
        laneType: { type: "string", minLength: 1, maxLength: 100 },
        query: { type: "string", minLength: 1, maxLength: 320 },
        purpose: { type: "string", minLength: 1, maxLength: 240 },
      } } },
  } };

export const CF1_SELECTED_ENRICHMENT_SCHEMA = Object.freeze({
  name: "cf1_selected_enrichment_v1", strict: true,
  schema: { type: "object", additionalProperties: false, required: ["enrichedClaims"],
    properties: { enrichedClaims: { type: "array", minItems: 1, maxItems: 10, items: enrichment } } },
});
