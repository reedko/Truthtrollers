import test from "node:test";
import assert from "node:assert/strict";
import { assertProjectionMapped, projectCf1Package } from "../../src/claim-foundry/veristrata/projectPackage.js";
import { createValidPackage } from "./fixtures/packages.js";

function harness({ projected = false, partial = false } = {}) {
  const pkg = createValidPackage();
  const calls = { statuses: [], links: [], targets: [] };
  let countCall = 0;
  const dependencies = {
    withTransaction: (work) => work({ query: async () => [] }),
    lockBinding: async () => ({ binding_id: 9, package_id: pkg.packageId,
      content_id: 21, projection_status: projected ? "projected" : "not_requested" }),
    loadPackage: async () => ({ claimPackage: pkg }),
    count: async () => {
      countCall += 1;
      if (projected || countCall > 1) return { selectedClaims: 1, targets: 1 };
      return partial ? { selectedClaims: 1, targets: 0 } : { selectedClaims: 0, targets: 0 };
    },
    findClaim: async () => 31,
    insertLink: async (_query, contentId, claimId, value) => calls.links.push({ contentId, claimId, value }),
    insertTarget: async (_query, value) => calls.targets.push(value),
    setStatus: async (_query, value) => calls.statuses.push(value.status),
  };
  return { pkg, calls, dependencies };
}

test("projection writes selected claims and targets transactionally but remains inactive", async () => {
  const { pkg, calls, dependencies } = harness();
  const result = await projectCf1Package({ bindingId: 9 }, dependencies);
  assert.deepEqual(calls.statuses, ["pending", "projected"]);
  assert.equal(calls.links.length, pkg.selectedEvaluationClaims.length);
  assert.equal(calls.targets.length, pkg.phase3Targets.length);
  assert.equal(calls.links[0].value.packageId, pkg.packageId);
  assert.equal(calls.targets[0].cardId, "ENC-T001");
  assert.equal(result.mode, "inactive");
});

test("completed reprojection verifies counts and performs no writes", async () => {
  const { calls, dependencies } = harness({ projected: true });
  const result = await projectCf1Package({ bindingId: 9 }, dependencies);
  assert.equal(result.mode, "inactive");
  assert.deepEqual(calls, { statuses: [], links: [], targets: [] });
});

test("partial projection is preserved for operator inspection", async () => {
  const { dependencies } = harness({ partial: true });
  await assert.rejects(projectCf1Package({ bindingId: 9 }, dependencies),
    { code: "CF1_PARTIAL_PROJECTION" });
});

test("field-completeness guard throws when a decided field reaches no column", () => {
  // A decided source (gradeTarget) with a null mapped column is the exact silent-drop
  // class the audit surfaced; the guard must fail loudly instead.
  assert.throws(() => assertProjectionMapped("target", "T001", {
    gradeTarget: ["attribution", null],
  }), { code: "CF1_PROJECTION_FIELD_UNMAPPED" });
  // Baseline (source null → not decided) and matched pairs are both fine.
  assert.doesNotThrow(() => assertProjectionMapped("target", "T001", {
    gradeTarget: [null, null], scoreTransform: ["normal", "normal"], verdictEligible: [false, 0],
  }));
});

test("baseline projection passes the field-completeness guard (null-by-design)", async () => {
  const { calls, dependencies } = harness();
  await projectCf1Package({ bindingId: 9 }, dependencies);
  assert.equal(calls.targets[0].cf1GradeTarget, null);
  assert.equal(calls.links[0].value.cf1ThesisHinge, null);
});
