import test from "node:test";
import assert from "node:assert/strict";
import { selectSplitCandidates } from "../../src/claim-foundry/splitCandidateSelector.js";

const sourceUnits = [1, 2, 3].map((order) => ({
  unitId: `U${String(order).padStart(4, "0")}`, order,
}));
const base = { claimText: "The coastal trial concealed an adverse result.", sourceUnitIds: ["U0002"],
  attributionContextUnitIds: ["U0001"], materiality: "high", relatedPillarLabels: ["Trial"] };

test("pre-1B selection preserves equivalent propositions with different attribution contexts", () => {
  const out = selectSplitCandidates({ candidateClaims: [base,
    { ...base, attributionContextUnitIds: ["U0003"] }], sourceUnits,
  budget: { call1bCandidateMaximum: 16 } });
  assert.equal(out.selectedClaims.length, 2);
  assert.ok(!out.deferred.some((item) => item.reason === "same_text_same_span_duplicate"));
});

test("pre-1B selection still removes an exact occurrence duplicate", () => {
  const out = selectSplitCandidates({ candidateClaims: [base, { ...base }], sourceUnits,
    budget: { call1bCandidateMaximum: 16 } });
  assert.equal(out.selectedClaims.length, 1);
  assert.equal(out.deferred[0].reason, "same_text_same_span_duplicate");
});
