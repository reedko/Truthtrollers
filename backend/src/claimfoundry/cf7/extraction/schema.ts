import { z } from "zod";

const harvestRowSchema = z.object({
  assertionText: z.string().trim().min(1),
  groundingUnitIds: z.array(z.string().regex(/^U\d{4,}$/)).min(1).max(8),
}).strict();

export const cf7HarvestResultSchema = z.object({
  disputedAssertions: z.array(harvestRowSchema).max(20),
  assertions: z.array(harvestRowSchema).max(40),
}).strict();

export type Cf7ValidatedHarvestResult = z.infer<typeof cf7HarvestResultSchema>;

export const CF7_HARVEST_JSON_SCHEMA = Object.freeze({
  name: "cf7_harvest_v1",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["disputedAssertions", "assertions"],
    properties: {
      disputedAssertions: {
        type: "array",
        maxItems: 20,
        items: { $ref: "#/$defs/row" },
      },
      assertions: {
        type: "array",
        maxItems: 40,
        items: { $ref: "#/$defs/row" },
      },
    },
    $defs: {
      row: {
        type: "object",
        additionalProperties: false,
        required: ["assertionText", "groundingUnitIds"],
        properties: {
          assertionText: { type: "string" },
          groundingUnitIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 8,
          },
        },
      },
    },
  },
});
