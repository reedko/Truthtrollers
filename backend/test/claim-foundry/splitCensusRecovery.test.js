import test from "node:test";
import assert from "node:assert/strict";
import { selectSplitCensusRecoveryPackets, mergeSplitCensusRecoveryClaims }
  from "../../src/claim-foundry/splitCensusRecovery.js";
import { buildSplitCensusRecoveryPrompt }
  from "./prompt-benchmark/promptSets/splitCensusRecoveryPromptV1.js";

const item = (id, chunk, unit, signals, assessment = "no_obvious_call1a_match") => ({
  censusId: id, semanticChunkId: chunk, sourceUnitIds: [unit], contextUnitIds: [unit],
  signals, trigger: signals[0], snippet: `${id} states a testable factual relationship.`,
  contextText: "local context", recoveryEligible: true, assessment,
});

test("recovery packet selection preserves every unmatched list item before filling chunk coverage", () => {
  const diagnostic = { items: [
    item("CEN001", "B001", "U0001", ["list_assertion"]),
    item("CEN002", "B001", "U0002", ["list_assertion"]),
    item("CEN003", "B002", "U0003", ["attributed_statement"]),
    item("CEN004", "B003", "U0004", ["numeric_or_comparative_statement"]),
  ] };
  const result = selectSplitCensusRecoveryPackets({ diagnostic, maximumPackets: 3 });
  assert.deepEqual(result.selected.map((packet) => packet.censusId),
    ["CEN001", "CEN002", "CEN003"]);
  assert.equal(result.summary.selectedSemanticChunks, 2);
});

test("recovery merge accepts grounded novel claims and rejects duplicates or unknown packets", () => {
  const selectedPackets = [item("CEN001", "B001", "U0001", ["list_assertion"])];
  const result = mergeSplitCensusRecoveryClaims({
    candidateClaims: [{ claimText: "Vaccines are tested more than other medicines.",
      sourceUnitIds: ["U0012"] }],
    selectedPackets,
    recoveryClaims: [
      { censusIds: ["CEN001"], claimText: "Outdoor play challenges immunity more than vaccines.",
        sourceUnitIds: ["U0001"], materiality: "high", relatedPillarLabels: ["Safety"],
        scope: "children", evidenceUsefulnessHint: "Compare immune challenges." },
      { censusIds: ["CEN001"], claimText: "Vaccines are tested more than medicines.",
        sourceUnitIds: ["U0001"], materiality: "high", relatedPillarLabels: ["Safety"],
        scope: "medicines", evidenceUsefulnessHint: "Compare testing." },
      { censusIds: ["CEN999"], claimText: "Unknown packet claim.", sourceUnitIds: ["U0999"],
        materiality: "low", relatedPillarLabels: [], scope: "unknown",
        evidenceUsefulnessHint: "Find evidence." },
    ],
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0]._censusRecovery.origin, "census_recovery");
  assert.deepEqual(result.rejected.map((entry) => entry.reason),
    ["semantic_duplicate", "unknown_census_id"]);
});

test("recovery prompt is a separate narrow task and does not change primary 1A", () => {
  const prompt = buildSplitCensusRecoveryPrompt({ inventory1a: {
    theme: { text: "T" }, thesis: { text: "H" }, pillars: [{ label: "P", text: "p" }],
    candidateClaims: [{ claimText: "Existing.", sourceUnitIds: ["U0001"] }],
  }, selectedPackets: [item("CEN001", "B001", "U0002", ["list_assertion"])] });
  assert.match(prompt.system, /narrow claim-recovery reader/i);
  assert.match(prompt.user, /CEN001/);
  assert.equal(prompt.responseSchema.schema.required[0], "candidateClaims");
});
