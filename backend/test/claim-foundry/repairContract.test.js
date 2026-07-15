import test from "node:test";
import assert from "node:assert/strict";
import { buildRepairRequest, isAllowedRepairPath, validateRepairResponse } from "../../src/claim-foundry/repairContract.js";
import { verifyCf1Package } from "../../src/claim-foundry/verifyPackage.js";
import { createPackageDraft } from "./fixtures/packages.js";

test("repair request exposes only implicated semantic paths and grounding", () => {
  const draft = createPackageDraft();
  draft.phase3Targets[0].scoreTransform = "invert";
  const request = buildRepairRequest(draft, verifyCf1Package(draft));
  assert.deepEqual(request.allowedPaths, [
    "/phase3Targets/0/scoreTransform", "/phase3Targets/0/verdictEligible",
  ]);
  assert.equal(request.repairAttempt, 1);
  assert.equal(request.groundingBlocks[0].blockId, "B001");
  assert.ok(!request.allowedPaths.some((path) => path.includes("packageId")));
});

test("host-derived source offsets are terminal and never model-repairable", () => {
  const draft = createPackageDraft();
  draft.rawAssertions[0].sourceOffsets = [{ start: 0, end: 3 }];
  assert.throws(() => buildRepairRequest(draft, verifyCf1Package(draft)),
    (error) => error.code === "CF1_REPAIR_NOT_ELIGIBLE");
  assert.equal(isAllowedRepairPath("/rawAssertions/0/sourceExcerpt"), false);
  assert.equal(isAllowedRepairPath("/rawAssertions/0/sourceOffsets"), false);
});

test("repair response rejects forbidden paths and ungrounded operations", () => {
  assert.equal(isAllowedRepairPath("/article/text"), false);
  assert.throws(() => validateRepairResponse({ repairs: [{
    operation: "replace", path: "/article/text", value: "changed", rationale: "bad", sourceBlockIds: ["B001"],
  }], cannotRepair: [] }, ["/article/text"]), (error) => error.code === "CF1_REPAIR_FORBIDDEN_PATH");
  assert.throws(() => validateRepairResponse({ repairs: [{
    operation: "replace", path: "/phase3Targets/0/scoreTransform", value: "normal", rationale: "", sourceBlockIds: [],
  }], cannotRepair: [] }, ["/phase3Targets/0/scoreTransform"]), (error) => error.code === "CF1_INVALID_REPAIR_RESPONSE");
});

test("a second semantic repair is never eligible", () => {
  const draft = createPackageDraft();
  draft.phase3Targets[0].scoreTransform = "invert";
  const verification = verifyCf1Package(draft, { repairAttempted: true });
  assert.throws(() => buildRepairRequest(draft, verification), (error) => error.code === "CF1_REPAIR_LIMIT_REACHED");
});

test("selection-count justification can be repaired without changing selections", () => {
  const pkg = createPackageDraft();
  pkg.selectedEvaluationClaims = pkg.selectedEvaluationClaims.slice(0, 1);
  pkg.diagnostics.selectionCountException = null;
  const verification = verifyCf1Package(pkg);
  const request = buildRepairRequest(pkg, verification);
  assert.ok(request.allowedPaths.includes("/diagnostics/selectionCountException"));
  assert.ok(request.groundingBlocks.length > 0);
  assert.doesNotThrow(() => validateRepairResponse({ repairs: [{ operation: "replace",
    path: "/diagnostics/selectionCountException", value: "Short report supports three claims.",
    rationale: "Explains why padding was avoided.", sourceBlockIds: [] }], cannotRepair: [] },
  request.allowedPaths));
});

test("terminal source errors prevent semantic repair even when semantic errors also exist", () => {
  const draft = createPackageDraft();
  draft.article.contentHash = "a".repeat(64);
  draft.phase3Targets[0].scoreTransform = "invert";
  assert.throws(
    () => buildRepairRequest(draft, verifyCf1Package(draft)),
    (error) => error.code === "CF1_REPAIR_NOT_ELIGIBLE",
  );
});

test("card repair receives the target's source grounding", () => {
  const draft = createPackageDraft();
  draft.evidenceNeedCards = [];
  const request = buildRepairRequest(draft, verifyCf1Package(draft));
  assert.deepEqual(request.allowedPaths, ["/evidenceNeedCards/-"]);
  assert.deepEqual(request.groundingBlocks.map((block) => block.blockId), ["B001"]);
});
