import { z } from "zod";

const nonEmptyUnchangedString = z.string().max(4_000).refine(
  (value) => value.trim().length > 0,
  "String must contain non-whitespace content",
);

export const cfxSubstantiveReviewRowSchema = z.object({
  propositionId: z.string().regex(/^P[0-9]+$/),
  substantiveAssertion: nonEmptyUnchangedString,
  assertionSource: nonEmptyUnchangedString,
  articleStance: z.enum(["adopts", "challenges", "reports"]),
  // Not produced by the model: runSubstantiveReview.ts attaches this
  // deterministically (attachCfxEvidenceSearchHandoffs) before persisting
  // substantive_review.json, so on-disk rows already carry it. Accepted here
  // and ignored -- downstream callers recompute it fresh from
  // sourceInventory/article rather than trusting the copy on disk.
  evidenceSearchHandoff: z.unknown().optional(),
}).strict();

export const cfxSubstantiveReviewOutputSchema = z.object({
  results: z.array(cfxSubstantiveReviewRowSchema).length(12),
}).strict();

export const CFX_SUBSTANTIVE_REVIEW_JSON_SCHEMA = Object.freeze({
  name: "cfx_substantive_review_v1",
  strict: true as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: 12,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "propositionId",
            "substantiveAssertion",
            "assertionSource",
            "articleStance",
          ],
          properties: {
            propositionId: {
              type: "string",
              pattern: "^P[0-9]+$",
            },
            substantiveAssertion: {
              type: "string",
              minLength: 1,
              maxLength: 4_000,
            },
            assertionSource: {
              type: "string",
              minLength: 1,
              maxLength: 4_000,
            },
            articleStance: {
              type: "string",
              enum: ["adopts", "challenges", "reports"],
            },
          },
        },
      },
    },
  },
});
