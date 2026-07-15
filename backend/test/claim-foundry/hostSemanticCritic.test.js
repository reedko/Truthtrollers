import test from "node:test";
import assert from "node:assert/strict";
import { runHostSemanticCritic } from "../../src/claim-foundry/hostSemanticCritic.js";

const units = [
  { unitId: "U0001", text: "Parents increasingly sought vaccine exemptions for their children." },
  { unitId: "U0002", text: "Officials reported a separate rise in public concern." },
];

function inventory() {
  return { theme: { text: "Vaccine concern increased.", sourceUnitIds: ["U0001"] },
    thesis: { text: "Vaccine concern increased.", sourceUnitIds: ["U0001"] },
    pillars: [{ label: "Exemptions", text: "Parents increasingly sought vaccine exemptions for their children.",
      importance: "major", sourceUnitIds: ["U0001"] }],
    candidateClaims: [{ claimText: "Officials reported a separate rise in public concern.",
      sourceUnitIds: ["U0002"], articleRole: "thesis", articleUse: "endorsed",
      assertionSource: "officials", materiality: "high", relatedPillarLabels: [],
      namedWorkHints: [], scope: "Public concern", evidenceUsefulnessHint: "Test the reported trend." }],
  };
}

test("host promotes a grounded major pillar when Call 1 omitted its candidate", () => {
  const value = inventory();
  const report = runHostSemanticCritic(value, { sourceUnits: units, targetMinimum: 1, targetMaximum: 3 });
  const promoted = report.selectedClaims.find((claim) => claim.relatedPillarLabels.includes("Exemptions"));
  assert.equal(promoted.claimText, value.pillars[0].text);
  assert.deepEqual(promoted.sourceUnitIds, ["U0001"]);
  assert.ok(report.findings.some((finding) => finding.type === "missing_pillar_candidate"));
  assert.deepEqual(report.uncoveredPillarLabels, []);
});

test("host rejects a major pillar that remains ungrounded", () => {
  const value = inventory();
  value.pillars[0].text = "A completely different unsupported proposition caused national harm.";
  assert.throws(() => runHostSemanticCritic(value,
    { sourceUnits: units, targetMinimum: 1, targetMaximum: 3 }),
  (error) => error.code === "CF1_MISSING_PILLAR_COVERAGE");
});

test("host demotes background and routine methods behind article-own material claims", () => {
  const sourceUnits = [
    { unitId: "U0001", text: "The report found the river contamination doubled after the spill." },
    { unitId: "U0002", text: "A prior review discussed contamination in other rivers." },
    { unitId: "U0003", text: "Researchers matched twelve sites by distance." },
  ];
  const value = { theme: { text: "The spill doubled river contamination.", sourceUnitIds: ["U0001"] },
    thesis: { text: "The spill doubled river contamination.", sourceUnitIds: ["U0001"] },
    pillars: [{ label: "Contamination increase", text: "River contamination doubled after the spill.",
      importance: "major", sourceUnitIds: ["U0001"] }],
    candidateClaims: [
      { claimText: "River contamination doubled after the spill.", sourceUnitIds: ["U0001"],
        articleRole: "pillar", articleUse: "endorsed", assertionSource: "the report", materiality: "high",
        relatedPillarLabels: ["Contamination increase"], namedWorkHints: [], scope: "river contamination",
        evidenceUsefulnessHint: "Test measurements before and after the spill." },
      { claimText: "A prior review discussed contamination in other rivers.", sourceUnitIds: ["U0002"],
        articleRole: "pillar_support", articleUse: "background", assertionSource: "a prior review", materiality: "medium",
        relatedPillarLabels: ["Contamination increase"], namedWorkHints: [], scope: "other rivers",
        evidenceUsefulnessHint: "Locate the review." },
      { claimText: "Researchers matched twelve sites by distance.", sourceUnitIds: ["U0003"],
        articleRole: "pillar_support", articleUse: "reported", assertionSource: "researchers", materiality: "medium",
        relatedPillarLabels: ["Contamination increase"], namedWorkHints: [], scope: "site matching",
        evidenceUsefulnessHint: "Check the study methods." },
    ] };
  const report = runHostSemanticCritic(value,
    { sourceUnits, targetMinimum: 1, targetMaximum: 3 });
  assert.deepEqual(report.selectedClaims.map((claim) => claim.claimText),
    ["River contamination doubled after the spill."]);
  assert.ok(report.findings.some((finding) => finding.type === "routine_method_or_sample"));
});

test("host records a generic observed-result and explanation relationship", () => {
  const sourceUnits = [
    { unitId: "U0001", text: "The measured rate was higher before 36 months." },
    { unitId: "U0002", text: "The authors said this likely reflects enrollment requirements before 36 months." },
  ];
  const value = { theme: { text: "The higher rate likely reflects enrollment requirements.", sourceUnitIds: ["U0001", "U0002"] },
    thesis: { text: "The higher rate likely reflects enrollment requirements.", sourceUnitIds: ["U0002"] },
    pillars: [{ label: "Observed difference", text: "The rate was higher but may reflect enrollment requirements.",
      importance: "major", sourceUnitIds: ["U0001", "U0002"] }],
    candidateClaims: [
      { claimText: "The measured rate was higher before 36 months.", sourceUnitIds: ["U0001"],
        articleRole: "pillar", articleUse: "endorsed", assertionSource: "the study", materiality: "high",
        relatedPillarLabels: ["Observed difference"], namedWorkHints: [], scope: "rate before 36 months",
        evidenceUsefulnessHint: "Check the measured result." },
      { claimText: "The authors said the difference likely reflects enrollment requirements before 36 months.",
        sourceUnitIds: ["U0002"], articleRole: "qualification", articleUse: "qualification",
        assertionSource: "the authors", materiality: "high", relatedPillarLabels: ["Observed difference"],
        namedWorkHints: [], scope: "the explanation for the difference",
        evidenceUsefulnessHint: "Check the authors' stated explanation." },
    ] };
  const report = runHostSemanticCritic(value,
    { sourceUnits, targetMinimum: 2, targetMaximum: 2 });
  assert.deepEqual(report.relatedClaimPairs,
    [{ resultCandidateId: "C01", explanationCandidateId: "C02" }]);
  assert.ok(report.findings.some((finding) => finding.type === "related_result_explanation"));
});
