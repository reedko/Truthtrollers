import { z } from "zod";

export const gOnlySelectorOutputSchema = z.object({
  selectedAssertionId: z.string().regex(/^H\d{4,}$/),
}).strict();

export const G_ONLY_SELECTOR_JSON_SCHEMA = Object.freeze({
  name: "cf7_g_only_selector_a_v1",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["selectedAssertionId"],
    properties: {
      selectedAssertionId: {
        type: "string",
        pattern: "^H\\d{4,}$",
      },
    },
  },
});
