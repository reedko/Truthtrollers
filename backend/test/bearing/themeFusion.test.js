// backend/test/bearing/themeFusion.test.js
// Tests for theme fusion - consolidating chunk mini-themes into final frame

import { fuseSurveyThemesIntoFrame } from "../../src/core/themeFusion.js";
import logger from "../../src/utils/logger.js";

/**
 * Example test case showing theme fusion in action
 *
 * This demonstrates:
 * 1. Input: chunk-level mini-themes from Prompt 5
 * 2. LLM orchestration: single call to fuse themes
 * 3. Output: final frame for downstream clustering/reducers
 * 4. Logging: THEME_FUSION_COMPLETED with pillar/gap/pattern counts
 */
async function testThemeFusionBasic() {
  logger.log("\n=== TEST: Basic Theme Fusion ===\n");

  const provisionalFrame = `The article argues that climate change is accelerating due to human activity and requires immediate policy intervention.`;

  const chunkMiniThemes = [
    {
      chunkIndex: 0,
      miniThesis: "CO2 emissions are rising exponentially",
      stance: "endorses",
      pillars: [
        { text: "Atmospheric CO2 levels have increased 50% since pre-industrial era", strength: 0.9 },
      ],
      namedAnchors: ["atmospheric_co2", "pre_industrial_baseline"],
    },
    {
      chunkIndex: 1,
      miniThesis: "Temperature rise correlates strongly with CO2 increase",
      stance: "endorses",
      pillars: [
        { text: "Global mean temperature has risen 1.1°C in past 50 years", strength: 0.85 },
        { text: "Rise coincides with industrialization period", strength: 0.8 },
      ],
      namedAnchors: ["temperature_rise", "industrialization_period"],
    },
    {
      chunkIndex: 2,
      miniThesis: "Policy interventions can reduce emissions",
      stance: "mixed",
      pillars: [
        { text: "Some renewable technologies are cost-effective", strength: 0.75 },
        { text: "Transition challenges remain significant", strength: 0.7 },
      ],
      namedAnchors: ["renewable_cost_effectiveness", "transition_challenges"],
    },
  ];

  const relationshipToProvisionalFrame = [
    { chunkIndex: 0, relationship: "directly_supports", alignment: "strong" },
    { chunkIndex: 1, relationship: "directly_supports", alignment: "strong" },
    { chunkIndex: 2, relationship: "complicates_implementation", alignment: "moderate" },
  ];

  const pillarHints = [
    { text: "Physical evidence: CO2 and temperature measurements", source: "chunk_0", priority: 1 },
    { text: "Causation evidence: correlation and temporal sequence", source: "chunk_1", priority: 2 },
    { text: "Policy feasibility: cost-benefit analysis", source: "chunk_2", priority: 3 },
  ];

  const evaluationCandidateSummaries = [
    { candidateId: "c0", claimText: "CO2 has increased 50%", stance: "endorses", strength: 0.9 },
    { candidateId: "c1", claimText: "Temperature rise is 1.1°C", stance: "endorses", strength: 0.85 },
    { candidateId: "c2", claimText: "Renewables are cost-effective", stance: "endorses", strength: 0.75 },
  ];

  const sourceBackgroundCandidateSummaries = [
    { candidateId: "bg0", description: "IPCC Assessment Report on climate science", relevance: 0.95 },
    { candidateId: "bg1", description: "Climate modeling studies and observational data", relevance: 0.9 },
  ];

  const namedAnchors = [
    "atmospheric_co2",
    "pre_industrial_baseline",
    "temperature_rise",
    "industrialization_period",
    "renewable_cost_effectiveness",
    "transition_challenges",
  ];

  const repeatedPersuasionSignals = [
    {
      idea: "Correlation between human activity and climate change",
      occurrences: 3,
      variantIds: ["c0", "c1"],
    },
    {
      idea: "Urgency of policy action",
      occurrences: 2,
      variantIds: ["c2"],
    },
  ];

  try {
    const finalFrame = await fuseSurveyThemesIntoFrame({
      provisionalFrame,
      chunkMiniThemes,
      relationshipToProvisionalFrame,
      pillarHints,
      evaluationCandidateSummaries,
      sourceBackgroundCandidateSummaries,
      namedAnchors,
      repeatedPersuasionSignals,
      timeout: 45000,
    });

    logger.log("\n✅ Theme Fusion Result:\n");
    logger.log("Final Thesis:", finalFrame.finalThesis);
    logger.log("Final Stance:", finalFrame.finalStance);
    logger.log("Theme Shift:", finalFrame.themeShiftFromSeed);
    logger.log("Pillars:", finalFrame.finalPillars?.length || 0);
    logger.log("Named Anchors:", finalFrame.dominantNamedAnchors?.length || 0);
    logger.log("Persuasion Patterns:", finalFrame.repeatedPersuasionPatterns?.length || 0);
    logger.log("Coverage Gaps:", finalFrame.coverageGaps?.length || 0);

    return finalFrame;
  } catch (error) {
    logger.error("❌ Theme fusion failed:", error.message);
    throw error;
  }
}

/**
 * Example: Theme fusion with conflicting chunk themes
 *
 * When chunks disagree, the final frame should reflect:
 * - "mixed" or "unclear" stance
 * - themeShiftFromSeed indicating divergence
 * - All competing pillars represented
 */
