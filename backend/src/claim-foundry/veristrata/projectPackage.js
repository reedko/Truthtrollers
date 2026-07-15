import { Cf1Error } from "../errors.js";
import { verifyCf1Package } from "../verifyPackage.js";
import { withTransaction } from "../../storage/dbTransaction.js";
import { loadCf1Package } from "../../storage/claimFoundryPackageStore.js";
import { setCf1ProjectionStatus } from "../../storage/claimFoundryBindingStore.js";
import { mapCf1SelectedClaim } from "./mapSelectedClaim.js";
import { mapCf1TargetCard } from "./mapTargetCard.js";
import { countCf1Projection, findOrCreateClaim, insertCf1ContentClaim,
  insertCf1Target, lockCf1Binding } from "./projectionStore.js";

function expectedCounts(pkg) {
  return { selectedClaims: pkg.selectedEvaluationClaims.length, targets: pkg.phase3Targets.length };
}

function sameCounts(left, right) {
  return left.selectedClaims === right.selectedClaims && left.targets === right.targets;
}

export async function projectCf1Package({ bindingId }, dependencies = {}) {
  const transact = dependencies.withTransaction ?? withTransaction;
  const ports = { lockBinding: dependencies.lockBinding ?? lockCf1Binding,
    loadPackage: dependencies.loadPackage ?? loadCf1Package,
    count: dependencies.count ?? countCf1Projection,
    findClaim: dependencies.findClaim ?? findOrCreateClaim,
    insertLink: dependencies.insertLink ?? insertCf1ContentClaim,
    insertTarget: dependencies.insertTarget ?? insertCf1Target,
    setStatus: dependencies.setStatus ?? setCf1ProjectionStatus };
  return transact(async ({ query }) => {
    const binding = await ports.lockBinding(query, bindingId);
    if (!binding?.content_id) throw new Cf1Error("CF1_PROJECTION_BINDING_INVALID",
      "Projection requires a content-bound CF1 package", { status: 409 });
    const loaded = await ports.loadPackage(query, binding.package_id, { forUpdate: true });
    const pkg = loaded?.claimPackage;
    const verification = pkg && verifyCf1Package(pkg, { requireFinalHash: true });
    if (!pkg || pkg.status !== "ready_for_evidence" || !verification.valid) {
      throw new Cf1Error("CF1_PACKAGE_NOT_PROJECTABLE", "CF1 package is not verified and ready", { status: 409 });
    }
    const expected = expectedCounts(pkg);
    const existing = await ports.count(query, pkg.packageId);
    if (binding.projection_status === "projected") {
      if (!sameCounts(existing, expected)) throw new Cf1Error("CF1_PROJECTION_DRIFT",
        "Projected row counts no longer match the immutable package", { status: 409 });
      return { bindingId, packageId: pkg.packageId, ...existing, mode: "inactive" };
    }
    if (existing.selectedClaims || existing.targets) throw new Cf1Error("CF1_PARTIAL_PROJECTION",
      "Partial package projection requires operator inspection", { status: 409 });
    await ports.setStatus(query, { bindingId, status: "pending" });
    const claimIds = new Map();
    for (const [order, selected] of pkg.selectedEvaluationClaims.entries()) {
      const mapped = mapCf1SelectedClaim(selected, { packageId: pkg.packageId, bindingId, order });
      const claimId = await ports.findClaim(query, mapped.claimText, mapped.lookupText);
      await ports.insertLink(query, binding.content_id, claimId, mapped.link);
      claimIds.set(selected.selectedClaimId, claimId);
    }
    for (const target of pkg.phase3Targets) {
      const card = pkg.evidenceNeedCards.find((item) => item.targetId === target.targetId);
      const siblings = pkg.phase3Targets.filter((item) => item.selectedClaimId === target.selectedClaimId);
      const value = mapCf1TargetCard(target, card, { packageId: pkg.packageId,
        contentId: binding.content_id, claimId: claimIds.get(target.selectedClaimId),
        order: siblings.findIndex((item) => item.targetId === target.targetId) });
      await ports.insertTarget(query, value);
    }
    const inserted = await ports.count(query, pkg.packageId);
    if (!sameCounts(inserted, expected)) throw new Cf1Error("CF1_PROJECTION_COUNT_MISMATCH",
      "Projection did not reproduce the immutable package", { status: 500 });
    await ports.setStatus(query, { bindingId, status: "projected" });
    return { bindingId, packageId: pkg.packageId, ...inserted, mode: "inactive" };
  }, { pool: dependencies.pool });
}
