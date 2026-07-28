import assert from "node:assert/strict";
import test from "node:test";
import { claim, document, harness, pkg } from "./fixtures.js";

test("save rejects foreign grounding and ceiling violations without mutation", async () => {
  const { tools, persistence } = await harness();
  const foreign = pkg(); foreign.selectedClaims[0]!.substantiveGroundingUnitIds = ["U9999"];
  await assert.rejects(() => tools.save_working_package({ idempotencyKey: "save-bad-1", package: foreign }), /Structurally invalid package/);
  assert.equal((await persistence.load("run-1"))!.workingPackage, null);
  const oversized = pkg("run-1", "content-1", Array.from({ length: 16 }, (_, i) => claim(`C${i + 1}`)));
  await assert.rejects(() => tools.save_working_package({ idempotencyKey: "save-bad-2", package: oversized }));
});

test("validation is package-non-mutating and reports semantic limits honestly", async () => {
  const { tools, persistence } = await harness();
  await tools.save_working_package({ idempotencyKey: "save-good-1", package: pkg() });
  const before = structuredClone((await persistence.load("run-1"))!.workingPackage!.selectedClaims);
  const result = await tools.validate_working_package({ idempotencyKey: "validate-1" });
  const after = (await persistence.load("run-1"))!.workingPackage!.selectedClaims;
  assert.deepEqual(after, before);
  assert.ok(result.result.coverage.some(row => row.mode === "later_semantic_review"));
  assert.ok(result.result.coverage.some(row => row.mode === "unavailable"));
  assert.equal(result.result.hardPass, true);
});

test("completion is blocked by review and final packages are immutable snapshots", async () => {
  const { tools, persistence } = await harness();
  await tools.save_working_package({ idempotencyKey: "save-good-2", package: pkg() });
  await tools.validate_working_package({ idempotencyKey: "validate-2" });
  const patched = await tools.apply_package_patch({ idempotencyKey: "patch-review", operation: {
    type: "change_polarity", targetId: "C1", value: "negative", reason: "review fixture",
    findingIds: ["F-risk"], groundingUnitIds: [document.sourceUnits[1].unitId],
  }});
  assert.equal(patched.result.reviewRequired, true);
  await assert.rejects(() => tools.finalize_claim_package({ idempotencyKey: "final-blocked", mode: "complete", inspectedContextUnitIds: [] }), /Human review is pending/);

  const second = await harness("run-2");
  await second.tools.save_working_package({ idempotencyKey: "save-good-3", package: pkg("run-2") });
  await second.tools.validate_working_package({ idempotencyKey: "validate-3" });
  const final = await second.tools.finalize_claim_package({ idempotencyKey: "final-good-1", mode: "complete", inspectedContextUnitIds: [] });
  const stored = await second.persistence.loadFinalPackage(final.result.packageId!);
  assert.equal(stored!.status, "final"); assert.equal(stored!.packageHash, final.result.packageHash);
  stored!.selectedClaims[0]!.scope = "tampered";
  assert.notEqual((await second.persistence.loadFinalPackage(final.result.packageId!))!.selectedClaims[0]!.scope, "tampered");
  await assert.rejects(() => second.tools.find_source_units({ idempotencyKey: "after-final", query: "rainfall", maxResults: 1 }), /Terminal runs/);
});

test("typed abstention records reason and inspected context", async () => {
  const { tools, persistence } = await harness();
  const result = await tools.finalize_claim_package({ idempotencyKey: "abstain-1", mode: "abstain",
    abstentionReason: "Insufficient source support", inspectedContextUnitIds: [document.sourceUnits[0].unitId] });
  assert.equal(result.result.status, "abstained");
  assert.match((await persistence.load("run-1"))!.pendingReviewReasons[0]!, /ABSTENTION/);
});
