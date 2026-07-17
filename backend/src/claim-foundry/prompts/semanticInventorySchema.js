const strings = (maxItems = 20, maxLength = 500) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});

export const CF1_SEMANTIC_INVENTORY_SCHEMA = Object.freeze({
  name: "cf1_semantic_inventory_v1", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["theme", "thesis", "thesisHinge", "pillars", "candidateClaims"],
    properties: {
      thesisHinge: { type: "string", enum: ["substance", "attribution", "mixed"] },
      theme: { type: "object", additionalProperties: false, required: ["text", "sourceUnitIds"],
        properties: { text: { type: "string", minLength: 1, maxLength: 500 }, sourceUnitIds: strings(12, 20) } },
      thesis: { type: "object", additionalProperties: false, required: ["text", "sourceUnitIds"],
        properties: { text: { type: "string", minLength: 1, maxLength: 500 }, sourceUnitIds: strings(12, 20) } },
      pillars: { type: "array", minItems: 1, maxItems: 8, items: {
        type: "object", additionalProperties: false,
        required: ["label", "text", "importance", "sourceUnitIds"],
        properties: { label: { type: "string", minLength: 1, maxLength: 140 },
          text: { type: "string", minLength: 1, maxLength: 500 },
          importance: { type: "string", enum: ["load_bearing", "major", "supporting"] },
          sourceUnitIds: strings(12, 20) },
      } },
      candidateClaims: { type: "array", minItems: 1, maxItems: 12, items: {
        type: "object", additionalProperties: false,
        required: ["claimText", "sourceUnitIds", "articleRole", "articleUse", "assertionSource",
          "materiality", "relatedPillarLabels", "scope", "evidenceUsefulnessHint"],
        properties: {
          claimText: { type: "string", minLength: 1, maxLength: 500 }, sourceUnitIds: strings(12, 20),
          articleRole: { type: "string", enum: ["thesis", "pillar", "pillar_support", "opponent_claim", "qualification", "consistency_hinge"] },
          articleUse: { type: "string", enum: ["endorsed", "opponent_to_rebut", "rejected", "reported", "background", "qualification", "unclear"] },
          assertionSource: { type: "string", minLength: 1, maxLength: 300 },
          materiality: { type: "string", enum: ["high", "medium", "low"] },
          relatedPillarLabels: strings(4, 140),
          scope: { type: "string", minLength: 1, maxLength: 400 },
          evidenceUsefulnessHint: { type: "string", minLength: 1, maxLength: 240 },
        },
      } },
    },
  },
});

export function semanticInventorySchemaForArticle(article) {
  const schema = structuredClone(CF1_SEMANTIC_INVENTORY_SCHEMA);
  if (String(article?.text ?? "").length >= 5_000) schema.schema.properties.candidateClaims.minItems = 8;
  return schema;
}
