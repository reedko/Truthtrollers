import { z } from "zod";

const nonEmptyUnchangedString = z.string().max(4_000).refine(
  (value) => value.trim().length > 0,
  "String must contain non-whitespace content",
);

export const cfxDiscoveryRowSchema = z.object({
  assertion: nonEmptyUnchangedString,
  assertionSource: nonEmptyUnchangedString,
  whyItMattersToArticleThesis: nonEmptyUnchangedString,
}).strict();

export const cfxDiscoveryOutputSchema = z.object({
  propositions: z.array(cfxDiscoveryRowSchema).length(12),
}).strict();

export const CFX_DISCOVERY_JSON_SCHEMA = Object.freeze({
  name: "cfx_burden_of_proof_v1",
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
          },
        },
      },
    },
  },
});
