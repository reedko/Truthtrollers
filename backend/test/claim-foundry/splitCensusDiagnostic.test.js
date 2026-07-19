import test from "node:test";
import assert from "node:assert/strict";
import { buildSplitCensusDiagnostic } from "../../src/claim-foundry/splitCensusDiagnostic.js";

test("census diagnostic compares grounding only and never manufactures a claim", () => {
  const result = buildSplitCensusDiagnostic({
    censusItems: [
      { censusId: "CEN001", kind: "block_quotation", signals: ["block_quotation"],
        sourceUnitIds: ["U0010"], text: "A quoted assertion." },
      { censusId: "CEN002", kind: "attributed_statement", signals: ["attributed_statement"],
        sourceUnitIds: ["U0011"], text: "An unmatched assertion." },
    ],
    candidateClaims: [{ claimText: "The quoted assertion is a proposition.", sourceUnitIds: ["U0010"] }],
  });
  assert.equal(result.summary.totalPackets, 2);
  assert.equal(result.summary.apparentMatchCount, 1);
  assert.equal(result.summary.noObviousMatchCount, 1);
  assert.equal(result.items[0].assessment, "apparently_covered_by_call1a");
  assert.equal(result.items[0].match.candidateId, "1A-001");
  assert.equal(result.items[1].assessment, "no_obvious_call1a_match");
  assert.equal(result.items[1].match, null);
});
