const strings = (maxItems = 20, maxLength = 500) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});

const namedWork = {
  type: "object", additionalProperties: false,
  required: ["mentionText", "workType", "year", "peopleOrOrganizations", "identifiers"],
  properties: {
    mentionText: { type: "string", minLength: 1, maxLength: 500 },
    workType: { type: "string", enum: ["study", "report", "dataset", "law", "filing", "transcript", "other"] },
    year: { type: ["integer", "null"], minimum: 1000, maximum: 2100 },
    peopleOrOrganizations: strings(8, 300),
    identifiers: strings(8, 300),
  },
};

const candidate = {
  type: "object", additionalProperties: false,
  required: ["claimText", "sourceUnitIds"],
  properties: {
    claimText: { type: "string", minLength: 1, maxLength: 1_000 },
    sourceUnitIds: strings(12, 20),
  },
};

const pillar = {
  type: "object", additionalProperties: false,
  required: ["label", "text", "importance"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 160 },
    text: { type: "string", minLength: 1, maxLength: 700 },
    importance: { type: "string", enum: ["load_bearing", "major", "supporting"] },
  },
};

const criticFinding = {
  type: "object", additionalProperties: false,
  required: ["type", "severity", "problem", "recommendedAction"],
  properties: {
    type: { type: "string", enum: ["missing_central_claim", "weak_thesis_coverage",
      "duplicate_or_fragmented", "ungrounded_claim", "trivial_overselection",
      "missing_attribution", "weak_evidence_target", "unrepresentative_portfolio"] },
    severity: { type: "string", enum: ["blocking", "material", "minor"] },
    problem: { type: "string", minLength: 1, maxLength: 500 },
    recommendedAction: { type: "string", minLength: 1, maxLength: 500 },
  },
};

const selectedClaim = {
  type: "object", additionalProperties: false,
  required: ["claimText", "sourceUnitIds", "assertionSource", "articleUse", "namedWorkHints",
    "articleRole", "relatedPillarLabels", "themeBearing", "materiality", "claimMode",
    "scope", "claimTrueIf", "claimFalseIf", "claimQualifiedIf"],
  properties: {
    claimText: { type: "string", minLength: 1, maxLength: 240 },
    sourceUnitIds: strings(12, 20),
    assertionSource: { type: "string", minLength: 1, maxLength: 300 },
    articleUse: { type: "string", enum: ["endorsed", "opponent_to_rebut", "rejected",
      "reported", "background", "qualification", "unclear"] },
    namedWorkHints: { type: "array", maxItems: 8, items: namedWork },
    articleRole: { type: "string", enum: ["thesis", "pillar", "pillar_support",
      "opponent_claim", "qualification", "consistency_hinge"] },
    relatedPillarLabels: strings(3, 160),
    themeBearing: { type: "string", minLength: 20, maxLength: 240 },
    materiality: { type: "string", enum: ["high", "medium"] },
    claimMode: { type: "string", enum: ["factual", "causal", "statistical", "attribution",
      "study_result", "policy_legal", "methodology"] },
    scope: { type: "string", minLength: 1, maxLength: 500 },
    claimTrueIf: { type: "string", minLength: 1, maxLength: 500 },
    claimFalseIf: { type: "string", minLength: 1, maxLength: 500 },
    claimQualifiedIf: { type: "string", minLength: 1, maxLength: 500 },
  },
};

export const CF1_ONE_CALL_AGENT_SCHEMA = Object.freeze({
  name: "cf1_one_call_agent_v2", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["orientation", "initialCandidates", "critic", "revisionTrace", "selectedClaims"],
    properties: {
      orientation: { type: "object", additionalProperties: false,
        required: ["theme", "thesis", "pillars"],
        properties: {
          theme: { type: "string", minLength: 1, maxLength: 700 },
          thesis: { type: "string", minLength: 1, maxLength: 700 },
          pillars: { type: "array", maxItems: 8, items: pillar },
        } },
      initialCandidates: { type: "array", minItems: 1, maxItems: 20, items: candidate },
      critic: { type: "object", additionalProperties: false, required: ["summary", "findings"],
        properties: { summary: { type: "string", minLength: 1, maxLength: 800 },
          findings: { type: "array", minItems: 1, maxItems: 12, items: criticFinding } } },
      revisionTrace: { type: "array", minItems: 1, maxItems: 20, items: {
        type: "object", additionalProperties: false,
        required: ["findingType", "beforeClaimText", "afterClaimText", "action", "explanation"],
        properties: { findingType: criticFinding.properties.type,
          beforeClaimText: { type: ["string", "null"], maxLength: 1_000 },
          afterClaimText: { type: ["string", "null"], maxLength: 1_000 },
          action: { type: "string", enum: ["add", "drop"] },
          explanation: { type: "string", minLength: 1, maxLength: 400 } },
      } },
      selectedClaims: { type: "array", minItems: 1, maxItems: 12, items: selectedClaim },
    },
  },
});

export function oneCallAgentSchemaForArticle(article) {
  const responseSchema = structuredClone(CF1_ONE_CALL_AGENT_SCHEMA);
  if (String(article?.text ?? "").length >= 5_000) {
    responseSchema.schema.properties.initialCandidates.minItems = 12;
    responseSchema.schema.properties.selectedClaims.minItems = 8;
    responseSchema.schema.properties.selectedClaims.maxItems = 10;
  }
  return responseSchema;
}
