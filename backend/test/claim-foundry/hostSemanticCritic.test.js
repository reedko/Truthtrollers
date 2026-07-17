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

test("host accepts a multi-unit pillar claim with two concrete normalized anchors", () => {
  const sourceUnits = [
    { unitId: "U0001", text: "A community gatekeeper attacked the proposed discussion." },
    { unitId: "U0002", text: "This censorship applied to submitted letters about vaccines." },
  ];
  const value = { theme: { text: "Vaccine criticism was censored.", sourceUnitIds: ["U0002"] },
    thesis: { text: "Vaccine criticism was censored.", sourceUnitIds: ["U0002"] },
    pillars: [{ label: "Censorship", text: "Gatekeeping and censorship suppressed vaccine criticism.",
      importance: "major", sourceUnitIds: ["U0001", "U0002"] }],
    candidateClaims: [{ claimText: "Censorship of vaccine discussions was prevalent.",
      sourceUnitIds: ["U0001", "U0002"], articleRole: "pillar", articleUse: "endorsed",
      assertionSource: "article", materiality: "high", relatedPillarLabels: ["Censorship"],
      namedWorkHints: [], scope: "censorship of discussions about vaccines",
      evidenceUsefulnessHint: "Check the documented censorship incidents." }] };
  const report = runHostSemanticCritic(value,
    { sourceUnits, targetMinimum: 1, targetMaximum: 3 });
  assert.deepEqual(report.uncoveredPillarLabels, []);
  assert.equal(report.selectedClaims[0].claimText,
    "Censorship of vaccine discussions was prevalent.");
});

