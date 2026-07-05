// backend/test/claimRepairPassIntegration.test.js
// Integration test: repair pass within claims pipeline

import assert from "node:assert/strict";
import test from "node:test";
import { reduceEvaluationClaims } from "../src/core/claimReduction.js";

/**
 * Test 1: Repair claim survives clustering/reduction
 */
test("Integration: Repair claim is preserved through reduction pipeline", async () => {
  const repairClaim = {
    claimText: "Repair claim from coverage gap",
    roleHint: "evidence",
    importanceToArticleGuess: 0.7,
    importanceInChunk: 0.6,
    noveltyHint: "new",
    rhetoricalFunction: "addresses coverage gap",
    localSourceExcerpt: "relevant excerpt",
    namedActors: [],
    namedStudiesOrDocuments: [],
    namedLawsOrPolicies: [],
    namedDatasets: [],
    claimType: {},
    candidateOnly: false,
    repairPass: true, // KEY: marked as repair claim
    sourceChunkIndex: 0,
  };

  // Wrap repair claim in a cluster (as done in processTaskClaims.js)
  const evaluationClusterGroups = [
    {
      representative: repairClaim,
      variants: [repairClaim],
      clusterScore: 0.7,
      sourceChunks: new Set([0]),
    },
  ];

  const finalFrame = {
    finalThesis: "Test article thesis",
    finalPillars: [],
  };

  // Run through reducer (as done in processTaskClaims.js)
  const selectedClaims = await reduceEvaluationClaims(evaluationClusterGroups, finalFrame);

  // Verify repair claim made it through
  assert.strictEqual(selectedClaims.length, 1, "Should have one selected claim");
  const selected = selectedClaims[0];
  assert.strictEqual(selected.text, "Repair claim from coverage gap");
  assert.strictEqual(selected.repairPass, true, "repairPass flag preserved");
  assert.strictEqual(selected.candidateOnly, false, "Not marked as candidate-only");
  console.log("✅ Repair claim preserved through reduction");
});

/**
 * Test 2: Repair claim respects 12-claim cap
 */
test("Integration: Repair claim respects CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS cap", async () => {
  // Create 12 existing clusters
  const existingClusters = [];
  for (let i = 0; i < 12; i++) {
    existingClusters.push({
      representative: {
        claimText: `Regular claim ${i}`,
        roleHint: "evidence",
        importanceToArticleGuess: 0.8 - (i * 0.01), // Decrease importance
        importanceInChunk: 0.5,
        noveltyHint: "new",
        rhetoricalFunction: "test",
        localSourceExcerpt: "excerpt",
        namedActors: [],
        namedStudiesOrDocuments: [],
        claimType: {},
        candidateOnly: false,
        sourceChunkIndex: i,
      },
      variants: [],
      clusterScore: 0.8,
      sourceChunks: new Set([i]),
    });
  }

  // Add repair claim with lower importance
  const repairClaim = {
    claimText: "Low importance repair claim",
    roleHint: "evidence",
    importanceToArticleGuess: 0.5, // Lower than all existing
    importanceInChunk: 0.5,
    noveltyHint: "new",
    rhetoricalFunction: "repair",
    localSourceExcerpt: "repair excerpt",
    namedActors: [],
    namedStudiesOrDocuments: [],
    claimType: {},
    candidateOnly: false,
    repairPass: true,
    sourceChunkIndex: 12,
  };

  const clusterGroups = [
    ...existingClusters,
    {
      representative: repairClaim,
      variants: [repairClaim],
      clusterScore: 0.5,
      sourceChunks: new Set([12]),
    },
  ];

  const selectedClaims = await reduceEvaluationClaims(clusterGroups);

  // Should only have 12 claims (max cap)
  assert.strictEqual(
    selectedClaims.length,
    12,
    "Should respect 12-claim max"
  );

  // Repair claim should NOT be selected (lower importance)
  const hasRepairClaim = selectedClaims.some((c) => c.repairPass === true);
  assert.strictEqual(hasRepairClaim, false, "Low-importance repair claim rejected");
  console.log("✅ Repair claim respects 12-claim cap");
});

/**
 * Test 3: Repair claim with high importance makes it through
 */
test("Integration: High-importance repair claim selected in competitive field", async () => {
  // Create existing clusters with medium importance
  const existingClusters = [];
  for (let i = 0; i < 10; i++) {
    existingClusters.push({
      representative: {
        claimText: `Regular claim ${i}`,
        roleHint: "evidence",
        importanceToArticleGuess: 0.6, // Medium importance
        importanceInChunk: 0.5,
        noveltyHint: "new",
        rhetoricalFunction: "test",
        localSourceExcerpt: "excerpt",
        namedActors: [],
        namedStudiesOrDocuments: [],
        claimType: {},
        candidateOnly: false,
        sourceChunkIndex: i,
      },
      variants: [],
      clusterScore: 0.6,
      sourceChunks: new Set([i]),
    });
  }

  // Add high-importance repair claim
  const repairClaim = {
    claimText: "High importance repair claim",
    roleHint: "evidence",
    importanceToArticleGuess: 0.8, // Higher than existing
    importanceInChunk: 0.7,
    noveltyHint: "new",
    rhetoricalFunction: "repair",
    localSourceExcerpt: "repair excerpt",
    namedActors: [],
    namedStudiesOrDocuments: [],
    claimType: {},
    candidateOnly: false,
    repairPass: true,
    sourceChunkIndex: 10,
  };

  const clusterGroups = [
    ...existingClusters,
    {
      representative: repairClaim,
      variants: [repairClaim],
      clusterScore: 0.8,
      sourceChunks: new Set([10]),
    },
  ];

  const selectedClaims = await reduceEvaluationClaims(clusterGroups);

  // Should have 11 claims (10 medium + 1 high repair)
  assert.strictEqual(selectedClaims.length, 11, "Should select high-importance repair");

  // Repair claim should be selected
  const repairSelected = selectedClaims.find((c) => c.repairPass === true);
  assert.ok(repairSelected, "High-importance repair claim selected");
  assert.strictEqual(
    repairSelected.text,
    "High importance repair claim"
  );
  console.log("✅ High-importance repair claim selected");
});

/**
 * Test 4: Repair flag is not overwritten by reducer
 */
test("Integration: Reducer preserves repairPass flag exactly as provided", async () => {
  const repairClaim = {
    claimText: "Test repair claim",
    roleHint: "evidence",
    importanceToArticleGuess: 0.7,
    importanceInChunk: 0.6,
    noveltyHint: "new",
    rhetoricalFunction: "test",
    localSourceExcerpt: "excerpt",
    namedActors: [],
    namedStudiesOrDocuments: [],
    namedLawsOrPolicies: [],
    namedDatasets: [],
    claimType: {},
    candidateOnly: false,
    repairPass: true, // Explicitly true
  };

  const clusterGroups = [
    {
      representative: repairClaim,
      variants: [],
      clusterScore: 0.7,
      sourceChunks: new Set([0]),
    },
  ];

  const selectedClaims = await reduceEvaluationClaims(clusterGroups);

  assert.strictEqual(selectedClaims[0].repairPass, true);
  assert.ok(!selectedClaims[0].repairPass === false, "Flag is boolean true");
  console.log("✅ repairPass flag preserved exactly");
});

console.log("\n✅ All integration tests completed!");
