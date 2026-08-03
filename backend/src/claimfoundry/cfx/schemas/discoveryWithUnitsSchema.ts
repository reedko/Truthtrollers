import { z } from "zod";

const nonEmptyUnchangedString = z.string().max(4_000).refine(
  (value) => value.trim().length > 0,
  "String must contain non-whitespace content",
);

export const cfxDiscoveryWithUnitsRowSchema = z.object({
  assertion: nonEmptyUnchangedString,
  assertionSource: nonEmptyUnchangedString,
  whyItMattersToArticleThesis: nonEmptyUnchangedString,
  groundingUnitIds: z.array(z.string().regex(/^U[0-9]+$/)).min(1),
}).strict();

export const cfxDiscoveryWithUnitsOutputSchema = z.object({
  propositions: z.array(cfxDiscoveryWithUnitsRowSchema).length(12),
}).strict();

export const CFX_DISCOVERY_WITH_UNITS_JSON_SCHEMA = Object.freeze({
  name: "cfx_burden_of_proof_with_units_v1",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["propositions"],
    properties: {
      propositions: {
        type: "array",
        minItems: 12,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "assertion",
            "assertionSource",
            "whyItMattersToArticleThesis",
            "groundingUnitIds",
          ],
          properties: {
            assertion: {
              type: "string",
              minLength: 1,
              maxLength: 4_000,
            },
            assertionSource: {
              type: "string",
              minLength: 1,
              maxLength: 4_000,
            },
            whyItMattersToArticleThesis: {
              type: "string",
              minLength: 1,
              maxLength: 4_000,
            },
            groundingUnitIds: {
              type: "array",
              minItems: 1,
              items: {
                type: "string",
                pattern: "^U[0-9]+$",
              },
            },
          },
        },
      },
    },
  },
});
