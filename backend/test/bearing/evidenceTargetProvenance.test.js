import assert from "node:assert/strict";
import test from "node:test";

import { EvidenceEngine } from "../../src/core/evidenceEngine.js";
import { expandCandidateTargetAssignments } from "../../src/core/evidenceTargetProvenance.js";
import { normalizeBearingGatingConfig } from "../../src/core/bearingConfig.js";

const candidate = {
  id: "abc",
  url: "https://abc.example/thompson",
  evidenceTargetId: 71,
  evidenceTargetType: "attribution",
  targetProvenance: [
    { evidenceTargetId: 71, evidenceTargetType: "attribution", query: "statement" },
    { evidenceTargetId: 72, evidenceTargetType: "substantive", query: "omitted data" },
    { evidenceTargetId: 73, evidenceTargetType: "inference", query: "concealed association" },
  ],
};

test("R5 expands one deduped URL into every distinct target assignment", () => {
  const assignments = expandCandidateTargetAssignments(candidate);
  assert.deepEqual(assignments.map((item) => item.evidenceTargetId), [71, 72, 73]);
  assert.deepEqual(assignments.map((item) => item.evidenceTargetType), ["attribution", "substantive", "inference"]);
  assert.ok(assignments.every((item) => item.url === candidate.url));
});

test("R5 adaptive extraction fetches one source and evaluates it separately against every target", async () => {
  let fetches = 0;
  const evaluatedTargets = [];
  const cache = new Map();
  const engine = new EvidenceEngine({
    fetcher: {
      async getText(item) {
        if (!cache.has(item.url)) {
          fetches++;
          cache.set(item.url, { isProcessed: true, cleanText: "Thompson statement, omitted data, and CDC response.", citationCount: 0 });
        }
        return cache.get(item.url);
      },
    },
    extractQuotesAndScoreQuality: async ({ evaluationTarget }) => {
      evaluatedTargets.push(evaluationTarget.evaluationTargetId);
      return {
        quotes: [{
          quote: `Evidence for target ${evaluationTarget.evaluationTargetId}`,
          stance: "support",
          bearing_score: 0.9,
          bearing_type: "direct",
          claim_component_addressed: "whole_claim",
          bearing_reason: "Direct target evidence.",
        }],
        qualityScores: null,
      };
    },
  });
  const claim = {
    id: 52881,
    text: "Thompson allegation",
    evaluationTargets: [
      { evaluationTargetId: 71, targetType: "attribution", verdictEligible: true },
      { evaluationTargetId: 72, targetType: "substantive", verdictEligible: true },
      { evaluationTargetId: 73, targetType: "inference", verdictEligible: true },
    ],
  };
  const config = normalizeBearingGatingConfig({
    enableBearingGating: true,
    minDeliveredSourcesPerContent: 1,
    maxSourceAttemptsPerContent: 1,
    minBearingLinksPerClaim: 1,
    maxSourcesComparedPerClaim: 1,
    minHighBearingClaimsPerTarget: 1,
  }, {});
  const run = await engine._runAdaptiveExtractionRoundRobin([{ plan: { claim, rankedCandidates: [candidate] } }], {
    bearingConfig: config,
    maxSourcesToScrapePerTarget: 1,
    maxEvidencePerDoc: 2,
  });

  assert.equal(fetches, 1);
  assert.deepEqual(evaluatedTargets.sort(), [71, 72, 73]);
  assert.deepEqual(run.byClaimId.get(52881).evidence.map((item) => Number(item.evidenceTargetId)).sort(), [71, 72, 73]);
});
