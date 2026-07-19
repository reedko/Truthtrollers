// Auditable source/posture contract. Source resolution is explicit and cites the
// packet units that establish the supplier; posture fields remain unchanged.
const CONTENT_STANCE = ["supports_thesis", "contradicts_thesis", "neutral"];
const ARTICLE_DEPLOYMENT = ["endorsed", "rebutted", "reported_neutral"];
const ARTICLE_ROLE = ["thesis", "pillar", "pillar_support", "opponent_claim", "qualification", "consistency_hinge"];
const SOURCE_RESOLUTION = [
  "resolved_from_candidate",
  "resolved_from_context",
  "no_candidate_available",
  "candidates_present_unresolved",
  "not_evaluated_unresolved",
];
const unitIds = (maxItems = 12) => ({ type: "array", maxItems,
  items: { type: "string", pattern: "^U\\d{4}$" } });

const candidateJudgment = {
  type: "object", additionalProperties: false,
  required: ["candidateId", "assertionSource", "assertionSourceUnitIds",
    "assertionSourceResolution", "contentStance", "articleDeployment", "articleRole",
    "sourceUnitIds", "responseUnitIds", "needsSplit"],
  properties: {
    candidateId: { type: "string", pattern: "^CAND\\d{2}$" },
    assertionSource: { type: "string", minLength: 1, maxLength: 300 },
    assertionSourceUnitIds: unitIds(8),
    assertionSourceResolution: { type: "string", enum: SOURCE_RESOLUTION },
    contentStance: { type: "string", enum: CONTENT_STANCE },
    articleDeployment: { type: "string", enum: ARTICLE_DEPLOYMENT },
    articleRole: { type: "string", enum: ARTICLE_ROLE },
    sourceUnitIds: unitIds(),
    responseUnitIds: unitIds(),
    needsSplit: { type: "object", additionalProperties: false, required: ["split", "reason"],
      properties: { split: { type: "boolean" },
        reason: { type: ["string", "null"], minLength: 1, maxLength: 200 } } },
  },
};

export const CF1_SPLIT_CALL1B_SOURCE_POSTURE_SCHEMA_V2 = Object.freeze({
  name: "cf1_call1b_source_posture_attribution_v2", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["candidateJudgments"],
    properties: {
      candidateJudgments: { type: "array", maxItems: 30, items: candidateJudgment },
    },
  },
});

export const CF1_SPLIT_CALL1B_ENUMS_V2 = Object.freeze({
  CONTENT_STANCE, ARTICLE_DEPLOYMENT, ARTICLE_ROLE, SOURCE_RESOLUTION,
});
