import test from "node:test";
import assert from "node:assert/strict";
import { expandSplitAttributedOccurrences }
  from "../../src/claim-foundry/splitAttributedOccurrenceExpansion.js";

const claim = { claimText: "The agency manipulated trial data to conceal a link to coastal harm.",
  sourceUnitIds: ["U0010"], materiality: "high", relatedPillarLabels: [], scope: "trial",
  evidenceUsefulnessHint: "Trial records." };

test("clones an existing proposition at a strongly matching attributed occurrence", () => {
  const out = expandSplitAttributedOccurrences({ candidateClaims: [claim], sourceUnits: [
    { unitId: "U0010", order: 10, text: "A revised report was released." },
    { unitId: "U0020", order: 20,
      text: "Morgan Lee revealed that the agency manipulated trial data to conceal the link to coastal harm." },
  ] });
  assert.equal(out.originalCount, 1);
  assert.equal(out.expandedCount, 2);
  assert.deepEqual(out.candidateClaims[1].sourceUnitIds, ["U0020"]);
  assert.equal(out.candidateClaims[1]._occurrenceDerived.matchedUnitId, "U0020");
  assert.ok(out.additions[0].sourceCandidates.some((item) => /Morgan Lee/.test(item.nameHint)));
});

test("does not clone a matching passage with no explicit source signal", () => {
  const out = expandSplitAttributedOccurrences({ candidateClaims: [claim], sourceUnits: [
    { unitId: "U0020", order: 20,
      text: "The agency manipulated trial data to conceal a link to coastal harm." },
  ] });
  assert.equal(out.expandedCount, 1);
  assert.deepEqual(out.additions, []);
});
