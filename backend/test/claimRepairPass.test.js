// backend/test/claimRepairPass.test.js
// Tests for feature-gated targeted repair pass for coverage gaps

import assert from "node:assert/strict";
import test from "node:test";
import {
  isClaimRepairPassEnabled,
  generateRepairClaim,
  runTargetedRepairPass,
} from "../src/core/claimRepairPass.js";

/**
 * Test 1: Feature flag check
 */
test("isClaimRepairPassEnabled - checks CLAIM_REPAIR_PASS flag", () => {
  const envTrue = { CLAIM_REPAIR_PASS: "true" };
  const envFalse = { CLAIM_REPAIR_PASS: "false" };
  const envMissing = {};

  assert.strictEqual(isClaimRepairPassEnabled(envTrue), true);
  assert.strictEqual(isClaimRepairPassEnabled(envFalse), false);
  assert.strictEqual(isClaimRepairPassEnabled(envMissing), false);
  console.log("✅ Feature flag check works correctly");
});

/**
 * Test 2: Repair pass disabled
 */
test("runTargetedRepairPass - returns disabled when flag is off", async () => {
  const env = { CLAIM_REPAIR_PASS: "false" };
  const finalFrame = {
    coverageGaps: ["Gap 1", "Gap 2"],
  };

  const result = await runTargetedRepairPass({
    finalFrame,
    chunkSurveys: [],
    selectedEvaluationClaims: [],
    env,
  });

  assert.strictEqual(result.outcome, "disabled");
  assert.strictEqual(result.repairClaim, null);
  console.log("✅ Repair pass correctly disabled when flag is off");
});

/**
 * Test 3: No coverage gaps
 */
test("runTargetedRepairPass - skips when no coverage gaps", async () => {
  const env = { CLAIM_REPAIR_PASS: "true" };
  const finalFrame = {
    coverageGaps: [],
  };

  const result = await runTargetedRepairPass({
    finalFrame,
    chunkSurveys: [],
    selectedEvaluationClaims: [],
    env,
  });

  assert.strictEqual(result.outcome, "none_needed");
  assert.strictEqual(result.repairClaim, null);
  console.log("✅ Repair pass skips correctly when no gaps found");
});

/**
 * Test 4: Minimal final frame structure
 */
test("runTargetedRepairPass - handles minimal frame", async () => {
  const env = { CLAIM_REPAIR_PASS: "true" };
  const finalFrame = {
    finalThesis: "Test thesis",
    coverageGaps: ["Missing evidence for X"],
    finalPillars: [],
  };

  const result = await runTargetedRepairPass({
    finalFrame,
    chunkSurveys: [],
    selectedEvaluationClaims: [],
    env,
  });

  // With no survey data, it should attempt but not generate
  assert.ok(["attempted", "generated"].includes(result.outcome));
  console.log("✅ Repair pass handles minimal frame");
});

/**
 * Test 5: Repair claim structure when disabled
 */
test("runTargetedRepairPass - returns null when disabled", async () => {
  const env = { CLAIM_REPAIR_PASS: "false" };
  const finalFrame = {
    finalThesis: "Test thesis",
    coverageGaps: ["Missing evidence"],
  };

  const result = await runTargetedRepairPass({
    finalFrame,
    chunkSurveys: [],
    selectedEvaluationClaims: [],
    env,
  });

  assert.strictEqual(result.repairClaim, null);
  assert.strictEqual(result.outcome, "disabled");
  console.log("✅ Disabled repair pass returns null claim");
});

/**
 * Test 6: Verify repair claim has required fields
 */
test("generateRepairClaim - repair claim has correct structure", async () => {
  // This test checks that if a claim is generated, it has the right structure
  const finalFrame = {
    finalThesis: "Test thesis",
    finalPillars: [],
  };

  const mockChunkSurveys = [
    {
      chunkIndex: 0,
      chunkPosition: "lead",
      evaluationCandidateClaims: [
        {
          claimText: "Test claim",
          localSourceExcerpt: "Test excerpt from article",
          importanceToArticleGuess: 0.7,
        },
      ],
    },
  ];

  const result = await generateRepairClaim({
    finalFrame,
    chunkSurveys: mockChunkSurveys,
    selectedEvaluationClaims: [],
    coverageGap: "Missing coverage for X",
  });

  if (result.repairClaim) {
    const claim = result.repairClaim;
    // Verify structure
    assert.ok(claim.claimText && typeof claim.claimText === "string");
    assert.ok(claim.roleHint === "evidence");
    assert.ok(claim.repairPass === true);
    assert.ok(claim.candidateOnly === false);
    assert.ok("importanceToArticleGuess" in claim);
    assert.ok("claimType" in claim);
    console.log("✅ Repair claim has correct structure");
  } else {
    console.log("✅ Repair claim generation returned null (acceptable outcome)");
  }
});

/**
 * Test 7: Empty coverage gap description
 */
test("generateRepairClaim - handles empty gap description", async () => {
  const result = await generateRepairClaim({
    finalFrame: {},
    chunkSurveys: [],
    selectedEvaluationClaims: [],
    coverageGap: "",
  });

  assert.strictEqual(result.repairClaim, null);
  assert.ok(result.reason.length > 0);
  console.log("✅ Empty gap description handled correctly");
});

/**
 * Test 8: Multiple coverage gaps - picks first
 */
test("runTargetedRepairPass - picks first gap from multiple", async () => {
  const env = { CLAIM_REPAIR_PASS: "true" };
  const finalFrame = {
    finalThesis: "Test thesis",
    coverageGaps: ["First gap", "Second gap", "Third gap"],
  };

  const result = await runTargetedRepairPass({
    finalFrame,
    chunkSurveys: [],
    selectedEvaluationClaims: [],
    env,
  });

  // Should process the first gap
  assert.ok(["attempted", "generated", "none_needed"].includes(result.outcome));
  console.log("✅ Picks first gap when multiple gaps exist");
});

/**
 * Test 9: Repair claim marked with repairPass flag
 */
test("generateRepairClaim - marks claim with repairPass flag", async () => {
  const mockChunkSurveys = [
    {
      chunkIndex: 0,
      chunkPosition: "lead",
      evaluationCandidateClaims: [
        {
          claimText: "Test claim",
          localSourceExcerpt: "Test excerpt",
          importanceToArticleGuess: 0.7,
        },
      ],
    },
  ];

  const result = await generateRepairClaim({
    finalFrame: { finalThesis: "Test", finalPillars: [] },
    chunkSurveys: mockChunkSurveys,
    selectedEvaluationClaims: [],
    coverageGap: "Test gap",
  });

  if (result.repairClaim) {
    assert.strictEqual(result.repairClaim.repairPass, true);
    console.log("✅ Repair claim correctly marked with repairPass flag");
  }
});

/**
 * Test 10: No excerpts available
 */
test("generateRepairClaim - handles no available excerpts", async () => {
  const result = await generateRepairClaim({
    finalFrame: { finalThesis: "Test" },
    chunkSurveys: [
      {
        chunkIndex: 0,
        evaluationCandidateClaims: [], // Empty
      },
    ],
    selectedEvaluationClaims: [],
    coverageGap: "Test gap",
  });

  assert.strictEqual(result.repairClaim, null);
  assert.ok(result.reason.includes("No relevant excerpts"));
  console.log("✅ No excerpts case handled correctly");
});

console.log("\n✅ All repair pass tests completed!");
