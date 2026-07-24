const nullableString = (maxLength) => ({ type: ["string", "null"], maxLength });

export const CF1_SPLIT_ATOMIC_REPAIR_SCHEMA = Object.freeze({
  name: "cf1_split_atomic_repair_v1", strict: true,
  schema: { type: "object", additionalProperties: false,
    required: ["candidateRepairs"],
    properties: { candidateRepairs: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["repairId", "action", "claimText", "sourceUnitIds", "evidenceUsefulnessHint"],
      properties: {
        repairId: { type: "string", minLength: 6, maxLength: 20 },
        action: { type: "string", enum: ["keep", "replace_with_first_atomic_assertion",
          "drop_not_material", "drop_not_grounded"] },
        claimText: nullableString(500),
        sourceUnitIds: { type: "array", maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 20 } },
        evidenceUsefulnessHint: nullableString(240),
      },
    } } },
  },
});
