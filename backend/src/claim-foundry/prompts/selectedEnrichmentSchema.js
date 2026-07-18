const strings = (maxItems, maxLength, minItems = 0) => ({
  type: "array", minItems, maxItems,
  items: { type: "string", minLength: 1, maxLength },
});

const disputedQuestion = {
  type: "object", additionalProperties: false,
  required: ["verificationTarget", "disputedProposition", "stipulatedByArticle", "whyThisTarget"],
  properties: {
    verificationTarget: { type: "string",
      enum: ["substantive", "both_needed"] },
    disputedProposition: { type: "string", minLength: 1, maxLength: 240 },
    stipulatedByArticle: { type: ["string", "null"], minLength: 1, maxLength: 240 },
    whyThisTarget: { type: "string", minLength: 1, maxLength: 180 },
  },
};

const enrichmentV3 = {
  type: "object", additionalProperties: false,
  required: ["candidateId", "revisedClaimText", "disputedQuestion", "supportCriteria",
    "refuteCriteria", "qualifyCriteria", "mustMatch", "rejectIfOnly", "sourceStrategy",
    "searchConcepts", "relevantNamedWorkIds", "cautions"],
  properties: {
    candidateId: { type: "string", pattern: "^C\\d{2}$" },
    revisedClaimText: { type: ["string", "null"], minLength: 1, maxLength: 240 },
    disputedQuestion,
    supportCriteria: strings(3, 240, 1),
    refuteCriteria: strings(3, 240, 1),
    qualifyCriteria: strings(3, 240, 1),
    mustMatch: strings(6, 180, 1),
    rejectIfOnly: strings(5, 220, 1),
    sourceStrategy: { type: "string", enum: ["primary_article_result", "named_work_result",
      "official_record", "methodology_review", "independent_corroboration", "mixed_sources"] },
    searchConcepts: strings(8, 100, 2),
    relevantNamedWorkIds: { type: "array", maxItems: 6,
      items: { type: "string", pattern: "^NW\\d{3}$" } },
    cautions: strings(4, 180),
  },
};

export const CF1_SELECTED_ENRICHMENT_SCHEMA = Object.freeze({
  name: "cf1_selected_enrichment_v3", strict: true,
  schema: { type: "object", additionalProperties: false, required: ["enrichedClaims"],
    properties: { enrichedClaims: { type: "array", minItems: 1, maxItems: 10,
      items: enrichmentV3 } } },
});

const enrichmentV4 = structuredClone(enrichmentV3);
enrichmentV4.required = [...enrichmentV4.required, "warrant"];
enrichmentV4.properties.warrant = { type: ["string", "null"], minLength: 1, maxLength: 280 };

export const CF1_SELECTED_ENRICHMENT_WARRANT_SCHEMA = Object.freeze({
  name: "cf1_selected_enrichment_v4", strict: true,
  schema: { type: "object", additionalProperties: false, required: ["enrichedClaims"],
    properties: { enrichedClaims: { type: "array", minItems: 1, maxItems: 10,
      items: enrichmentV4 } } },
});
