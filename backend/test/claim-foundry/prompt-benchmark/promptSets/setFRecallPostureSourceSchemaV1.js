const strings = (maxItems = 20, maxLength = 500) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});

const sourceKind = { type: "string",
  enum: ["article_voice", "person", "institution", "document", "study", "unknown"] };
const effect = { type: "string", enum: ["strengthens", "weakens", "unchanged", "unclear"] };

// Test-only hybrid schema. An opponent census is committed before the general
// inventory. Within each final candidate, thesis effects and posture precede
// typed assertion-source fields and final wording.
export const CF1_RECALL_POSTURE_SOURCE_SCHEMA = Object.freeze({
  name: "cf1_semantic_inventory_recall_posture_source_v1", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["theme", "thesis", "pillars", "thesisHinge", "opponentScan", "candidateClaims"],
    properties: {
      theme: { type: "object", additionalProperties: false, required: ["text", "sourceUnitIds"],
        properties: { text: { type: "string", minLength: 1, maxLength: 500 },
          sourceUnitIds: strings(12, 20) } },
      thesis: { type: "object", additionalProperties: false, required: ["text", "sourceUnitIds"],
        properties: { text: { type: "string", minLength: 1, maxLength: 500 },
          sourceUnitIds: strings(12, 20) } },
      pillars: { type: "array", minItems: 1, maxItems: 8, items: {
        type: "object", additionalProperties: false,
        required: ["label", "text", "importance", "sourceUnitIds"],
        properties: { label: { type: "string", minLength: 1, maxLength: 140 },
          text: { type: "string", minLength: 1, maxLength: 500 },
          importance: { type: "string", enum: ["load_bearing", "major", "supporting"] },
          sourceUnitIds: strings(12, 20) },
      } },
      thesisHinge: { type: "string", enum: ["substance", "attribution", "mixed"] },
      opponentScan: { type: "array", maxItems: 8, items: {
        type: "object", additionalProperties: false,
        required: ["propositionCore", "articleUse", "assertionSourceKind",
          "assertionSourceName", "sourceUnitIds", "briefBasis"],
        properties: {
          propositionCore: { type: "string", minLength: 1, maxLength: 500 },
          articleUse: { type: "string", enum: ["opponent_to_rebut", "rejected"] },
          assertionSourceKind: sourceKind,
          assertionSourceName: { type: "string", minLength: 1, maxLength: 300 },
          sourceUnitIds: strings(12, 20),
          briefBasis: { type: "string", minLength: 1, maxLength: 500 },
        },
      } },
      candidateClaims: { type: "array", minItems: 1, maxItems: 12, items: {
        type: "object", additionalProperties: false,
        required: ["propositionCore", "ifSupportedEffect", "ifRefutedEffect", "articleUse",
          "articleRole", "scoreTransformCheck", "assertionSourceKind", "assertionSourceName",
          "claimText", "sourceUnitIds", "materiality", "relatedPillarLabels", "scope",
          "evidenceUsefulnessHint"],
        properties: {
          propositionCore: { type: "string", minLength: 1, maxLength: 500 },
          ifSupportedEffect: effect,
          ifRefutedEffect: effect,
          articleUse: { type: "string", enum: ["endorsed", "opponent_to_rebut", "rejected",
            "reported", "background", "qualification", "unclear"] },
          articleRole: { type: "string", enum: ["thesis", "pillar", "pillar_support",
            "opponent_claim", "qualification", "consistency_hinge"] },
          scoreTransformCheck: { type: "string", enum: ["normal", "invert", "none", "unresolved"] },
          assertionSourceKind: sourceKind,
          assertionSourceName: { type: "string", minLength: 1, maxLength: 300 },
          claimText: { type: "string", minLength: 1, maxLength: 500 },
          sourceUnitIds: strings(12, 20),
          materiality: { type: "string", enum: ["high", "medium", "low"] },
          relatedPillarLabels: strings(4, 140),
          scope: { type: "string", minLength: 1, maxLength: 400 },
          evidenceUsefulnessHint: { type: "string", minLength: 1, maxLength: 240 },
        },
      } },
    },
  },
});

export function recallPostureSourceSchemaForArticle(article) {
  const schema = structuredClone(CF1_RECALL_POSTURE_SOURCE_SCHEMA);
  if (String(article?.text ?? "").length >= 5_000) {
    schema.schema.properties.candidateClaims.minItems = 10;
  }
  return schema;
}
