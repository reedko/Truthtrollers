import { z } from "zod";
import { cfxDiscoveryRowSchema } from "./discoverySchema.js";

export const cfxCanonicalPropositionSchema = cfxDiscoveryRowSchema.extend({
  propositionId: z.string().regex(/^P\d{2,}$/),
}).strict();

export const cfxCanonicalInventorySchema = z.object({
  schemaVersion: z.literal("cfx.canonicalPropositions.v1"),
  fixtureId: z.string().min(1),
  propositions: z.array(cfxCanonicalPropositionSchema).length(12),
}).strict();
