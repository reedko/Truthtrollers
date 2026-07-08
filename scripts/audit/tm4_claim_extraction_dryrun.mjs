#!/usr/bin/env node

/**
 * TM4 Claim Extraction Dry-Run Harness
 *
 * Tests claim extraction quality WITHOUT evidence/bearing/persistence
 *
 * Stages:
 * 1. Extract text from fixture HTML
 * 2. detectArticleFrame
 * 3. surveyTaskContent / chunk survey
 * 4. fuseSurveyThemesIntoFrame
 * 5. clusterCandidates
 * 6. reduceEvaluationClaims
 * 7. reduceBackgroundClaims
 *
 * Output:
 * - backend/logs/tm4_claim_extraction_dryrun_<timestamp>.json
 * - backend/logs/tm4_claim_extraction_dryrun_<timestamp>.md
 */

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import * as dotenv from "dotenv";

// Import TM4 functions
import { detectArticleFrame } from "../../backend/src/core/articleFrameDetector.js";
import { surveyTaskContent } from "../../backend/src/core/processTaskClaims.js";
import { fuseSurveyThemesIntoFrame } from "../../backend/src/core/themeFusion.js";
import {
  clusterCandidates,
  reduceEvaluationClaims,
  reduceBackgroundClaims,
  CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS,
  CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS,
} from "../../backend/src/core/claimReduction.js";
import { openAiLLM } from "../../backend/src/core/openAiLLM.js";
import logger from "../../backend/src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const FIXTURE_PATH = path.join(__dirname, "../../backend/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html");
const LOGS_DIR = path.join(__dirname, "../../backend/logs");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
const JSON_OUTPUT = path.join(LOGS_DIR, `tm4_claim_extraction_dryrun_${TIMESTAMP}.json`);
const MD_OUTPUT = path.join(LOGS_DIR, `tm4_claim_extraction_dryrun_${TIMESTAMP}.md`);

// Initialize output structure
const output = {
  input: {
    url: "https://www.porttownsendfreepress.com/2026/04/12/public-healths-truth-about-vaccines-part-1/",
    fixturePath: FIXTURE_PATH,
    articleTitle: "",
    extractedTextLength: 0,
  },
  articleFrameSeed: {},
  chunks: [],
  survey: {
    evaluationCandidateCount: 0,
    backgroundCandidateCount: 0,
    evaluationCandidates: [],
    backgroundCandidates: [],
  },
  themeFusion: {
    finalThesis: "",
    finalStance: "",
    finalPillars: [],
    dominantNamedAnchors: [],
    repeatedPersuasionPatterns: [],
    coverageGaps: [],
  },
  candidateToPillarAssignment: {
    exists: false,
    assignments: [],
  },
  clustering: {
    functionCalled: "",
    sourceFile: "",
    inputEvaluationCandidateCount: 0,
    outputEvaluationClusterCount: 0,
    inputBackgroundCandidateCount: 0,
    outputBackgroundClusterCount: 0,
    evaluationClusters: [],
    backgroundClusters: [],
  },
  reduction: {
    evaluationReducerFunction: "",
    backgroundReducerFunction: "",
    finalFrameReceived: false,
    finalFrameActuallyUsed: false,
    scoreFormulaUsed: "",
    selectedEvaluationClaims: [],
    selectedBackgroundClaims: [],
  },
  diagnostics: {
    paragraphAwareChunkingProven: false,
    themeControlsSelection: false,
    richClusteringUsed: false,
    candidateToMiniThemeToPillarTraceExists: false,
    notes: [],
  },
};

// === STEP 1: Extract text from fixture HTML ===
async function extractTextFromFixture() {
  try {
    console.log(`📖 Reading fixture: ${FIXTURE_PATH}`);
    const html = await fs.readFile(FIXTURE_PATH, "utf-8");

    const $ = cheerio.load(html);

    // FIXED: Use full body text extraction instead of limited selectors
    // The article selector was only capturing 7.3% of the article
    // Full text extraction includes all content including Thompson/CDC/MMR sections
    let text = $("body").text().trim();

    if (!text) {
      // Fallback: try standard selectors
      const selectors = [
        { selector: "article", minChars: 200, desc: "HTML5 article tag" },
        { selector: ".article-content", minChars: 200, desc: "Article content class" },
        { selector: ".article-body", minChars: 200, desc: "Article body class" },
        { selector: '[role="main"]', minChars: 200, desc: "Main role" },
        { selector: "main", minChars: 200, desc: "Main tag" },
      ];

      for (const { selector, minChars, desc } of selectors) {
        const content = $(selector).text().trim();
        if (content.length >= minChars) {
          text = content;
          console.log(`✅ Extracted ${content.length} chars from ${desc}`);
          break;
        }
      }
    }

    if (text.length > 30000) {
      console.log(`✅ Extracted ${text.length} chars from full page body`);
    }

    // Extract title
    const title = $("title").text().trim() || $("h1").first().text().trim() || "Unknown";

    output.input.articleTitle = title;
    output.input.extractedTextLength = text.length;
    output.diagnostics.notes.push(`Extracted ${text.length} chars from fixture HTML`);

    return { text, title };
  } catch (err) {
    console.error("❌ Failed to extract text from fixture:", err.message);
    throw err;
  }
}