test("host finds grounding in a linked pillar's structural-block siblings", () => {
  const sourceUnits = [
    { unitId: "U0001", order: 0, text: "A community gatekeeper attacked the event." },
    { unitId: "U0002", order: 1, text: "People were not permitted to consider varied perspectives." },
    { unitId: "U0003", order: 2, text: "This censorship included letters about vaccines that challenged health authorities." },
  ];
  const value = { theme: { text: "Vaccine criticism was censored.", sourceUnitIds: ["U0003"] },
    thesis: { text: "Vaccine criticism was censored.", sourceUnitIds: ["U0003"] },
    pillars: [{ label: "Censorship", text: "Gatekeeping limited discussion of vaccine safety.",
      importance: "major", sourceUnitIds: ["U0001", "U0002"] }],
    candidateClaims: [{ claimText: "Censorship of vaccine safety discussions by health advocates was prevalent.",
      sourceUnitIds: ["U0001"], articleRole: "pillar", articleUse: "endorsed",
      assertionSource: "article", materiality: "medium", relatedPillarLabels: ["Censorship"],
      namedWorkHints: [], scope: "censorship of vaccine discussions",
      evidenceUsefulnessHint: "Check the documented incidents." }] };
  const structuralBlocks = [{ blockId: "B001", sourceUnitIds: ["U0001"] },
    { blockId: "B002", sourceUnitIds: ["U0002", "U0003"] }];
  const report = runHostSemanticCritic(value,
    { sourceUnits, structuralBlocks, targetMinimum: 1, targetMaximum: 3 });
  assert.deepEqual(report.uncoveredPillarLabels, []);
  assert.ok(report.selectedClaims[0].sourceUnitIds.includes("U0003"));
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

test("host backfill records honest origin, unforced stance, and importance-derived materiality", () => {
  const value = inventory();
  const report = runHostSemanticCritic(value, { sourceUnits: units, targetMinimum: 1, targetMaximum: 3 });
  const promoted = report.selectedClaims.find((claim) => claim.relatedPillarLabels.includes("Exemptions"));
  assert.equal(promoted.origin, "host_pillar_backfill");
  assert.equal(promoted.articleUse, "unclear");
  assert.equal(promoted.materiality, "medium");
  assert.equal(value.candidateClaims[0].origin, "model");
  assert.equal(value.candidateClaims.at(-1).origin, "host_pillar_backfill");
});

test("host backfill adopts the consensus stance of candidates grounded in the pillar's units", () => {
  const value = inventory();
  value.pillars = [
    { label: "Exemptions", text: "Parents increasingly sought vaccine exemptions for their children.",
      importance: "load_bearing", sourceUnitIds: ["U0001"] },
    { label: "Concern", text: "Officials reported a separate rise in public concern.",
      importance: "major", sourceUnitIds: ["U0002"] },
  ];
  value.candidateClaims = [{ claimText: "Officials noted public concern while parents pursued vaccine waivers.",
    sourceUnitIds: ["U0001", "U0002"], articleRole: "opponent_claim", articleUse: "rejected",
    assertionSource: "parents", materiality: "high", relatedPillarLabels: ["Concern"],
    namedWorkHints: [], scope: "vaccine exemptions", evidenceUsefulnessHint: "Test the exemption trend." }];
  const report = runHostSemanticCritic(value, { sourceUnits: units, targetMinimum: 1, targetMaximum: 4 });
  const promoted = report.selectedClaims.find((claim) => claim.origin === "host_pillar_backfill");
  assert.equal(promoted.articleUse, "rejected");
  assert.equal(promoted.materiality, "high");
});

test("raised selection cap admits the limitation pick after full pillar coverage", () => {
  const sourceUnits = [
    { unitId: "U0001", text: "The audit found the bridge inspection backlog doubled since 2020." },
    { unitId: "U0002", text: "The audit found maintenance spending fell eighteen percent." },
    { unitId: "U0003", text: "The authors acknowledge the sampled districts limitation may not generalize." },
  ];
  const value = { theme: { text: "Deferred maintenance created inspection backlogs.", sourceUnitIds: ["U0001"] },
    thesis: { text: "The inspection backlog doubled since 2020.", sourceUnitIds: ["U0001"] },
    pillars: [
      { label: "Backlog", text: "The bridge inspection backlog doubled since 2020.",
        importance: "major", sourceUnitIds: ["U0001"] },
      { label: "Spending", text: "Maintenance spending fell eighteen percent.",
        importance: "major", sourceUnitIds: ["U0002"] },
    ],
    candidateClaims: [
      { claimText: "The audit found the bridge inspection backlog doubled since 2020.", sourceUnitIds: ["U0001"],
        articleRole: "pillar", articleUse: "endorsed", assertionSource: "the audit", materiality: "high",
        relatedPillarLabels: ["Backlog"], namedWorkHints: [], scope: "inspection backlog",
        evidenceUsefulnessHint: "Check backlog counts." },
      { claimText: "The audit found maintenance spending fell eighteen percent.", sourceUnitIds: ["U0002"],
        articleRole: "pillar", articleUse: "endorsed", assertionSource: "the audit", materiality: "high",
        relatedPillarLabels: ["Spending"], namedWorkHints: [], scope: "maintenance spending",
        evidenceUsefulnessHint: "Check spending records." },
      { claimText: "The authors acknowledge the sampled districts limitation may not generalize.",
        sourceUnitIds: ["U0003"], articleRole: "qualification", articleUse: "qualification",
        assertionSource: "the authors", materiality: "medium", relatedPillarLabels: ["Backlog"],
        namedWorkHints: [], scope: "sampled districts limitation",
        evidenceUsefulnessHint: "Check the stated limitation." },
    ] };
  const clipped = runHostSemanticCritic(structuredClone(value),
    { sourceUnits, targetMinimum: 2, targetMaximum: 2 });
  assert.equal(clipped.selectedClaims.length, 2);
  const raised = runHostSemanticCritic(structuredClone(value),
    { sourceUnits, targetMinimum: 2, targetMaximum: 3 });
  assert.ok(raised.selectedClaims.some((claim) => claim.articleRole === "qualification"));
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
