const stringArray = (maxItems, maxLength = 500) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});
const idArray = (maxItems) => stringArray(maxItems, 100);

const mappedProposition = {
  type: "object", additionalProperties: false, required: ["text", "sourceBlockIds", "rawAssertionIds"],
  properties: { text: { type: "string", maxLength: 2_000 }, sourceBlockIds: idArray(12), rawAssertionIds: idArray(20) },
};

const identifierHints = {
  type: "object", additionalProperties: false,
  required: ["doi", "pmid", "titleExact", "authorYear", "quotedDocumentNames", "canonicalSourceIds"],
  properties: Object.fromEntries(["doi", "pmid", "titleExact", "authorYear", "quotedDocumentNames", "canonicalSourceIds"].map((field) => [field, stringArray(12)])),
};

export const CF1_AGENT_DRAFT_SCHEMA = Object.freeze({
  name: "cf1_agent_draft_v2",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["semanticBlockAnnotations", "rawAssertions", "articleMap", "internalConsistencyFindings",
      "selectedEvaluationClaims", "phase3Targets", "evidenceNeedCards", "selectionCountException", "agentWarnings"],
    properties: {
      semanticBlockAnnotations: { type: "array", maxItems: 999, items: {
        type: "object", additionalProperties: false,
        required: ["blockId", "semanticFunction", "articleStance", "speakerEntities", "relatedBlockIds", "confidence"],
        properties: { blockId: { type: "string" }, semanticFunction: { type: "string" }, articleStance: { type: "string" },
          speakerEntities: stringArray(20, 300), relatedBlockIds: idArray(30), confidence: { type: "number", minimum: 0, maximum: 1 } },
      } },
      rawAssertions: { type: "array", maxItems: 999, items: {
        type: "object", additionalProperties: false,
        required: ["rawAssertionId", "text", "sourceUnitIds", "speakerEntity", "assertionForm", "articleUse",
          "namedEntities", "namedWorks", "numbersAndDates", "reconciliation"],
        properties: { rawAssertionId: { type: "string" }, text: { type: "string", maxLength: 2_000 }, sourceUnitIds: idArray(40),
          speakerEntity: { type: ["string", "null"], maxLength: 300 },
          assertionForm: { type: "string" }, articleUse: { type: "string" }, namedEntities: stringArray(30, 300),
          namedWorks: stringArray(20), numbersAndDates: stringArray(20, 100), reconciliation: {
            type: "object", additionalProperties: false,
            required: ["canonicalRawAssertionId", "relationship", "relatedRawAssertionIds", "rationale"],
            properties: { canonicalRawAssertionId: { type: "string" }, relationship: { type: "string" },
              relatedRawAssertionIds: idArray(30), rationale: { type: "string", maxLength: 1_000 } },
          } },
      } },
      articleMap: {
        type: "object", additionalProperties: false,
        required: ["theme", "thesis", "pillars", "clusters", "opponentPositions", "qualifications", "mapWarnings"],
        properties: {
          theme: { type: "string", maxLength: 1_000 }, thesis: mappedProposition,
          pillars: { type: "array", maxItems: 12, items: { ...mappedProposition,
            required: [...mappedProposition.required, "pillarId", "label", "importance"],
            properties: { ...mappedProposition.properties, pillarId: { type: "string" }, label: { type: "string", maxLength: 200 }, importance: { type: "string" } } } },
          clusters: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false,
            required: ["clusterId", "label", "rawAssertionIds", "relationship"],
            properties: { clusterId: { type: "string" }, label: { type: "string", maxLength: 200 }, rawAssertionIds: idArray(99), relationship: { type: "string" } } } },
          opponentPositions: { type: "array", maxItems: 12, items: mappedProposition },
          qualifications: { type: "array", maxItems: 12, items: mappedProposition }, mapWarnings: stringArray(20),
        },
      },
      internalConsistencyFindings: { type: "array", maxItems: 99, items: {
        type: "object", additionalProperties: false,
        required: ["findingId", "type", "blockIds", "rawAssertionIds", "description", "materiality", "resolution", "resolutionRationale", "selectionRelevance"],
        properties: { findingId: { type: "string" }, type: { type: "string" }, blockIds: idArray(12), rawAssertionIds: idArray(12),
          description: { type: "string", maxLength: 2_000 }, materiality: { type: "string" }, resolution: { type: "string" },
          resolutionRationale: { type: "string", maxLength: 1_000 }, selectionRelevance: { type: "string" } },
      } },
      selectedEvaluationClaims: { type: "array", maxItems: 99, items: {
        type: "object", additionalProperties: false,
        required: ["selectedClaimId", "claimText", "sourceRawAssertionIds", "articleRole",
          "relatedPillarIds", "materiality", "counterfactualImpact", "selectionRationale", "scoreTransform", "searchEligible", "verdictEligible", "confidence"],
        properties: { selectedClaimId: { type: "string" }, claimText: { type: "string", maxLength: 2_000 }, sourceRawAssertionIds: idArray(20),
          articleRole: { type: "string" },
          relatedPillarIds: idArray(12), materiality: { type: "string" }, counterfactualImpact: { type: "string", maxLength: 1_000 },
          selectionRationale: { type: "string", maxLength: 1_000 }, scoreTransform: { type: "string" }, searchEligible: { type: "boolean" },
          verdictEligible: { type: "boolean" }, confidence: { type: "number", minimum: 0, maximum: 1 } },
      } },
      phase3Targets: { type: "array", maxItems: 999, items: {
        type: "object", additionalProperties: false,
        required: ["targetId", "selectedClaimId", "targetText", "targetType", "scoreTransform", "searchEligible", "verdictEligible",
          "sourceRawAssertionIds", "mappingStatus", "mappingRationale"],
        properties: { targetId: { type: "string" }, selectedClaimId: { type: "string" }, targetText: { type: "string", maxLength: 2_000 },
          targetType: { type: "string" }, scoreTransform: { type: "string" }, searchEligible: { type: "boolean" }, verdictEligible: { type: "boolean" },
          sourceRawAssertionIds: idArray(20),
          mappingStatus: { type: "string" }, mappingRationale: { type: "string", maxLength: 1_000 } },
      } },
      evidenceNeedCards: { type: "array", maxItems: 999, items: {
        type: "object", additionalProperties: false,
        required: ["targetId", "evidenceRolesNeeded", "bearingCriteria", "queryLaneSeeds", "identifierHints"],
        properties: { targetId: { type: "string" }, evidenceRolesNeeded: stringArray(8, 100), bearingCriteria: {
          type: "object", additionalProperties: false, required: ["mustMatch", "shouldMatch", "rejectIfOnly", "weak"],
          properties: { mustMatch: stringArray(12), shouldMatch: stringArray(12), rejectIfOnly: stringArray(12), weak: { type: "boolean" } },
        }, queryLaneSeeds: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false,
          required: ["laneType", "query", "purpose", "sourceFieldsUsed"], properties: { laneType: { type: "string" }, query: { type: "string", maxLength: 1_000 },
            purpose: { type: "string", maxLength: 500 }, sourceFieldsUsed: stringArray(12, 100) } } }, identifierHints },
      } },
      selectionCountException: { type: ["string", "null"], maxLength: 1_000 },
      agentWarnings: stringArray(20),
    },
  },
});
