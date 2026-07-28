import { z } from "zod";
import type { SelectedClaim, WorkingPackage } from "./claimFoundrySchemas.js";
import { selectedClaimSchema, workingPackageSchema } from "./claimFoundrySchemas.js";
import { ClaimFoundryError } from "./claimFoundryErrors.js";

const common = {
  reason: z.string().min(1),
  findingIds: z.array(z.string()).min(1),
  groundingUnitIds: z.array(z.string()).min(1),
};
export const patchOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), claim: selectedClaimSchema, ...common }).strict(),
  z.object({ type: z.literal("remove"), targetId: z.string(), ...common }).strict(),
  z.object({ type: z.literal("replace"), targetId: z.string(), claim: selectedClaimSchema, ...common }).strict(),
  z.object({ type: z.literal("split"), targetId: z.string(), claims: z.array(selectedClaimSchema).min(2), ...common }).strict(),
  z.object({ type: z.literal("merge"), targetIds: z.array(z.string()).min(2), claim: selectedClaimSchema, ...common }).strict(),
  z.object({ type: z.literal("change_treatment"), targetId: z.string(), value: z.enum(["adopted", "challenged", "reported"]), ...common }).strict(),
  z.object({ type: z.literal("change_provenance"), targetId: z.string(), contentSupplier: z.string().min(1),
    contentSupplierKind: z.enum(["person", "organization", "study", "document", "article_voice", "unknown"]), ...common }).strict(),
  z.object({ type: z.literal("resolve_reference"), targetId: z.string(), substantiveAssertion: z.string().min(1), ...common }).strict(),
  z.object({ type: z.literal("change_scope"), targetId: z.string(), value: z.string().min(1), ...common }).strict(),
  z.object({ type: z.literal("change_polarity"), targetId: z.string(), value: z.enum(["positive", "negative", "mixed", "unknown"]), ...common }).strict(),
]);
export type PatchOperation = z.infer<typeof patchOperationSchema>;

function indexOf(claims: SelectedClaim[], id: string) {
  const index = claims.findIndex(claim => claim.claimId === id);
  if (index < 0) throw new ClaimFoundryError("CF6_INVALID_PATCH", `Unknown target claim: ${id}`);
  return index;
}

export function applyPatch(pkg: WorkingPackage, raw: unknown): { package: WorkingPackage; reviewRequired: boolean } {
  const op = patchOperationSchema.parse(raw);
  const claims = structuredClone(pkg.selectedClaims);
  if (op.type === "add") claims.push(op.claim);
  else if (op.type === "remove") claims.splice(indexOf(claims, op.targetId), 1);
  else if (op.type === "replace") claims.splice(indexOf(claims, op.targetId), 1, op.claim);
  else if (op.type === "split") claims.splice(indexOf(claims, op.targetId), 1, ...op.claims);
  else if (op.type === "merge") {
    const indexes = op.targetIds.map(id => indexOf(claims, id)).sort((a, b) => b - a);
    indexes.forEach(index => claims.splice(index, 1)); claims.push(op.claim);
  } else {
    const claim = claims[indexOf(claims, op.targetId)]!;
    if (op.type === "change_treatment") claim.articleTreatment = op.value;
    if (op.type === "change_provenance") {
      claim.contentSupplier = op.contentSupplier; claim.contentSupplierKind = op.contentSupplierKind;
    }
    if (op.type === "resolve_reference") claim.substantiveAssertion = op.substantiveAssertion;
    if (op.type === "change_scope") claim.scope = op.value;
    if (op.type === "change_polarity") claim.polarity = op.value;
  }
  return {
    package: workingPackageSchema.parse({ ...pkg, selectedClaims: claims, packageHash: null }),
    reviewRequired: op.type !== "remove",
  };
}
