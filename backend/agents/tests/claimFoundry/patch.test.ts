import assert from "node:assert/strict";
import test from "node:test";
import { applyPatch } from "../../claimFoundry/claimFoundryPatch.js";
import { claim, document, harness, pkg } from "./fixtures.js";

const grounding = [document.sourceUnits[1].unitId];
const common = { reason: "test", findingIds: ["F1"], groundingUnitIds: grounding };
const operations = [
  { type: "add", claim: claim("C3"), ...common },
  { type: "remove", targetId: "C1", ...common },
  { type: "replace", targetId: "C1", claim: claim("C3"), ...common },
  { type: "split", targetId: "C1", claims: [claim("C3"), claim("C4")], ...common },
  { type: "merge", targetIds: ["C1", "C2"], claim: claim("C3"), ...common },
  { type: "change_treatment", targetId: "C1", value: "challenged", ...common },
  { type: "change_provenance", targetId: "C1", contentSupplier: "unknown", contentSupplierKind: "unknown", ...common },
  { type: "resolve_reference", targetId: "C1", substantiveAssertion: "Resolved assertion.", ...common },
  { type: "change_scope", targetId: "C1", value: "Narrow scope", ...common },
  { type: "change_polarity", targetId: "C1", value: "negative", ...common },
] as const;

test("all allow-listed patch verbs execute; arbitrary patching is rejected", () => {
  for (const operation of operations) {
    const base = pkg("run-1", "content-1", [claim("C1"), claim("C2")]);
    assert.doesNotThrow(() => applyPatch(base, operation));
  }
  assert.throws(() => applyPatch(pkg(), { type: "json_patch", path: "/", value: {} }));
});

test("failed patch leaves state unchanged; defect and round limits are enforced", async () => {
  const { tools, persistence } = await harness();
  await tools.save_working_package({ idempotencyKey: "save-patch-1", package: pkg() });
  await tools.validate_working_package({ idempotencyKey: "validate-patch-1" });
  const before = await persistence.load("run-1");
  await assert.rejects(() => tools.apply_package_patch({ idempotencyKey: "patch-failed", operation: {
    type: "remove", targetId: "MISSING", ...common,
  }}), /Unknown target claim/);
  assert.deepEqual(await persistence.load("run-1"), before);

  await tools.apply_package_patch({ idempotencyKey: "patch-once", operation: { type: "remove", targetId: "C1", ...common } });
  await assert.rejects(() => tools.apply_package_patch({ idempotencyKey: "patch-twice", operation: {
    type: "add", claim: claim("C9"), ...common,
  }}), /only once/);
});
