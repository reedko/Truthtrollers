import test from "node:test";
import assert from "node:assert/strict";
import { compileEvidenceDocket } from "./handoff.js";

const result = {
  article: { title: "Test article" },
  thesisAssertion: "P",
  candidates: [{
    candidateId: "C01",
    contextUnits: [{ unitId: "U0001", text: "Grounding." }],
  }],
  assertions: [{
    candidateId: "C01",
    assertionText: "Treatment T reduced outcome O.",
    groundingUnitIds: ["U0001"],
    sourceName: "Study S",
    sourceKind: "study",
    sourceUnitIds: ["U0001"],
    sourceNameOrigin: "call_b_attribution_layer",
    attributionBasis: "explicit_layer",
    articleTreatment: "adopted",
    effectIfTrue: "strengthens",
    scoreTransform: "normal",
    evidenceAnchors: [{
      name: "Study S",
      kind: "study",
      unitIds: ["U0001"],
    }],
  }],
};

test("CF2 evidence handoff freezes selected assertion semantics", () => {
  const docket = compileEvidenceDocket([
    { fixtureId: "CF1-F01", result },
  ], { codeCommit: "abc123" });
  assert.equal(docket.fixtureCount, 1);
  assert.equal(docket.taskCount, 1);
  const [task] = docket.fixtures[0].tasks;
  assert.equal(task.assertionText, "Treatment T reduced outcome O.");
  assert.equal(task.targetText, task.assertionText);
  assert.equal(task.assertionSource.name, "Study S");
  assert.equal(task.scoreTransform, "normal");
  assert.equal(task.planningStatus, "needs_evidence_need_card");
  assert.deepEqual(task.groundingContext, [
    { unitId: "U0001", text: "Grounding." },
  ]);
});