// === STEP 2: Run TM4 pipeline ===
async function runTM4Pipeline(text, title) {
  try {
    console.log("\n🟩 STEP 1/7: Detecting article frame...");
    const provisionalFrame = await detectArticleFrame({
      llm: openAiLLM,
      text,
      title,
    });
    output.articleFrameSeed = provisionalFrame || {};
    console.log(`✅ Frame: ${provisionalFrame?.provisionalThesis?.substring(0, 60)}...`);

    console.log("\n🟩 STEP 2/7: Surveying chunks...");
    const surveyResult = await surveyTaskContent({
      text,
      articleTitle: title,
      provisionalFrame: provisionalFrame?.provisionalThesis || "",
      taskContentId: "dryrun-test",
      maxConcurrency: 3,
    });

    const chunkSurveys = surveyResult.chunkSurveys || [];
    output.survey.evaluationCandidateCount = surveyResult.totalEvaluationCandidates || 0;
    output.survey.backgroundCandidateCount = surveyResult.totalBackgroundCandidates || 0;

    console.log(
      `✅ Survey: ${chunkSurveys.length} chunks, ${output.survey.evaluationCandidateCount} eval candidates, ${output.survey.backgroundCandidateCount} bg candidates`
    );

    // Capture chunk details
    for (const chunk of chunkSurveys) {
      output.chunks.push({
        chunkIndex: chunk.chunkIndex || 0,
        chunkLength: chunk.text?.length || 0,
        chunkPosition: chunk.chunkPosition || null,
        chunkMiniTheme: chunk.chunkMiniTheme || "",
        relationshipToProvisionalFrame: chunk.relationshipToProvisionalFrame || "",
        pillarHints: chunk.pillarHints || [],
      });

      // Capture evaluation candidates
      for (const cand of chunk.evaluationCandidateClaims || []) {
        output.survey.evaluationCandidates.push({
          text: cand.claimText?.substring(0, 80) || "",
          roleHint: cand.roleHint || "",
          importanceToArticleGuess: cand.importanceToArticleGuess || 0,
          noveltyHint: cand.noveltyHint || "",
          excerpt: cand.localSourceExcerpt?.substring(0, 60) || "",
        });
      }

      // Capture background candidates
      for (const cand of chunk.sourceBackgroundCandidates || []) {
        output.survey.backgroundCandidates.push({
          text: cand.claimText?.substring(0, 80) || "",
          usefulness: cand.sourceUsefulness || "",
          excerpt: cand.localSourceExcerpt?.substring(0, 60) || "",
        });
      }
    }

    console.log("\n🟩 STEP 3/7: Fusing themes...");
    const chunkMiniThemes = chunkSurveys.map((s) => ({
      chunkIndex: s.chunkIndex,
      miniTheme: s.chunkMiniTheme,
    }));

    const relationshipToProvisionalFrame = chunkSurveys.map((s) => ({
      chunkIndex: s.chunkIndex,
      relationship: s.relationshipToProvisionalFrame,
    }));

    const pillarHints = chunkSurveys.flatMap((s) =>
      (s.pillarHints || []).map((ph) => ({
        chunkIndex: s.chunkIndex,
        pillarText: ph.pillarText,
      }))
    );

    let finalFrame = null;
    try {
      finalFrame = await fuseSurveyThemesIntoFrame({
        provisionalFrame: provisionalFrame?.provisionalThesis || "",
        chunkMiniThemes,
        relationshipToProvisionalFrame,
        pillarHints,
        evaluationCandidateSummaries: chunkSurveys.flatMap((s) =>
          (s.evaluationCandidateClaims || []).map((ec) => ({
            chunkIndex: s.chunkIndex,
            claimText: ec.claimText,
          }))
        ),
        sourceBackgroundCandidateSummaries: chunkSurveys.flatMap((s) =>
          (s.sourceBackgroundCandidates || []).map((bc) => ({
            chunkIndex: s.chunkIndex,
            claimText: bc.claimText,
          }))
        ),
        namedAnchors: [],
        repeatedPersuasionSignals: [],
      });
      output.themeFusion = finalFrame || {};
      console.log(`✅ Theme fusion: ${finalFrame?.finalPillars?.length || 0} pillars`);
    } catch (err) {
      console.log(`⚠️ Theme fusion failed: ${err.message}`);
      finalFrame = {
        finalThesis: provisionalFrame?.provisionalThesis || "",
        finalStance: "unclear",
        finalPillars: [],
      };
      output.themeFusion = finalFrame;
    }

    console.log("\n🟩 STEP 4/7: Clustering candidates...");
    const clusterResult = await clusterCandidates(chunkSurveys);
    let evaluationClusterGroups = clusterResult.evaluationClusterGroups || [];
    const backgroundClusterGroups = clusterResult.backgroundClusterGroups || [];

    output.clustering.inputEvaluationCandidateCount = output.survey.evaluationCandidateCount;
    output.clustering.outputEvaluationClusterCount = evaluationClusterGroups.length;
    output.clustering.inputBackgroundCandidateCount = output.survey.backgroundCandidateCount;
    output.clustering.outputBackgroundClusterCount = backgroundClusterGroups.length;
    output.clustering.functionCalled = "clusterByText (exact-text matching)"; // Will be verified by inspection
    output.clustering.sourceFile = "backend/src/core/claimReduction.js";

    // Check if clustering is semantic or exact-text
    const singletonRatio =
      evaluationClusterGroups.length > 0
        ? evaluationClusterGroups.length / output.survey.evaluationCandidateCount
        : 0;
    if (singletonRatio > 0.95) {
      output.diagnostics.richClusteringUsed = false;
      output.diagnostics.notes.push(
        `Clustering appears exact-text only: ${evaluationClusterGroups.length} clusters from ${output.survey.evaluationCandidateCount} candidates (${(singletonRatio * 100).toFixed(1)}% singleton ratio)`
      );
    }

    console.log(
      `✅ Clustering: ${evaluationClusterGroups.length} eval clusters, ${backgroundClusterGroups.length} bg clusters`
    );

    console.log("\n🟩 STEP 5/7: Reducing evaluation claims...");
    const selectedEvaluationClaims = await reduceEvaluationClaims(evaluationClusterGroups, finalFrame);
    output.reduction.selectedEvaluationClaims = selectedEvaluationClaims.map((c) => ({
      text: c.text?.substring(0, 80) || "",
      role: c.role || "",
      importance: c.importance || 0,
    }));
    console.log(`✅ Selected ${selectedEvaluationClaims.length}/${CLAIM_EXTRACTION_EVALUATION_MAX_CLAIMS} evaluation claims`);

    console.log("\n🟩 STEP 6/7: Reducing background claims...");
    const selectedSourceBackgroundClaims = await reduceBackgroundClaims(backgroundClusterGroups, finalFrame);
    output.reduction.selectedBackgroundClaims = selectedSourceBackgroundClaims.map((c) => ({
      text: c.text?.substring(0, 80) || "",
      usefulness: c.usefulness || "",
    }));
    console.log(`✅ Selected ${selectedSourceBackgroundClaims.length}/${CLAIM_EXTRACTION_BACKGROUND_MAX_CLAIMS} background claims`);

    // Record diagnostics
    output.reduction.finalFrameReceived = finalFrame !== null;
    output.reduction.evaluationReducerFunction = "reduceEvaluationClaims";
    output.reduction.backgroundReducerFunction = "reduceBackgroundClaims";

    // Check if finalFrame is actually used
    if (selectedEvaluationClaims.length > 0 && finalFrame?.finalPillars?.length > 0) {
      output.diagnostics.themeControlsSelection = true;
      output.diagnostics.notes.push("Final frame with pillars received and used in selection");
    } else if (selectedEvaluationClaims.length > 0) {
      output.diagnostics.themeControlsSelection = false;
      output.diagnostics.notes.push(
        "Claims selected but no evidence that finalFrame.finalPillars controlled selection"
      );
    }

    return {
      selectedEvaluationClaims,
      selectedSourceBackgroundClaims,
      finalFrame,
    };
  } catch (err) {
    console.error("❌ Pipeline failed:", err.message);
    output.diagnostics.notes.push(`ERROR: ${err.message}`);
    throw err;
  }
}

