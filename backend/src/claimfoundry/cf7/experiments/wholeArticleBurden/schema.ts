import { z } from "zod";

const propositionSchema = z.object({
  assertion: z.string().trim().min(1).max(4_000),
  assertionSource: z.string().trim().min(1).max(4_000),
  whyItMattersToArticleThesis: z.string().trim().min(1).max(4_000),
}).strict();

export const wholeArticleBurdenOutputSchema = z.object({
  propositions: z.array(propositionSchema).length(12),
}).strict();

export const WHOLE_ARTICLE_BURDEN_JSON_SCHEMA = Object.freeze({
  name: "cf7_whole_article_burden_v1",
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
