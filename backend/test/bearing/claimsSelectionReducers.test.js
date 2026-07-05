// backend/test/bearing/claimsSelectionReducers.test.js
//
// Tests for document-level claim selection reducers:
// - reduceToEvaluationClaims: selects thesis/pillars/evidence/opposing/critical claims
// - reduceToSourceBackgroundClaims: selects useful source/background context claims

import assert from "node:assert/strict";
import test from "node:test";
import {
  reduceToEvaluationClaims,
  reduceToSourceBackgroundClaims,
  reduceClaimsForDocumentEvaluation,
} from "../../src/core/claimsSelectionReducers.js";
import logger from "../../src/utils/logger.js";

/**
 * Test 1: Evaluation claims reduction with diverse roles
 */
test("reduceToEvaluationClaims - selects diverse high-value claims", async () => {
  logger.log("\n=== TEST: Evaluation Claims Reduction (Diverse Roles) ===\n");

  const candidates = [
    {
      id: "c1",
      text: "Climate change is accelerating due to human activity.",
      role: "thesis",
      centrality: 0.95,
      verifiability: 0.85,
      evaluationEligible: true,
      isFallibilityCritical: false,
      namedEntities: ["climate change", "human activity"],
      namedStudiesOrDocuments: [],
      dates: [],
      localSourceExcerpt: "Climate change is accelerating due to human activity.",
      searchAssertions: [{ assertion: "climate change accelerating", query: "climate change acceleration" }],
    },
    {
      id: "c2",
      text: "CO2 levels have increased 50% since pre-industrial times.",
      role: "pillar",
      centrality: 0.90,
      verifiability: 0.92,
      evaluationEligible: true,
      isFallibilityCritical: false,
      namedEntities: ["CO2", "pre-industrial"],
      namedStudiesOrDocuments: [],
      dates: ["pre-industrial", "current"],
      localSourceExcerpt: "CO2 levels have increased 50%",
      searchAssertions: [{ assertion: "CO2 increase", query: "CO2 levels increase percentage" }],
    },
    {
      id: "c3",
      text: "Global mean temperature has risen 1.1°C in the past 50 years.",
      role: "evidence",
      centrality: 0.70,
      verifiability: 0.88,
      evaluationEligible: true,
      isFallibilityCritical: false,
      namedEntities: ["temperature"],
      namedStudiesOrDocuments: [],
      dates: ["50 years", "1.1°C"],
      localSourceExcerpt: "temperature has risen 1.1°C",
      searchAssertions: [{ assertion: "temperature rise", query: "global mean temperature rise 1.1 celsius" }],
    },
    {
      id: "c4",
      text: "Some economists argue that climate policy costs exceed benefits.",
      role: "opposing",
      centrality: 0.65,
      verifiability: 0.72,
      evaluationEligible: true,
      isFallibilityCritical: false,
      namedEntities: ["economists"],
      namedStudiesOrDocuments: [],
      dates: [],
      localSourceExcerpt: "Some economists argue that climate policy costs exceed benefits.",
      searchAssertions: [{ assertion: "climate policy costs", query: "climate policy cost benefit analysis" }],
    },
    {
      id: "c5",
      text: "The models used to predict climate change are subject to significant uncertainty.",
      role: "evidence",
      centrality: 0.60,
      verifiability: 0.75,
      evaluationEligible: true,
      isFallibilityCritical: true,
      whyCritical: "Points to methodological limitations",
      namedEntities: ["models"],
      namedStudiesOrDocuments: ["climate models"],
      dates: [],
      localSourceExcerpt: "models are subject to significant uncertainty",
      searchAssertions: [{ assertion: "climate model uncertainty", query: "climate model limitations uncertainty" }],
    },
  ];

  const finalFrame = {
    finalThesis: "Climate change is accelerating and requires policy action.",
    finalStance: "endorses",
    finalPillars: [
      {
        pillarText: "Physical evidence: CO2 and temperature measurements",
        supportingChunkIndexes: [0, 1],
        representativeCandidateIds: ["c2", "c3"],
        coverageStrength: 0.9,
      },
      {
        pillarText: "Policy feasibility concerns",
        supportingChunkIndexes: [2],
        representativeCandidateIds: ["c4"],
        coverageStrength: 0.6,
      },
    ],
    dominantNamedAnchors: ["CO2", "temperature", "climate change"],
  };

  const result = reduceToEvaluationClaims(candidates, finalFrame, 4);

  logger.log("\n✅ Selected Evaluation Claims:");
  result.selectedEvaluationClaims.forEach((claim, i) => {
    logger.log(`${i + 1}. [${claim.role}] ${claim.text.substring(0, 60)}... (score: ${claim.selectionScore?.toFixed(3)})`);
  });

  // Assertions
  assert.equal(
    result.selectedEvaluationClaims.length,
    4,
    "Should select 4 evaluation claims (max requested)"
  );

  // Check that all have correct flags
  for (const claim of result.selectedEvaluationClaims) {
    assert.equal(claim.selectedForEvaluation, true, "Should have selectedForEvaluation=true");
    assert.equal(claim.evaluationEligible, true, "Should have evaluationEligible=true");
    assert.equal(claim.verdictEligible, true, "Should have verdictEligible=true");
    assert.equal(claim.searchEligible, true, "Should have searchEligible=true");
    assert.equal(claim.visibility, "workspace_eval", "Should have visibility=workspace_eval");
  }

  // Check role diversity
  const roles = result.selectedEvaluationClaims.map((c) => c.role);
  assert.ok(roles.includes("thesis"), "Should include thesis");
  assert.ok(roles.includes("pillar"), "Should include pillar");
  assert.ok(roles.includes("opposing"), "Should include opposing");

  // Check logs
  assert.ok(result.logs.length > 0, "Should have logs");
  logger.log("\nLogs:", result.logs);
});