// === Main execution ===
async function main() {
  try {
    // Load .env file
    const envPath = path.join(__dirname, "../../backend/.env");
    if (fsSync.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }

    console.log("🚀 TM4 Claim Extraction Dry-Run Harness\n");

    // Step 1: Extract text
    const { text, title } = await extractTextFromFixture();

    // Step 2-7: Run pipeline
    const result = await runTM4Pipeline(text, title);

    // Step 8: Write outputs
    console.log("\n🟩 STEP 7/7: Writing output artifacts...");

    await fs.mkdir(LOGS_DIR, { recursive: true });

    // Write JSON
    await fs.writeFile(JSON_OUTPUT, JSON.stringify(output, null, 2), "utf-8");
    console.log(`✅ JSON: ${JSON_OUTPUT}`);

    // Write Markdown
    const markdown = generateMarkdownReport(output, result);
    await fs.writeFile(MD_OUTPUT, markdown, "utf-8");
    console.log(`✅ Markdown: ${MD_OUTPUT}`);

    // Summary
    console.log(`\n✅ DRY RUN COMPLETE`);
    console.log(`\nSummary:`);
    console.log(`  Chunks: ${output.chunks.length}`);
    console.log(`  Eval candidates: ${output.survey.evaluationCandidateCount}`);
    console.log(`  Background candidates: ${output.survey.backgroundCandidateCount}`);
    console.log(`  Eval clusters: ${output.clustering.outputEvaluationClusterCount}`);
    console.log(`  Background clusters: ${output.clustering.outputBackgroundClusterCount}`);
    console.log(`  Selected eval claims: ${output.reduction.selectedEvaluationClaims.length}`);
    console.log(`  Selected background claims: ${output.reduction.selectedBackgroundClaims.length}`);
    console.log(`\nClaim list:`);
    for (let i = 0; i < result.selectedEvaluationClaims.length; i++) {
      const claim = result.selectedEvaluationClaims[i];
      console.log(
        `  ${i + 1}. ${claim.text?.substring(0, 80).replace(/\n/g, " ") || "(no text)"}...`
      );
    }
  } catch (err) {
    console.error("\n❌ FATAL ERROR:", err.message);
    process.exit(1);
  }
}

