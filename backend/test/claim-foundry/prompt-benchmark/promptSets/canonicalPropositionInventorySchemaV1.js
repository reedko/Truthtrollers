const strings = (maxItems = 20, maxLength = 500) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});

// E2 canonical-proposition ablation. The model emits P once; the output adapter
// deterministically copies P into the existing live claimText field.
export const CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V1 = Object.freeze({
  name: "cf1_semantic_inventory_canonical_proposition_v1", strict: true,
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
          "articleRole", "scoreTransformCheck", "assertionSource", "sourceUnitIds",
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

export function canonicalPropositionInventorySchemaForArticle(article) {
  const schema = structuredClone(CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V1);
  if (String(article?.text ?? "").length >= 5_000) {
    schema.schema.properties.candidateClaims.minItems = 8;
  }
  return schema;
}

// A separate recall probe: V1 remains immutable for comparison with its prior run.
export const CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V2 = Object.freeze((() => {
  const schema = structuredClone(CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V1);
  schema.name = "cf1_semantic_inventory_canonical_proposition_v2";
  schema.schema.properties.candidateClaims.maxItems = 20;
  return schema;
})());

export function canonicalPropositionInventorySchemaV2ForArticle(article) {
  const schema = structuredClone(CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V2);
  if (String(article?.text ?? "").length >= 5_000) {
    schema.schema.properties.candidateClaims.minItems = 8;
  }
  return schema;
}

export const CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V3 = Object.freeze((() => {
  const schema = structuredClone(CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V1);
  schema.name = "cf1_semantic_inventory_canonical_proposition_v3";
  schema.schema.properties.candidateClaims.maxItems = 30;
  return schema;
})());

export function canonicalPropositionInventorySchemaV3ForArticle(article) {
  const schema = structuredClone(CF1_CANONICAL_PROPOSITION_INVENTORY_SCHEMA_V3);
  if (String(article?.text ?? "").length >= 5_000) {
    schema.schema.properties.candidateClaims.minItems = 8;
  }
  return schema;
}