/**
 * Test 2: Background claims reduction
 */
test("reduceToSourceBackgroundClaims - selects useful background context", async () => {
  logger.log("\n=== TEST: Background Claims Reduction ===\n");

  const candidates = [
    {
      id: "bg1",
      text: "The IPCC Assessment Report reviewed 14,000 scientific publications.",
      role: "background",
      argumentFunction: "background",
      centrality: 0.30,
      evaluationEligible: false,
      verdictEligible: false,
      searchEligible: false,
      namedEntities: ["IPCC"],
      namedStudiesOrDocuments: ["IPCC Assessment Report"],
      dates: [],
      localSourceExcerpt: "IPCC Assessment Report reviewed 14,000 publications",
      relationshipType: null,
      isAttribution: false,
    },
    {
      id: "bg2",
      text: "Dr. Michael E. Mann is a prominent climate scientist.",
      role: "background",
      argumentFunction: "background",
      centrality: 0.25,
      evaluationEligible: false,
      verdictEligible: false,
      searchEligible: false,
      namedEntities: ["Dr. Michael E. Mann", "climate scientist"],
      namedStudiesOrDocuments: [],
      dates: [],
      localSourceExcerpt: "Michael E. Mann is a prominent climate scientist",
      relationshipType: "provenance",
      isAttribution: true,
    },
    {
      id: "bg3",
      text: "Global CO2 emissions reached 37.5 gigatons in 2023.",
      role: "background",
      argumentFunction: "background",
      centrality: 0.35,
      evaluationEligible: false,
      verdictEligible: false,
      searchEligible: false,
      namedEntities: [],
      namedStudiesOrDocuments: [],
      dates: ["2023"],
      localSourceExcerpt: "CO2 emissions reached 37.5 gigatons",
      relationshipType: null,
      isAttribution: false,
    },
    {
      id: "bg4",
      text: "The climate is complicated.",
      role: "background",
      argumentFunction: "background",
      centrality: 0.10,
      evaluationEligible: false,
      verdictEligible: false,
      searchEligible: false,
      namedEntities: [],
      namedStudiesOrDocuments: [],
      dates: [],
      localSourceExcerpt: "",
      relationshipType: null,
      isAttribution: false,
    },
  ];

  const evaluationClaims = [
    {
      id: "c1",
      text: "Climate change is real.",
      role: "thesis",
    },
  ];

  const result = reduceToSourceBackgroundClaims(candidates, evaluationClaims, 3);

  logger.log("\n✅ Selected Background Claims:");
  result.selectedSourceBackgroundClaims.forEach((claim, i) => {
    logger.log(`${i + 1}. ${claim.text.substring(0, 60)}... (score: ${claim.selectionScore?.toFixed(3)})`);
  });

  // Assertions
  assert.equal(
    result.selectedSourceBackgroundClaims.length,
    3,
    "Should select 3 background claims (max requested)"
  );

  // Check that all have correct flags
  for (const claim of result.selectedSourceBackgroundClaims) {
    assert.equal(claim.selectedForEvaluation, false, "Should have selectedForEvaluation=false");
    assert.equal(claim.evaluationEligible, false, "Should have evaluationEligible=false");
    assert.equal(claim.verdictEligible, false, "Should have verdictEligible=false");
    assert.equal(claim.searchEligible, false, "Should have searchEligible=false");
    assert.equal(claim.sourceEligible, true, "Should have sourceEligible=true");
    assert.equal(claim.argumentFunction, "background", "Should have argumentFunction=background");
  }

  // Check that generic filler was not selected (bg4)
  const selectedIds = result.selectedSourceBackgroundClaims.map((c) => c.id);
  assert.ok(!selectedIds.includes("bg4"), "Should not select generic filler");

  // Check that named studies/documents and entities were preferred
  assert.ok(selectedIds.includes("bg1") || selectedIds.includes("bg2"), "Should include named document or entity");

  // Check logs
  assert.ok(result.logs.length > 0, "Should have logs");
  logger.log("\nLogs:", result.logs);
});

/**
 * Test 3: Combined reduction (evaluation + background)
 */
