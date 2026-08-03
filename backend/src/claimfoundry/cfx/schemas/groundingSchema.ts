import { z } from "zod";
import {
  CFX_GROUNDING_STATUSES,
  CFX_GROUNDING_TYPES,
} from "../types/index.js";

const unchangedNonEmptyString = z.string().max(8_000).refine(
  (value) => value.trim().length > 0,
  "String must contain non-whitespace content",
);

export const cfxEvidenceSegmentSchema = z.object({
  sourceUnitIds: z.array(z.string().regex(/^U\d{4,}$/)).min(1),
  verbatimEvidence: unchangedNonEmptyString,
}).strict();

export const cfxGroundingRowSchema = z.object({
  propositionId: z.string().regex(/^P\d{2,}$/),
  groundingStatus: z.enum(CFX_GROUNDING_STATUSES),
  groundingType: z.enum(CFX_GROUNDING_TYPES),
  evidenceSegments: z.array(cfxEvidenceSegmentSchema),
  supportedComponents: z.array(unchangedNonEmptyString),
  unsupportedComponents: z.array(unchangedNonEmptyString),
  notes: z.string().max(8_000).nullable(),
}).strict();

export const cfxGroundingOutputSchema = z.object({
  groundings: z.array(cfxGroundingRowSchema).min(1).max(12),
}).strict();

export const CFX_GROUNDING_JSON_SCHEMA = Object.freeze({
  name: "cfx_exact_grounding_v1",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["groundings"],
    properties: {
      groundings: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "propositionId",
            "groundingStatus",
            "groundingType",
            "evidenceSegments",
            "supportedComponents",
            "unsupportedComponents",
            "notes",
          ],
          properties: {
            propositionId: {
              type: "string",
              pattern: "^P[0-9]{2,}$",
            },
            groundingStatus: {
              type: "string",
              enum: [...CFX_GROUNDING_STATUSES],
            },
            groundingType: {
              type: "string",
              enum: [...CFX_GROUNDING_TYPES],
            },
            evidenceSegments: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["sourceUnitIds", "verbatimEvidence"],
                properties: {
                  sourceUnitIds: {
                    type: "array",
                    minItems: 1,
                    items: {
                      type: "string",
                      pattern: "^U[0-9]{4,}$",
                    },
                  },
                  verbatimEvidence: {
                    type: "string",
                    minLength: 1,
                    maxLength: 8_000,
                  },
                },
              },
            },
            supportedComponents: {
              type: "array",
              items: {
                type: "string",
                minLength: 1,
                maxLength: 8_000,
              },
            },
            unsupportedComponents: {
              type: "array",
              items: {
                type: "string",
                minLength: 1,
                maxLength: 8_000,
              },
            },
            notes: {
              anyOf: [
                { type: "string", maxLength: 8_000 },
                { type: "null" },
              ],
            },
          },
        },
      },
    },
  },
});
