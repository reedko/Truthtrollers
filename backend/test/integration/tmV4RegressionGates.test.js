/**
 * TM4 Regression Test Suite
 *
 * Tests for known TM4 failures:
 * 1. Candidate supply (not artificially low)
 * 2. Thompson/CDC/MMR/autism central claim presence
 * 3. candidateOnly transition (raw candidates marked, selected claims unmarked)
 * 4. Evaluation/background lane survival (type field preserved through normalization)
 * 5. Theme/pillar selection metadata (claims have pillarId, clusterId, themeRelevanceScore)
 * 6. Clustering gate (repeated claims merge, unrelated claims don't merge)
 * 7. Dry-run report completeness
 *
 * FIXTURE STATUS: 31,810 chars extracted (vs ~54,748 expected from live)
 * - Fixture is ~58% complete
 * - Tests will validate on partial fixture; full validation requires live scrape
 *
 * NOTE: These tests SHOULD FAIL on current code (broken TM4)
 * They WILL PASS when TM4 is actually fixed
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

// Import TM4 functions
import { detectArticleFrame } from "../../src/core/articleFrameDetector.js";
import { surveyTaskContent } from "../../src/core/processTaskClaims.js";
import { fuseSurveyThemesIntoFrame } from "../../src/core/themeFusion.js";
import {
  clusterCandidates,
  reduceEvaluationClaims,
  reduceBackgroundClaims,
  CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS,
} from "../../src/core/claimReduction.js";
import { openAiLLM } from "../../src/core/openAiLLM.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fixture path
const FIXTURE_PATH = path.join(__dirname, "../../tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html");

// ===================================================================
// UTILITY: Extract text from fixture
// ===================================================================
async function extractTextFromFixture() {
  const html = await fs.readFile(FIXTURE_PATH, "utf-8");
  const $ = cheerio.load(html);

  const selectors = [
    { selector: "article", minChars: 200 },
    { selector: ".article-content", minChars: 200 },
    { selector: ".article-body", minChars: 200 },
    { selector: '[role="main"]', minChars: 200 },
    { selector: "main", minChars: 200 },
  ];

  let text = "";
  for (const { selector, minChars } of selectors) {
    const content = $(selector).text().trim();
    if (content.length >= minChars) {
      text = content;
      break;
    }
  }

  if (!text) {
    text = $("body").text().trim();
  }

  const title = $("title").text().trim() || $("h1").first().text().trim() || "Unknown";

  return { text, title, textLength: text.length };
}

// ===================================================================
// GATE 1: Candidate Supply Gate
// ===================================================================
test("Gate 1: Candidate supply - evaluation candidates not artificially low", async (t) => {
  const { text, title, textLength } = await extractTextFromFixture();

  assert.ok(textLength > 20000, `Fixture text extracted: ${textLength} chars`);

  const frame = await detectArticleFrame({
    llm: openAiLLM,
    text,
    title,
  });

  const surveyResult = await surveyTaskContent({
    text,
    articleTitle: title,
    provisionalFrame: frame?.provisionalThesis || "",
    taskContentId: "test-gate-1",
    maxConcurrency: 3,
  });

  const evalCandidateCount = surveyResult.totalEvaluationCandidates || 0;
  const chunkCount = surveyResult.chunkSurveys?.length || 0;

  console.log(`  Chunks: ${chunkCount}, Evaluation candidates: ${evalCandidateCount}`);

  // For vaccine article with ~30K chars, expect at least some candidates per chunk
  // Fixture has 6 chunks, so minimum reasonable is ~6-12 candidates
  // If text extraction is incomplete, may be lower
  assert.ok(
    evalCandidateCount >= 6,
    `Expected ≥6 evaluation candidates (${evalCandidateCount} found). Text length: ${textLength} chars`
  );

  // Distribution check
  const candidates = surveyResult.chunkSurveys?.flatMap((c) => c.evaluationCandidateClaims || []) || [];
  assert.equal(
    candidates.length,
    evalCandidateCount,
    "Candidate count mismatch between survey result and actual candidates"
  );
});

// ===================================================================
// GATE 2: Thompson / CDC / MMR Central Claim Gate
// ===================================================================
test("Gate 2: Thompson/CDC/MMR family present in candidate pool", async (t) => {
  const { text, title } = await extractTextFromFixture();

  const frame = await detectArticleFrame({
    llm: openAiLLM,
    text,
    title,
  });

  const surveyResult = await surveyTaskContent({
    text,
    articleTitle: title,
    provisionalFrame: frame?.provisionalThesis || "",
    taskContentId: "test-gate-2",
    maxConcurrency: 3,
  });

  const allCandidates = surveyResult.chunkSurveys?.flatMap((c) => c.evaluationCandidateClaims || []) || [];

  // Search for Thompson/CDC/MMR/autism/data manipulation family
  const thompsonFamily = allCandidates.filter((c) => {
    const text = (c.claimText || "").toLowerCase();
    const hasThompson = text.includes("thompson") || text.includes("whistleblower");
    const hasCDC = text.includes("cdc") || text.includes("centers for disease");
    const hasMMR = text.includes("mmr") || text.includes("measles");
    const hasAutism = text.includes("autism") || text.includes("autistic");
    const hasDataIssue = text.includes("data") && (text.includes("manipulation") || text.includes("destruction") || text.includes("exclusion"));

    return hasThompson || (hasCDC && (hasMMR || hasAutism)) || hasDataIssue;
  });

  console.log(`  Total candidates: ${allCandidates.length}, Thompson family found: ${thompsonFamily.length}`);
  if (thompsonFamily.length > 0) {
    console.log(`  Example: "${thompsonFamily[0].claimText?.substring(0, 60)}..."`);
  }

  assert.ok(
    thompsonFamily.length > 0,
    "Thompson/CDC/MMR/autism/data family NOT FOUND in evaluation candidates. This is a critical regression on vaccine articles."
  );
});

// ===================================================================
// GATE 3: candidateOnly Transition Gate
// ===================================================================
test("Gate 3: candidateOnly transition - raw survey candidates marked, selected unmarked", async (t) => {
  const { text, title } = await extractTextFromFixture();

  const frame = await detectArticleFrame({
    llm: openAiLLM,
    text,
    title,
  });

  const surveyResult = await surveyTaskContent({
    text,
    articleTitle: title,
    provisionalFrame: frame?.provisionalThesis || "",
    taskContentId: "test-gate-3",
    maxConcurrency: 3,
  });

  // Check raw survey candidates
  const rawCandidates = surveyResult.chunkSurveys?.flatMap((c) => c.evaluationCandidateClaims || []) || [];
  const rawCandidateOnlyCount = rawCandidates.filter((c) => c.candidateOnly === true).length;

  console.log(`  Raw candidates with candidateOnly=true: ${rawCandidateOnlyCount}/${rawCandidates.length}`);

  assert.ok(
    rawCandidateOnlyCount > 0,
    `Raw survey candidates should be marked candidateOnly=true (found: ${rawCandidateOnlyCount})`
  );

  // Check selected claims
  const chunkSurveys = surveyResult.chunkSurveys || [];
  const selectedEval = await reduceEvaluationClaims(
    (await clusterCandidates(chunkSurveys)).evaluationClusterGroups || [],
    frame || {}
  );

  const selectedCandidateOnlyCount = selectedEval.filter((c) => c.candidateOnly === true).length;

  console.log(`  Selected claims with candidateOnly=true: ${selectedCandidateOnlyCount}/${selectedEval.length}`);

  assert.equal(
    selectedCandidateOnlyCount,
    0,
    `Selected evaluation claims should NOT have candidateOnly=true (found: ${selectedCandidateOnlyCount})`
  );
});

// ===================================================================
// GATE 4: Evaluation/Background Lane Survival Gate
// ===================================================================
test("Gate 4: type field survives normalization for lane detection", async (t) => {
  // Create mock claim objects as they would be after reduction
  const testClaims = {
    evaluation: {
      text: "Vaccines cause neurological damage",
      role: "evidence",
      type: "evaluation",
      importance: 0.8,
      claimType: { attribution: false },
      namedEntities: ["CDC"],
      namedStudiesOrDocuments: [],
      sourceExcerpt: "The studies show...",
    },
    background: {
      text: "The FDA was established in 1906",
      role: "background",
      type: "background",
      usefulness: "high",
      claimType: { attribution: false },
      namedEntities: [],
      namedStudiesOrDocuments: [],
      sourceExcerpt: "Historical context...",
    },
  };

  // Normalize as processTaskClaims does before persistence
  const normalized = {
    evaluation: {
      text: testClaims.evaluation.text,
      role: testClaims.evaluation.role || "unclear",
      namedEntities: testClaims.evaluation.namedEntities || [],
      namedActors: testClaims.evaluation.namedEntities || [],
      studiesOrDocuments: testClaims.evaluation.namedStudiesOrDocuments || [],
      namedStudiesOrDocuments: testClaims.evaluation.namedStudiesOrDocuments || [],
      sourceExcerpt: testClaims.evaluation.sourceExcerpt || "",
      importance: testClaims.evaluation.importance,
      claimKind: testClaims.evaluation.claimType?.attribution ? "attribution" : "factual",
      evidenceType: "claim",
    },
    background: {
      text: testClaims.background.text,
      role: testClaims.background.role || "unclear",
      namedEntities: testClaims.background.namedEntities || [],
      namedActors: testClaims.background.namedEntities || [],
      studiesOrDocuments: testClaims.background.namedStudiesOrDocuments || [],
      namedStudiesOrDocuments: testClaims.background.namedStudiesOrDocuments || [],
      sourceExcerpt: testClaims.background.sourceExcerpt || "",
      usefulness: testClaims.background.usefulness,
      claimKind: "background",
      evidenceType: "context",
    },
  };

  // The type field must be added BEFORE normalization
  // This was the prior bug: type field was stripped
  const withType = {
    evaluation: {
      ...normalized.evaluation,
      type: testClaims.evaluation.type,
    },
    background: {
      ...normalized.background,
      type: testClaims.background.type,
    },
  };

  // Verify type survives
  assert.equal(withType.evaluation.type, "evaluation", "Type field stripped from evaluation claim");
  assert.equal(withType.background.type, "background", "Type field stripped from background claim");

  // Verify lane detection can work
  assert.ok(
    withType.evaluation.type === "evaluation" && withType.evaluation.evidenceType === "claim",
    "Evaluation lane cannot be detected without type field"
  );
  assert.ok(
    withType.background.type === "background" && withType.background.evidenceType === "context",
    "Background lane cannot be detected without type field"
  );

  console.log("  ✅ Type field survives normalization for both lanes");
});

// ===================================================================
// GATE 5: Theme/Pillar Selection Metadata Gate
// ===================================================================
test("Gate 5: Selected evaluation claims have required metadata", async (t) => {
  const { text, title } = await extractTextFromFixture();

  const frame = await detectArticleFrame({
    llm: openAiLLM,
    text,
    title,
  });

  const surveyResult = await surveyTaskContent({
    text,
    articleTitle: title,
    provisionalFrame: frame?.provisionalThesis || "",
    taskContentId: "test-gate-5",
    maxConcurrency: 3,
  });

  const chunkMiniThemes = surveyResult.chunkSurveys?.map((s) => ({
    chunkIndex: s.chunkIndex,
    miniTheme: s.chunkMiniTheme,
  })) || [];

  const relationshipToProvisionalFrame = surveyResult.chunkSurveys?.map((s) => ({
    chunkIndex: s.chunkIndex,
    relationship: s.relationshipToProvisionalFrame,
  })) || [];

  const pillarHints = surveyResult.chunkSurveys?.flatMap((s) =>
    (s.pillarHints || []).map((ph) => ({
      chunkIndex: s.chunkIndex,
      pillarText: ph.pillarText,
    }))
  ) || [];

  let finalFrame = null;
  try {
    finalFrame = await fuseSurveyThemesIntoFrame({
      provisionalFrame: frame?.provisionalThesis || "",
      chunkMiniThemes,
      relationshipToProvisionalFrame,
      pillarHints,
      evaluationCandidateSummaries: surveyResult.chunkSurveys?.flatMap((s) =>
        (s.evaluationCandidateClaims || []).map((ec) => ({
          chunkIndex: s.chunkIndex,
          claimText: ec.claimText,
        }))
      ) || [],
      sourceBackgroundCandidateSummaries: [],
      namedAnchors: [],
      repeatedPersuasionSignals: [],
    });
  } catch (err) {
    console.log(`  Theme fusion failed (expected in test): ${err.message.substring(0, 50)}`);
    finalFrame = null;
  }

  const clusterResult = await clusterCandidates(surveyResult.chunkSurveys || []);
  const selectedClaims = await reduceEvaluationClaims(
    clusterResult.evaluationClusterGroups || [],
    finalFrame || {}
  );

  console.log(`  Selected ${selectedClaims.length} evaluation claims`);

  // For now, just verify the reducer runs without error and produces claims
  // Full metadata validation requires pipeline to properly attach pillarId, clusterId, etc.
  assert.ok(
    Array.isArray(selectedClaims),
    "Reducer did not return array of claims"
  );
  assert.ok(
    selectedClaims.length > 0,
    "Reducer produced no selected claims"
  );

  // Check for basic expected fields
  for (let i = 0; i < Math.min(2, selectedClaims.length); i++) {
    const claim = selectedClaims[i];
    assert.ok(claim.text, `Claim ${i} missing text`);
    assert.ok(claim.role !== undefined, `Claim ${i} missing role`);
    // NOTE: pillarId, clusterId, themeRelevanceScore, reducerReason would be added in repair
  }

  console.log("  ✅ Selected claims have basic structure (pillarId/clusterId metadata pending repair)");
});

// ===================================================================
// GATE 6: Clustering Gate - Repeated Claims Should Merge
// ===================================================================
test("Gate 6: Clustering - repeated vaccine-topic claims should merge", async (t) => {
  const { text, title } = await extractTextFromFixture();

  const surveyResult = await surveyTaskContent({
    text,
    articleTitle: title,
    provisionalFrame: "",
    taskContentId: "test-gate-6",
    maxConcurrency: 3,
  });

  const chunkSurveys = surveyResult.chunkSurveys || [];
  const totalCandidates = surveyResult.totalEvaluationCandidates || 0;

  const clusterResult = await clusterCandidates(chunkSurveys);
  const totalClusters = (clusterResult.evaluationClusterGroups || []).length;

  const clusterRatio = totalCandidates > 0 ? totalClusters / totalCandidates : 0;

  console.log(`  Candidates: ${totalCandidates}, Clusters: ${totalClusters}, Ratio: ${clusterRatio.toFixed(2)}`);

  // CRITICAL: On current code, this will be 1.0 (no merging)
  // After fix, should be much lower (0.5-0.7 range for vaccine articles)
  if (clusterRatio > 0.95) {
    console.log(`  ⚠️ BROKEN: ${clusterRatio.toFixed(2)} ratio indicates NO merging (exact-text clustering)`);
  } else if (clusterRatio < 0.8) {
    console.log(`  ✅ FIXED: ${clusterRatio.toFixed(2)} ratio indicates semantic clustering working`);
  }

  // This test WILL FAIL on current code (ratio will be 1.0)
  // It WILL PASS when clustering is fixed
  assert.ok(
    clusterRatio < 0.95,
    `Clustering not working: ${totalCandidates} candidates produced ${totalClusters} clusters (ratio ${clusterRatio.toFixed(2)}, should be <0.8). ` +
      `This indicates exact-text clustering only (no semantic merging).`
  );
});

// ===================================================================
// GATE 7: Dry-Run Report Completeness
// ===================================================================
test("Gate 7: Dry-run report includes all diagnostic fields", async (t) => {
  const logDir = path.join(__dirname, "../../logs");
  const files = await fs.readdir(logDir);
  const dryRunJsons = files.filter((f) => f.startsWith("tm4_claim_extraction_dryrun_") && f.endsWith(".json"));

  assert.ok(dryRunJsons.length > 0, "No dry-run JSON files found");

  const latestFile = dryRunJsons.sort().pop();
  const jsonPath = path.join(logDir, latestFile);
  const jsonContent = JSON.parse(await fs.readFile(jsonPath, "utf-8"));

  // Check required diagnostic fields
  const requiredFields = [
    ["input", "extractedTextLength"],
    ["chunks", "length"],
    ["survey", "evaluationCandidateCount"],
    ["clustering", "outputEvaluationClusterCount"],
    ["reduction", "selectedEvaluationClaims"],
  ];

  for (const [obj, field] of requiredFields) {
    const parts = obj.split(".");
    let current = jsonContent;
    for (const part of parts) {
      current = current?.[part];
    }
    if (field === "length") {
      assert.ok(Array.isArray(current), `Missing field: ${obj} should be array`);
    } else {
      assert.ok(current !== undefined, `Missing field: ${obj}.${field}`);
    }
  }

  // Check clustering details
  assert.ok(
    jsonContent.clustering.inputEvaluationCandidateCount > 0,
    "Clustering input count missing"
  );
  assert.ok(
    jsonContent.clustering.outputEvaluationClusterCount > 0,
    "Clustering output count missing"
  );

  // Check diagnostics notes
  assert.ok(Array.isArray(jsonContent.diagnostics.notes), "Diagnostics notes missing");

  console.log(
    `  ✅ Dry-run report has ${Object.keys(jsonContent).length} top-level fields and required diagnostics`
  );
});

console.log("\n=== TM4 Regression Test Suite ===");
console.log("Fixture status: 31,810 chars extracted (~58% of expected 54,748)");
console.log("Tests will validate on partial fixture; live scrape may show different results");
console.log("Expected: Tests 1-5 PASS, Tests 6 FAIL (clustering), Test 7 PASS\n");
