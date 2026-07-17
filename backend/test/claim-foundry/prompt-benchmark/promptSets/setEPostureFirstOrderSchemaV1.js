const strings = (maxItems = 20, maxLength = 500) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});

// Test-only order ablation of Set D. The field definitions are unchanged; only
// their emission order changes so thesis consequences and article posture are
// committed before assertionSource can influence them.
export const CF1_POSTURE_FIRST_ORDER_TRACE_SCHEMA = Object.freeze({
  name: "cf1_semantic_inventory_posture_first_trace_v1", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["theme", "thesis", "pillars", "thesisHinge", "candidateClaims"],
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
      candidateClaims: { type: "array", minItems: 1, maxItems: 12, items: {
        type: "object", additionalProperties: false,
        required: ["propositionCore", "ifSupportedEffect", "ifRefutedEffect", "articleUse",
          "articleRole", "scoreTransformCheck", "assertionSource", "claimText", "sourceUnitIds",
          "materiality", "relatedPillarLabels", "scope", "evidenceUsefulnessHint"],
        properties: {
          propositionCore: { type: "string", minLength: 1, maxLength: 500 },
          ifSupportedEffect: { type: "string",
            enum: ["strengthens", "weakens", "unchanged", "unclear"] },
          ifRefutedEffect: { type: "string",
            enum: ["strengthens", "weakens", "unchanged", "unclear"] },
          articleUse: { type: "string", enum: ["endorsed", "opponent_to_rebut", "rejected",
            "reported", "background", "qualification", "unclear"] },
          articleRole: { type: "string", enum: ["thesis", "pillar", "pillar_support",
            "opponent_claim", "qualification", "consistency_hinge"] },
          scoreTransformCheck: { type: "string", enum: ["normal", "invert", "none", "unresolved"] },
          assertionSource: { type: "string", minLength: 1, maxLength: 300 },
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

export function postureFirstOrderTraceSchemaForArticle(article) {
  const schema = structuredClone(CF1_POSTURE_FIRST_ORDER_TRACE_SCHEMA);
  if (String(article?.text ?? "").length >= 5_000) {
    schema.schema.properties.candidateClaims.minItems = 8;
  }
  return schema;
}
