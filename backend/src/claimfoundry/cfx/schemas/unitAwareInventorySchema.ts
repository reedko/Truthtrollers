import { z } from "zod";

const nonEmpty = z.string().refine(
  (value) => value.trim().length > 0,
  "String must contain non-whitespace content",
);

export const cfxUnitAwareInventorySchema = z.object({
  schemaVersion: z.literal("cfx.unitAwarePropositions.v1"),
  fixtureId: z.string().min(1),
  propositions: z.array(z.object({
    propositionId: z.string().regex(/^P[0-9]+$/),
    assertion: nonEmpty,
    assertionSource: nonEmpty,
    whyItMattersToArticleThesis: nonEmpty,
    groundingUnitIds: z.array(z.string().regex(/^U[0-9]+$/)).min(1),
  }).strict()).length(12),
}).strict();