test("reduceClaimsForDocumentEvaluation - combined reduction", async () => {
  logger.log("\n=== TEST: Combined Document Evaluation ===\n");

  const candidates = [
    // Evaluation claims
    {
      id: "e1",
      text: "The study found a significant correlation.",
      role: "evidence",
      evaluationEligible: true,
      centrality: 0.75,
      verifiability: 0.80,
      namedEntities: [],
      namedStudiesOrDocuments: [],
      dates: [],
      localSourceExcerpt: "significant correlation",
      searchAssertions: [],
    },
    {
      id: "e2",
      text: "However, the sample size was limited.",
      role: "evidence",
      evaluationEligible: true,
      isFallibilityCritical: true,
      centrality: 0.70,
      verifiability: 0.85,
      namedEntities: [],
      namedStudiesOrDocuments: [],
      dates: [],
      localSourceExcerpt: "sample size was limited",
      searchAssertions: [],
    },
    // Background claims
    {
      id: "bg1",
      text: "The study was conducted by researchers at MIT.",
      role: "background",
      argumentFunction: "background",
      evaluationEligible: false,
      centrality: 0.20,
      namedEntities: ["MIT"],
      namedStudiesOrDocuments: [],
      dates: [],
      localSourceExcerpt: "MIT",
      relationshipType: "provenance",
      isAttribution: true,
    },
    {
      id: "bg2",
      text: "The research data is available in the supplementary materials.",
      role: "background",
      argumentFunction: "background",
      evaluationEligible: false,
      centrality: 0.15,
      namedEntities: [],
      namedStudiesOrDocuments: ["supplementary materials"],
      dates: [],
      localSourceExcerpt: "supplementary materials",
      relationshipType: null,
      isAttribution: false,
    },
  ];

  const finalFrame = {
    finalThesis: "The study provides evidence but with limitations.",
    finalStance: "mixed",
    finalPillars: [
      {
        pillarText: "Strong evidence of correlation",
        representativeCandidateIds: ["e1"],
        coverageStrength: 0.8,
      },
    ],
    dominantNamedAnchors: [],
  };

  const result = reduceClaimsForDocumentEvaluation(candidates, finalFrame, {
    maxEvaluationClaims: 2,
    maxBackgroundClaims: 2,
  });

  logger.log("\n✅ Combined Reduction Results:");
  logger.log(`Evaluation claims: ${result.selectedEvaluationClaims.length}`);
  logger.log(`Background claims: ${result.selectedSourceBackgroundClaims.length}`);

  // Assertions
  assert.equal(result.selectedEvaluationClaims.length, 2, "Should select 2 evaluation claims");
  // Background claims may be 0-2 depending on scoring; we just verify they don't exceed evaluation claims
  assert.ok(
    result.selectedSourceBackgroundClaims.length <= 2,
    "Should select at most 2 background claims"
  );

  // Check no overlap
  const evalIds = new Set(result.selectedEvaluationClaims.map((c) => c.id));
  const bgIds = new Set(result.selectedSourceBackgroundClaims.map((c) => c.id));
  for (const id of evalIds) {
    assert.ok(!bgIds.has(id), "Should not have overlap between evaluation and background claims");
  }

  // Check logs
  assert.ok(result.logs.length > 0, "Should have logs");
  logger.log("\nLogs:", result.logs);
});

/**
 * Test 4: Empty candidates
 */
test("reduceToEvaluationClaims - handles empty candidates", async () => {
  logger.log("\n=== TEST: Empty Candidates ===\n");

  const result = reduceToEvaluationClaims([]);

  assert.equal(result.selectedEvaluationClaims.length, 0, "Should return empty array for no candidates");
  assert.ok(result.logs.length > 0, "Should have logs");

  logger.log("✅ Correctly handled empty candidates");
});

/**
 * Test 5: Filtering ineligible candidates
 */
test("reduceToEvaluationClaims - filters ineligible candidates", async () => {
  logger.log("\n=== TEST: Ineligible Candidate Filtering ===\n");

  const candidates = [
    {
      id: "e1",
      text: "Claim 1",
      role: "evidence",
      evaluationEligible: true,
      centrality: 0.8,
      verifiability: 0.8,
      namedEntities: [],
      namedStudiesOrDocuments: [],
      dates: [],
      localSourceExcerpt: "Claim 1",
      searchAssertions: [],
    },
    {
      id: "e2",
      text: "Claim 2",
      role: "evidence",
      evaluationEligible: false, // Not eligible
      centrality: 0.9,
      verifiability: 0.9,
      namedEntities: [],
      namedStudiesOrDocuments: [],
      dates: [],
      localSourceExcerpt: "Claim 2",
      searchAssertions: [],
    },
  ];

  const result = reduceToEvaluationClaims(candidates);

  assert.equal(result.selectedEvaluationClaims.length, 1, "Should select only eligible claims");
  assert.equal(result.selectedEvaluationClaims[0].id, "e1", "Should select the eligible claim");

  logger.log("✅ Correctly filtered ineligible candidates");
});
