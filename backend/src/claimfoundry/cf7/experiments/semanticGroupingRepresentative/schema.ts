import { z } from "zod";
import type { Gde2VariantId } from "./types.js";

const assertionId = z.string().regex(/^H\d{4,}$/);
const groupBase = {
  groupId: z.string().trim().min(1).max(100),
  assertionIds: z.array(assertionId).min(1).max(267),
};

export const gde2SelectedOutputSchema = z.object({
  groups: z.array(z.object({
    ...groupBase,
    representativeAssertionId: assertionId,
  }).strict()).min(1).max(267),
}).strict();

export const gde2SynthesizedOutputSchema = z.object({
  groups: z.array(z.object({
    ...groupBase,
    representativeAssertion: z.string().trim().min(1).max(2_000),
  }).strict()).min(1).max(267),
}).strict();

export const gde2HybridOutputSchema = z.object({
  groups: z.array(z.discriminatedUnion("representativeType", [
    z.object({
      ...groupBase,
      representativeType: z.literal("selected"),
      representativeAssertionId: assertionId,
    }).strict(),
    z.object({
      ...groupBase,
      representativeType: z.literal("synthesized"),
      representativeAssertion: z.string().trim().min(1).max(2_000),
    }).strict(),
  ])).min(1).max(267),
}).strict();

const baseGroupProperties = {
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
};

const selectedGroup = {
  type: "object",
  additionalProperties: false,
  required: ["groupId", "assertionIds", "representativeAssertionId"],
  properties: {
    ...baseGroupProperties,
    representativeAssertionId: {
      type: "string",
      pattern: "^H\\d{4,}$",
    },
  },
};

const synthesizedGroup = {
  type: "object",
  additionalProperties: false,
  required: ["groupId", "assertionIds", "representativeAssertion"],
  properties: {
    ...baseGroupProperties,
    representativeAssertion: {
      type: "string",
      minLength: 1,
      maxLength: 2_000,
    },
  },
};

const hybridSelectedGroup = {
  type: "object",
  additionalProperties: false,
  required: [
    "groupId",
    "assertionIds",
    "representativeType",
    "representativeAssertionId",
  ],
  properties: {
    ...baseGroupProperties,
    representativeType: { type: "string", enum: ["selected"] },
    representativeAssertionId: {
      type: "string",
      pattern: "^H\\d{4,}$",
    },
  },
};

const hybridSynthesizedGroup = {
  type: "object",
  additionalProperties: false,
  required: [
    "groupId",
    "assertionIds",
    "representativeType",
    "representativeAssertion",
  ],
  properties: {
    ...baseGroupProperties,
    representativeType: { type: "string", enum: ["synthesized"] },
    representativeAssertion: {
      type: "string",
      minLength: 1,
      maxLength: 2_000,
    },
  },
};

export const GDE2_JSON_SCHEMAS = Object.freeze({
  A: {
    name: "cf7_gde2_representative_selected_v1",
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
          items: selectedGroup,
        },
      },
    },
  },
  B: {
    name: "cf7_gde2_representative_synthesized_v1",
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
          items: synthesizedGroup,
        },
      },
    },
  },
  C: {
    name: "cf7_gde2_representative_hybrid_v1",
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
            anyOf: [hybridSelectedGroup, hybridSynthesizedGroup],
          },
        },
      },
    },
  },
});

export function getGde2ZodSchema(variantId: Gde2VariantId) {
  if (variantId === "A") return gde2SelectedOutputSchema;
  if (variantId === "B") return gde2SynthesizedOutputSchema;
  return gde2HybridOutputSchema;
}
