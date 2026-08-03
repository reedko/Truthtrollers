import { z } from "zod";

const unitId = z.string().regex(/^U\d{4,}$/);
const childSchema = z.object({
  assertionText: z.string().trim().min(1),
  groundingUnitIds: z.array(unitId).min(1).max(8),
}).strict();

const keepVerbatimSchema = z.object({
  parentHarvestRowId: z.string().regex(/^H\d{4,}$/),
  action: z.literal("keep_verbatim"),
}).strict();

const splitSchema = z.object({
  parentHarvestRowId: z.string().regex(/^H\d{4,}$/),
  action: z.literal("split"),
  children: z.array(childSchema).min(2).max(8),
}).strict();

export const cf7S3DecisionSchema = z.discriminatedUnion("action", [
  keepVerbatimSchema,
  splitSchema,
]);

export const cf7S3ResultSchema = z.object({
  results: z.array(cf7S3DecisionSchema).min(1).max(12),
}).strict();

export type Cf7S3ValidatedResult = z.infer<typeof cf7S3ResultSchema>;

const decisionChildJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assertionText", "groundingUnitIds"],
  properties: {
    assertionText: { type: "string", minLength: 1 },
    groundingUnitIds: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", pattern: "^U\\d{4,}$" },
    },
  },
} as const;

export const CF7_S3_JSON_SCHEMA = Object.freeze({
  name: "cf7_s3_decomposition_v2",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["parentHarvestRowId", "action"],
              properties: {
                parentHarvestRowId: {
                  type: "string",
                  pattern: "^H\\d{4,}$",
                },
                action: { type: "string", const: "keep_verbatim" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["parentHarvestRowId", "action", "children"],
              properties: {
                parentHarvestRowId: {
                  type: "string",
                  pattern: "^H\\d{4,}$",
                },
                action: { type: "string", const: "split" },
                children: {
                  type: "array",
                  minItems: 2,
                  maxItems: 8,
                  items: decisionChildJsonSchema,
                },
              },
            },
          ],
        },
      },
    },
  },
});