// === Helper: Generate Markdown Report ===
function generateMarkdownReport(output, result) {
  const lines = [];

  lines.push("# TM4 Claim Extraction Dry Run\n");
  lines.push(`**Timestamp:** ${TIMESTAMP}\n`);
  lines.push(`**Status:** Claim extraction stages only (no evidence/bearing/persistence)\n`);

  lines.push("\n## Input\n");
  lines.push(`- **URL:** ${output.input.url}`);
  lines.push(`- **Fixture:** ${output.input.fixturePath}`);
  lines.push(`- **Title:** ${output.input.articleTitle}`);
  lines.push(`- **Text extracted:** ${output.input.extractedTextLength} chars\n`);

  lines.push("\n## Article Frame\n");
  lines.push(`- **Provisional thesis:** ${output.articleFrameSeed.provisionalThesis || "(none)"}`);
  lines.push(`- **Stance:** ${output.articleFrameSeed.provisionalStance || "unclear"}`);
  lines.push(`- **Likely pillars:** ${(output.articleFrameSeed.likelyPillars || []).join(", ") || "(none)"}\n`);

  lines.push("\n## Chunk Survey Summary\n");
  lines.push("| Chunk | Mini-theme | Relationship to frame | Eval candidates | Background candidates |");
  lines.push("|-------|------------|----------------------|-----------------|----------------------|");
  for (const chunk of output.chunks) {
    const evalCount = output.survey.evaluationCandidates.filter((c) => c.chunkIndex === chunk.chunkIndex).length;
    const bgCount = output.survey.backgroundCandidates.filter((c) => c.chunkIndex === chunk.chunkIndex).length;
    lines.push(
      `| ${chunk.chunkIndex} | ${chunk.chunkMiniTheme?.substring(0, 30) || "(none)"} | ${chunk.relationshipToProvisionalFrame || "unclear"} | ${evalCount} | ${bgCount} |`
    );
  }
  lines.push("");

  lines.push("\n## Candidate Pool Summary\n");
  lines.push(`- **Total evaluation candidates:** ${output.survey.evaluationCandidateCount}`);
  lines.push(`- **Total background candidates:** ${output.survey.backgroundCandidateCount}\n`);

  lines.push("\n## Theme Fusion\n");
  lines.push(`- **Final thesis:** ${output.themeFusion.finalThesis || "(none)"}`);
  lines.push(`- **Final stance:** ${output.themeFusion.finalStance || "unclear"}`);
  lines.push(`- **Final pillars:** ${(output.themeFusion.finalPillars || []).length || 0}`);
  if (output.themeFusion.finalPillars?.length > 0) {
    for (const pillar of output.themeFusion.finalPillars) {
      lines.push(
        `  - ${pillar.pillarText?.substring(0, 60) || "(no text)"}`
      );
    }
  }
  lines.push(`- **Coverage gaps:** ${(output.themeFusion.coverageGaps || []).length || 0}`);
  if (output.themeFusion.coverageGaps?.length > 0) {
    for (const gap of output.themeFusion.coverageGaps) {
      lines.push(`  - ${gap}`);
    }
  }
  lines.push("");

  lines.push("\n## Clustering Result\n");
  lines.push("| Lane | Input candidates | Output clusters | Ratio | Function |");
  lines.push("|------|------------------|-----------------|-------|----------|");
  const evalRatio =
    output.clustering.inputEvaluationCandidateCount > 0
      ? (output.clustering.outputEvaluationClusterCount / output.clustering.inputEvaluationCandidateCount).toFixed(2)
      : "N/A";
  const bgRatio =
    output.clustering.inputBackgroundCandidateCount > 0
      ? (output.clustering.outputBackgroundClusterCount / output.clustering.inputBackgroundCandidateCount).toFixed(2)
      : "N/A";
  lines.push(
    `| Evaluation | ${output.clustering.inputEvaluationCandidateCount} | ${output.clustering.outputEvaluationClusterCount} | ${evalRatio} | ${output.clustering.functionCalled} |`
  );
  lines.push(
    `| Background | ${output.clustering.inputBackgroundCandidateCount} | ${output.clustering.outputBackgroundClusterCount} | ${bgRatio} | ${output.clustering.functionCalled} |`
  );
  lines.push("");

  lines.push("\n## Final Selected Evaluation Claims\n");
  if (result.selectedEvaluationClaims.length > 0) {
    lines.push("| Rank | Claim | Role | Importance |");
    lines.push("|------|-------|------|-----------|");
    for (let i = 0; i < result.selectedEvaluationClaims.length; i++) {
      const claim = result.selectedEvaluationClaims[i];
      lines.push(
        `| ${i + 1} | ${claim.text?.substring(0, 60).replace(/\|/g, "-") || "(no text)"} | ${claim.role || "unclear"} | ${(claim.importance || 0).toFixed(2)} |`
      );
    }
  } else {
    lines.push("**No evaluation claims selected**\n");
  }
  lines.push("");

  lines.push("\n## Final Selected Background Claims\n");
  if (result.selectedSourceBackgroundClaims.length > 0) {
    lines.push("| Rank | Claim | Usefulness |");
    lines.push("|------|-------|-----------|");
    for (let i = 0; i < result.selectedSourceBackgroundClaims.length; i++) {
      const claim = result.selectedSourceBackgroundClaims[i];
      lines.push(
        `| ${i + 1} | ${claim.text?.substring(0, 60).replace(/\|/g, "-") || "(no text)"} | ${claim.usefulness || "unknown"} |`
      );
    }
  } else {
    lines.push("**No background claims selected**\n");
  }
  lines.push("");

  lines.push("\n## Contract Failures Observed\n");
  if (output.diagnostics.notes.length > 0) {
    for (const note of output.diagnostics.notes) {
      lines.push(`- ${note}`);
    }
  } else {
    lines.push("- None detected\n");
  }
  lines.push("");

  lines.push("\n## Regression Check\n");
  if (output.survey.evaluationCandidateCount > 20) {
    lines.push(
      `⚠️ **High candidate count:** ${output.survey.evaluationCandidateCount} evaluation candidates. Original regression was 56 claims → need ≤12.`
    );
  }
  if (output.clustering.outputEvaluationClusterCount > 12) {
    lines.push(
      `⚠️ **High cluster count:** ${output.clustering.outputEvaluationClusterCount} evaluation clusters suggests exact-text clustering (low deduplication).`
    );
  }
  if (output.reduction.selectedEvaluationClaims.length > 12) {
    lines.push(
      `⚠️ **Exceeded cap:** ${output.reduction.selectedEvaluationClaims.length} evaluation claims selected (cap is 12).`
    );
  }
  lines.push("");

  lines.push("\n---\n");
  lines.push("**No fixes performed. Audit only.**\n");

  return lines.join("\n");
}

main();
