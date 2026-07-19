import test from "node:test";
import assert from "node:assert/strict";
import { renderSplitArmHtml } from "./prompt-benchmark/splitArmHtml.js";

test("report exposes attribution provenance, candidate status, resolution, and merge IDs", () => {
  const claim = { claimText: "The coastal trial concealed an adverse result.",
    sourceUnitIds: ["U0002"], articleRole: "pillar_support", articleUse: "reported",
    assertionSource: "Morgan Lee", materiality: "high", relatedPillarLabels: [],
    scope: "trial", evidenceUsefulnessHint: "Trial records." };
  const result = {
    inventory: { theme: {}, thesis: {}, pillars: [], thesisHinge: "substance",
      candidateClaims: [claim] },
    raw: {
      call1a: { candidateClaims: [{ ...claim, attributionContextUnitIds: ["U0001"] }] },
      call1b: { candidateJudgments: [{ candidateId: "CAND01", assertionSource: "Morgan Lee",
        assertionSourceUnitIds: ["U0001"], assertionSourceResolution: "resolved_from_candidate",
        contentStance: "supports_thesis", articleDeployment: "reported_neutral",
        articleRole: "pillar_support", responseUnitIds: [], needsSplit: { split: false, reason: null } }] },
      packets: [{ id: "CAND01", claimUnits: [{ unitId: "U0002", text: claim.claimText }],
        attributionContextUnits: [{ unitId: "U0001", text: "Morgan Lee reported the result." }],
        sourceCandidateStatus: "candidates_found", sourceCandidates: [{ sourceCandidateId: "SRC01",
          nameHint: "Morgan Lee", trigger: "attribution_verb", unitIds: ["U0001"] }],
        localResponseUnits: [] }],
    },
    selector: { selectedClaims: [{ ...claim, attributionContextUnitIds: ["U0001"] }],
      selected: [{ index: 0, claimText: claim.claimText, reason: "pillar_coverage", region: 0 }],
      coverage: {} },
    hostSignals: [{ claimText: claim.claimText, candidateId: "CAND01",
      assertionSourceUnitIds: ["U0001"], assertionSourceResolution: "resolved_from_candidate",
      sourceCandidateStatus: "candidates_found", mergedCandidateIds: ["CAND01"],
      contentStance: "supports_thesis", articleDeployment: "reported_neutral",
      scoreTransform: "normal" }],
    diagnostics: { selectedCount: 1, deselectedCount: 0, duplicateCollapses: [],
      blockingErrors: [], sourceResolutionIssues: [] },
    censusDiagnostic: { status: "available", summary: {}, items: [] }, usage: {},
  };
  const html = renderSplitArmHtml({ runId: "test", model: "test", generatedAt: "now",
    runs: [{ fixtureId: "FX", repeat: 1, seed: 1, status: "completed", elapsedMs: 1, result }] });
  for (const expected of ["attribution-context units", "Morgan Lee", "candidates_found",
    "resolved_from_candidate", "merged candidate IDs"]) assert.match(html, new RegExp(expected, "i"));
});
