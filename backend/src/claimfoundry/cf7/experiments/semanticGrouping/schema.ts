import { z } from "zod";

const assertionId = z.string().regex(/^H\d{4,}$/);
const groupSchema = z.object({
  groupId: z.string().trim().min(1).max(100),
  assertionIds: z.array(assertionId).min(1).max(267),
}).strict();

export const semanticGroupingOutputSchema = z.object({
  groups: z.array(groupSchema).min(1).max(267),
}).strict();

export const SEMANTIC_GROUPING_JSON_SCHEMA = Object.freeze({
  name: "cf7_semantic_grouping_v1",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["groups"],
    properties: {
      groups: {
        type: "array",
        minItems: 1,
        maxItems: 267,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["groupId", "assertionIds"],
          properties: {
            groupId: {
              type: "string",
              minLength: 1,
              maxLength: 100,
            },
            assertionIds: {
              type: "array",
              minItems: 1,
              maxItems: 267,
              items: {
                type: "string",
                pattern: "^H\\d{4,}$",
              },
            },
          },
        },
      },
    },
  },
});