async function testThemeFusionConflict() {
  logger.log("\n=== TEST: Theme Fusion with Conflict ===\n");

  const provisionalFrame = `The study's methodology is sound.`;

  const chunkMiniThemes = [
    {
      chunkIndex: 0,
      miniThesis: "The methodology is rigorous",
      stance: "endorses",
      pillars: [{ text: "Controls were properly randomized", strength: 0.8 }],
    },
    {
      chunkIndex: 1,
      miniThesis: "The methodology has significant flaws",
      stance: "rejects",
      pillars: [{ text: "Missing blind verification", strength: 0.75 }],
    },
  ];

  const relationshipToProvisionalFrame = [
    { chunkIndex: 0, relationship: "directly_supports", alignment: "strong" },
    { chunkIndex: 1, relationship: "directly_contradicts", alignment: "strong" },
  ];

  const pillarHints = [
    { text: "Randomization and controls", source: "chunk_0", priority: 1 },
    { text: "Blinding and verification", source: "chunk_1", priority: 1 },
  ];

  const evaluationCandidateSummaries = [
    { candidateId: "c0", claimText: "Randomization was proper", stance: "endorses", strength: 0.8 },
    { candidateId: "c1", claimText: "Blinding was inadequate", stance: "rejects", strength: 0.75 },
  ];

  const sourceBackgroundCandidateSummaries = [];
  const namedAnchors = ["randomization", "blinding", "verification"];
  const repeatedPersuasionSignals = [];

  try {
    const finalFrame = await fuseSurveyThemesIntoFrame({
      provisionalFrame,
      chunkMiniThemes,
      relationshipToProvisionalFrame,
      pillarHints,
      evaluationCandidateSummaries,
      sourceBackgroundCandidateSummaries,
      namedAnchors,
      repeatedPersuasionSignals,
      timeout: 45000,
    });

    logger.log("\n✅ Conflict Resolution Result:\n");
    logger.log("Final Stance:", finalFrame.finalStance, "(should be mixed/unclear)");
    logger.log("Theme Shift:", finalFrame.themeShiftFromSeed);
    logger.log("Final Thesis:", finalFrame.finalThesis);

    return finalFrame;
  } catch (error) {
    logger.error("❌ Conflict fusion failed:", error.message);
    throw error;
  }
}

/**
 * Example: Coverage analysis - identifying what's NOT covered
 *
 * The final frame should identify:
 * - Which pillar aspects have good evidence
 * - Which aspects lack support
 * - What counter-evidence exists
 */
async function testThemeFusionCoverage() {
  logger.log("\n=== TEST: Theme Fusion Coverage Analysis ===\n");

  const provisionalFrame = `Drug X is effective for condition Y and is safe to use.`;

  const chunkMiniThemes = [
    {
      chunkIndex: 0,
      miniThesis: "Drug X is effective",
      stance: "endorses",
      pillars: [
        { text: "Clinical trial shows 60% efficacy rate", strength: 0.85 },
      ],
    },
    {
      chunkIndex: 1,
      miniThesis: "Safety profile is inadequately tested",
      stance: "unclear",
      pillars: [
        { text: "Limited long-term safety data available", strength: 0.6 },
      ],
    },
  ];

  const relationshipToProvisionalFrame = [
    { chunkIndex: 0, relationship: "partially_supports", alignment: "moderate" },
    { chunkIndex: 1, relationship: "complicates_safety_claim", alignment: "weak" },
  ];

  const pillarHints = [
    { text: "Efficacy evidence from RCT", source: "chunk_0", priority: 1 },
    { text: "Safety data gaps", source: "chunk_1", priority: 1 },
  ];

  const evaluationCandidateSummaries = [
    { candidateId: "c0", claimText: "Clinical trial efficacy is 60%", stance: "endorses", strength: 0.85 },
  ];

  const sourceBackgroundCandidateSummaries = [
    { candidateId: "bg0", description: "Limited follow-up studies on long-term effects", relevance: 0.7 },
  ];

  const namedAnchors = ["clinical_trial", "efficacy_rate", "long_term_safety", "follow_up_studies"];
  const repeatedPersuasionSignals = [];

  try {
    const finalFrame = await fuseSurveyThemesIntoFrame({
      provisionalFrame,
      chunkMiniThemes,
      relationshipToProvisionalFrame,
      pillarHints,
      evaluationCandidateSummaries,
      sourceBackgroundCandidateSummaries,
      namedAnchors,
      repeatedPersuasionSignals,
      timeout: 45000,
    });

    logger.log("\n✅ Coverage Analysis Result:\n");
    logger.log("Final Thesis:", finalFrame.finalThesis);
    logger.log("Coverage Gaps:", finalFrame.coverageGaps);
    logger.log("Gap Count:", finalFrame.coverageGaps?.length || 0);

    return finalFrame;
  } catch (error) {
    logger.error("❌ Coverage analysis failed:", error.message);
    throw error;
  }
}

/**
 * Run all tests
 */
export async function runAllThemeFusionTests() {
  logger.log("\n" + "=".repeat(60));
  logger.log("THEME FUSION TEST SUITE");
  logger.log("=".repeat(60));

  try {
    await testThemeFusionBasic();
    logger.log("\n" + "-".repeat(60) + "\n");

    await testThemeFusionConflict();
    logger.log("\n" + "-".repeat(60) + "\n");

    await testThemeFusionCoverage();
    logger.log("\n" + "=".repeat(60));
    logger.log("✅ ALL TESTS COMPLETED");
    logger.log("=".repeat(60));
  } catch (error) {
    logger.error("\n❌ TEST SUITE FAILED:", error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllThemeFusionTests().catch((err) => {
    logger.error("Fatal error:", err);
    process.exit(1);
  });
}

export { testThemeFusionBasic, testThemeFusionConflict, testThemeFusionCoverage };
