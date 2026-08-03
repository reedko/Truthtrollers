import { z } from "zod";

export const sel1OutputSchema = z.object({
  groupId: z.string().trim().min(1).max(100),
  selectedAssertionId: z.string().regex(/^H\d{4,}$/),
  atomicAssertion: z.string().trim().min(1).max(2_000),
}).strict();

export const SEL1_JSON_SCHEMA = Object.freeze({
  name: "cf7_sel1_selector_v1",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["groupId", "selectedAssertionId", "atomicAssertion"],
    properties: {
      groupId: {
        type: "string",
        minLength: 1,
        maxLength: 100,
      },
      selectedAssertionId: {
        type: "string",
        pattern: "^H\\d{4,}$",
      },
      atomicAssertion: {
        type: "string",
        minLength: 1,
        maxLength: 2_000,
      },
    },
  },
});
