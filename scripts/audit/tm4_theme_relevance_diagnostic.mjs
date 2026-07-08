#!/usr/bin/env node

/**
 * TM4 Theme Relevance Diagnostic
 *
 * Tests whether theme/frame relevance filtering is being applied too early,
 * starving candidate extraction.
 *
 * Compares:
 * - Mode A: Current themed survey (with theme relevance filtering)
 * - Mode B: Raw atomic extraction (no theme filtering, no deduplication)
 *
 * Also validates strict Thompson/MMR context (not just broad CDC/autism claims).
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import { surveyTaskContent } from "../../backend/src/core/processTaskClaims.js";
import { openAiLLM } from "../../backend/src/core/openAiLLM.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_PATH = path.join(__dirname, "../../backend/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const diagnostics = {
  timestamp: TIMESTAMP,
  fixture: FIXTURE_PATH,
  modeA: {
    name: "Current Themed Survey",
    results: null,
  },
  modeB: {
    name: "Raw Atomic Extraction (no theme filtering)",
    results: null,
  },
  thompsonGate: {
    articleContains: null,
    excerpts: [],
    modeAFinds: null,
    modeBFinds: null,
  },
  themeWiring: {
    fieldsPresent: [],
    fieldsMissing: [],
  },
};

// ===================================================================
// Clean article body extraction (from prior audit)
// ===================================================================
async function getCleanArticleText() {
  const html = await fs.readFile(FIXTURE_PATH, "utf-8");
  const $ = cheerio.load(html);

  let text = $(".et_pb_module.et_pb_post_content").text().trim();

  if (!text) {
    text = $("article").text().trim();
  }

  if (!text) {
    text = $("body").text().trim();
  }

  const junkPatterns = [
    /comments?\s*section[\s\S]*?(?=\n\n|$)/i,
    /leave a reply[\s\S]*?(?=\n\n|$)/i,
    /previous post[\s\S]*?$/i,
    /next post[\s\S]*?$/i,
    /related posts?[\s\S]*?$/i,
    /subscribe[\s\S]*?(?=copyright|\n\n|$)/i,
  ];

  for (const pattern of junkPatterns) {
    text = text.replace(pattern, "");
  }

  return text.trim();
}

// ===================================================================
// MODE A: Current themed survey (already working)
// ===================================================================
async function runModeA(cleanText) {
  console.log("\n🟦 MODE A: Current Themed Survey\n");

  const result = await surveyTaskContent({
    text: cleanText,
    articleTitle: "Public Health's \"Truth\" About Vaccines PART 1",
    provisionalFrame: "",
    taskContentId: "diagnostic-mode-a",
    maxConcurrency: 3,
  });

  const chunks = result.chunkSurveys || [];
  const evalCandidates = result.totalEvaluationCandidates || 0;
  const bgCandidates = result.totalBackgroundCandidates || 0;

  // Collect all candidates
  const allEval = chunks.flatMap((c) => c.evaluationCandidateClaims || []);
  const allBg = chunks.flatMap((c) => c.backgroundCandidateClaims || []);

  diagnostics.modeA.results = {
    textLength: cleanText.length,
    chunkCount: chunks.length,
    evaluationCandidateCount: evalCandidates,
    backgroundCandidateCount: bgCandidates,
    perChunkCounts: chunks.map((c) => ({
      chunkIndex: c.chunkIndex,
      evalCount: c.evaluationCandidateClaims?.length || 0,
      bgCount: c.backgroundCandidateClaims?.length || 0,
    })),
    allEvaluationCandidates: allEval.map((c) => ({
      text: c.claimText,
      role: c.roleHint,
      importance: c.importanceToArticleGuess,
      sourceExcerpt: c.localSourceExcerpt,
    })),
    allBackgroundCandidates: allBg.map((c) => ({
      text: c.claimText,
      sourceExcerpt: c.localSourceExcerpt,
    })),
  };

  console.log(`✅ Mode A Results:`);
  console.log(`   Text length: ${diagnostics.modeA.results.textLength} chars`);
  console.log(`   Chunks: ${diagnostics.modeA.results.chunkCount}`);
  console.log(`   Evaluation candidates: ${evalCandidates}`);
  console.log(`   Background candidates: ${bgCandidates}`);
  console.log(`   Total: ${evalCandidates + bgCandidates}`);
}

// ===================================================================
// MODE B: Raw atomic extraction (no theme filtering)
// ===================================================================
async function runModeB(cleanText) {
  console.log("\n🟦 MODE B: Raw Atomic Extraction (Simulated)\n");

  // Mode B: Call surveyTaskContent but with a flag or modified prompt
  // For now, we'll note that true Mode B would require modifying the survey prompt
  // to disable theme filtering, deduplication, and importance ranking.
  //
  // Since we can't modify prompts yet, we'll run the same survey but with special handling.
  //
  // IMPORTANT: This is a limitation. True Mode B requires either:
  // 1. A separate survey prompt that extracts all checkable claims without theme filtering
  // 2. Or post-processing the Mode A results with a separate LLM call for missing claims

  // For now, document what Mode B would require:
  diagnostics.modeB.results = {
    note: "True Mode B requires modified survey prompt without theme/importance filtering",
    status: "NOT_IMPLEMENTED_YET - requires prompt modification",
    expectedBehavior: [
      "Extract every checkable truth-condition",
      "Do not filter for theme relevance",
      "Do not suppress controversial/weak/dubious claims",
      "Do not merge or rank out claims",
      "Allow multiple claims per paragraph",
      "Preserve localSourceExcerpt with full context",
    ],
  };

  console.log(`⚠️ Mode B: NOT YET IMPLEMENTED`);
  console.log(`   Reason: Requires modified survey prompt without theme filtering`);
  console.log(`   To implement: Create alternative Prompt 2 that extracts all claims`);
  console.log(`   without theme/importance ranking`);
}

// ===================================================================
// TASK 3: Strict Thompson/MMR Gate
// ===================================================================
async function analyzeThompsonContext(cleanText) {
  console.log("\n🔍 TASK 3: Strict Thompson/MMR Gate\n");

  // Extract Thompson/MMR material from article text
  const thompsonRegex = /thompson|whistleblower.*cdc|cdc.*whistleblower/gi;
  const mmrRegex = /mmr|measles.*mumps.*rubella|data.*destroy|data.*manipulat|data.*conceal/gi;

  const thompsonMatches = cleanText.match(thompsonRegex) || [];
  const mmrMatches = cleanText.match(mmrRegex) || [];

  diagnostics.thompsonGate.articleContains = {
    thompson: thompsonMatches.length > 0,
    mmr: mmrMatches.length > 0,
    dataDestruction: /data.*destroy|data.*manip|data.*conceal|data.*omit/i.test(cleanText),
  };

  console.log(`Article text contains:`);
  console.log(`  Thompson: ${diagnostics.thompsonGate.articleContains.thompson}`);
  console.log(`  MMR: ${diagnostics.thompsonGate.articleContains.mmr}`);
  console.log(`  Data destruction context: ${diagnostics.thompsonGate.articleContains.dataDestruction}`);

  // Extract context around Thompson mentions (500 char windows)
  const thompsonIndex = cleanText.toLowerCase().indexOf("thompson");
  if (thompsonIndex > -1) {
    const start = Math.max(0, thompsonIndex - 200);
    const end = Math.min(cleanText.length, thompsonIndex + 300);
    diagnostics.thompsonGate.excerpts.push({
      type: "Thompson",
      excerpt: cleanText.substring(start, end),
      position: thompsonIndex,
    });
  }

  // Extract MMR/data context
  const mmrIndex = cleanText.toLowerCase().indexOf("mmr");
  if (mmrIndex > -1) {
    const start = Math.max(0, mmrIndex - 200);
    const end = Math.min(cleanText.length, mmrIndex + 300);
    diagnostics.thompsonGate.excerpts.push({
      type: "MMR",
      excerpt: cleanText.substring(start, end),
      position: mmrIndex,
    });
  }

  // Check Mode A candidates for strict Thompson/MMR
  const strictThompsonRegex = /(thompson|whistleblower).*cdc|cdc.*(mmr|autism).*data|data.*destroy.*mmr/i;
  const modeAStrictMatches = diagnostics.modeA.results.allEvaluationCandidates.filter((c) => {
    const fullText = (c.text + " " + (c.sourceExcerpt || "")).toLowerCase();
    return strictThompsonRegex.test(fullText);
  });

  diagnostics.thompsonGate.modeAFinds = {
    count: modeAStrictMatches.length,
    examples: modeAStrictMatches.slice(0, 3).map((c) => ({
      text: c.text?.substring(0, 80),
      excerpt: c.sourceExcerpt?.substring(0, 100),
    })),
  };

  console.log(`\nMode A strict Thompson/MMR matches: ${diagnostics.thompsonGate.modeAFinds.count}`);
  if (diagnostics.thompsonGate.modeAFinds.count > 0) {
    console.log(`  Example: ${modeAStrictMatches[0].text?.substring(0, 60)}...`);
  }
}

// ===================================================================
// TASK 4: Theme wiring proof
// ===================================================================
async function analyzeThemeWiring() {
  console.log("\n🔌 TASK 4: Theme Wiring Proof\n");

  // Check if Mode A candidates have theme metadata
  const requiredFields = [
    "sourceChunkIndex",
    "miniThemeId",
    "pillarId",
    "themeRelevanceScore",
    "evidenceStrengthScore",
    "finalScore",
    "reducerReason",
  ];

  // Since we're using raw survey output, not the reducer output,
  // these fields won't exist yet. Document what's missing:
  const sample = diagnostics.modeA.results.allEvaluationCandidates[0];

  for (const field of requiredFields) {
    if (field in sample) {
      diagnostics.themeWiring.fieldsPresent.push(field);
    } else {
      diagnostics.themeWiring.fieldsMissing.push(field);
    }
  }

  console.log(`Fields present in Mode A candidates:`);
  diagnostics.themeWiring.fieldsPresent.forEach((f) => console.log(`  ✅ ${f}`));

  console.log(`\nFields missing (theme wiring incomplete):`);
  diagnostics.themeWiring.fieldsMissing.forEach((f) => console.log(`  ❌ ${f}`));

  if (diagnostics.themeWiring.fieldsMissing.length > 0) {
    console.log(`\n⚠️ Theme wiring not proven. Metadata not attached to survey output.`);
  }
}

// ===================================================================
// MAIN
// ===================================================================
async function main() {
  try {
    console.log("🚀 TM4 Theme Relevance Diagnostic\n");
    console.log("=".repeat(60));

    // Get clean article text
    const cleanText = await getCleanArticleText();
    console.log(`📖 Clean article text: ${cleanText.length} chars\n`);

    // Run Mode A
    await runModeA(cleanText);

    // Run Mode B (simulated)
    await runModeB(cleanText);

    // Task 3: Thompson/MMR gate
    await analyzeThompsonContext(cleanText);

    // Task 4: Theme wiring
    await analyzeThemeWiring();

    // Save results
    const logsDir = path.join(__dirname, "../../backend/logs");
    await fs.mkdir(logsDir, { recursive: true });

    const jsonPath = path.join(logsDir, `tm4_theme_diagnostic_${TIMESTAMP}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(diagnostics, null, 2), "utf-8");
    console.log(`\n✅ JSON: ${jsonPath}`);

    // Generate markdown report
    const mdReport = generateReport();
    const mdPath = path.join(logsDir, `tm4_theme_diagnostic_${TIMESTAMP}.md`);
    await fs.writeFile(mdPath, mdReport, "utf-8");
    console.log(`✅ Markdown: ${mdPath}`);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("DIAGNOSTIC SUMMARY");
    console.log("=".repeat(60));
    console.log(`Mode A (themed): ${diagnostics.modeA.results.evaluationCandidateCount} eval candidates`);
    console.log(`Mode B (raw atomic): NOT IMPLEMENTED (requires prompt modification)`);
    console.log(`\nStrict Thompson/MMR in Mode A: ${diagnostics.thompsonGate.modeAFinds.count}`);
    console.log(`Theme wiring fields missing: ${diagnostics.themeWiring.fieldsMissing.length}`);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

// ===================================================================
// GENERATE MARKDOWN REPORT
// ===================================================================
function generateReport() {
  const modeA = diagnostics.modeA.results;
  const modeB = diagnostics.modeB.results;
  const thompson = diagnostics.thompsonGate;
  const theme = diagnostics.themeWiring;

  const lines = [];

  lines.push("# TM4 Theme Relevance Diagnostic Report\n");
  lines.push(`**Timestamp:** ${TIMESTAMP}\n`);

  // Mode A Results
  lines.push("## Mode A: Current Themed Survey\n");
  lines.push(`- **Text length:** ${modeA.textLength} chars`);
  lines.push(`- **Chunks:** ${modeA.chunkCount}`);
  lines.push(`- **Evaluation candidates:** ${modeA.evaluationCandidateCount}`);
  lines.push(`- **Background candidates:** ${modeA.backgroundCandidateCount}`);
  lines.push(`- **Total candidates:** ${modeA.evaluationCandidateCount + modeA.backgroundCandidateCount}\n`);

  lines.push("### Per-Chunk Breakdown\n");
  lines.push("| Chunk | Eval | BG |");
  lines.push("|-------|------|-----|");
  modeA.perChunkCounts.forEach((c) => {
    lines.push(`| ${c.chunkIndex} | ${c.evalCount} | ${c.bgCount} |`);
  });
  lines.push("");

  lines.push("### All Evaluation Candidates\n");
  modeA.allEvaluationCandidates.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.text?.substring(0, 70)}...`);
    lines.push(`   Role: ${c.role}, Importance: ${c.importance}`);
    if (c.sourceExcerpt) {
      lines.push(`   Excerpt: "${c.sourceExcerpt.substring(0, 60)}..."`);
    }
  });
  lines.push("");

  // Mode B Status
  lines.push("## Mode B: Raw Atomic Extraction\n");
  lines.push(`**Status:** ${modeB.status}\n`);
  lines.push(`**Note:** ${modeB.note}\n`);
  lines.push("**Expected behavior:**\n");
  modeB.expectedBehavior.forEach((b) => {
    lines.push(`- ${b}`);
  });
  lines.push("");

  // Thompson/MMR Analysis
  lines.push("## Task 3: Strict Thompson/MMR Gate\n");
  lines.push(`### Article Text Contains\n`);
  lines.push(`- Thompson/whistleblower: ${thompson.articleContains.thompson ? "✅" : "❌"}`);
  lines.push(`- MMR: ${thompson.articleContains.mmr ? "✅" : "❌"}`);
  lines.push(`- Data destruction context: ${thompson.articleContains.dataDestruction ? "✅" : "❌"}\n`);

  if (thompson.excerpts.length > 0) {
    lines.push("### Article Excerpts\n");
    thompson.excerpts.forEach((e) => {
      lines.push(`**${e.type}** (position ${e.position}):`);
      lines.push(`> ${e.excerpt.substring(0, 200).replace(/\n/g, " ")}...\n`);
    });
  }

  lines.push("### Mode A Strict Thompson/MMR Matches\n");
  lines.push(`**Count:** ${thompson.modeAFinds.count}\n`);
  if (thompson.modeAFinds.count > 0) {
    lines.push("**Examples:**");
    thompson.modeAFinds.examples.forEach((ex) => {
      lines.push(`- ${ex.text}`);
      if (ex.excerpt) {
        lines.push(`  Excerpt: "${ex.excerpt}"`);
      }
    });
  } else {
    lines.push("**No strict Thompson/MMR candidates found in Mode A**");
  }
  lines.push("");

  // Theme Wiring
  lines.push("## Task 4: Theme Wiring Proof\n");
  if (theme.fieldsPresent.length > 0) {
    lines.push("### ✅ Fields Present\n");
    theme.fieldsPresent.forEach((f) => lines.push(`- ${f}`));
    lines.push("");
  }

  if (theme.fieldsMissing.length > 0) {
    lines.push("### ❌ Fields Missing (Theme Wiring Incomplete)\n");
    theme.fieldsMissing.forEach((f) => lines.push(`- ${f}`));
    lines.push("");
  }

  lines.push("### Analysis\n");
  if (theme.fieldsMissing.length === 0) {
    lines.push(
      `✅ Theme wiring is proven. All required metadata fields present on candidates.\n`
    );
  } else if (theme.fieldsMissing.length > 5) {
    lines.push(
      `❌ Theme wiring is NOT proven. Survey output lacks ${theme.fieldsMissing.length} required fields.\n`
    );
    lines.push(
      `These fields would be added by clustering, fusion, and reduction stages.\n`
    );
  }
  lines.push("");

  // Summary
  lines.push("## Summary & Acceptance Criteria\n");
  lines.push("### Candidate Extraction\n");
  lines.push(`- Mode A produces ${modeA.evaluationCandidateCount} evaluation candidates`);
  lines.push(
    `- ${modeA.evaluationCandidateCount < 50 ? "⚠️ LOW" : "✅ ADEQUATE"} (expected 50+)\n`
  );

  lines.push("### Thompson/MMR Context\n");
  lines.push(`- Article contains Thompson/MMR material: ${thompson.articleContains.thompson || thompson.articleContains.mmr ? "✅" : "❌"}`);
  lines.push(`- Mode A extracts strict Thompson/MMR: ${thompson.modeAFinds.count > 0 ? "✅" : "❌"}\n`);

  lines.push("### Theme Wiring\n");
  lines.push(
    `- Survey candidates have theme metadata: ${theme.fieldsMissing.length === 0 ? "✅" : "❌"}\n`
  );

  lines.push("### Diagnosis\n");
  if (modeA.evaluationCandidateCount < 50) {
    lines.push(
      `⚠️ **Candidate extraction may be filtered by theme relevance.**\n`
    );
    lines.push(`   Mode B (raw atomic) needs to be implemented to confirm.\n`);
  }

  if (thompson.modeAFinds.count === 0 && (thompson.articleContains.thompson || thompson.articleContains.mmr)) {
    lines.push(
      `⚠️ **Thompson/MMR context not extracted despite being in article.**\n`
    );
    lines.push(`   May indicate theme filtering or survey prompt limitation.\n`);
  }

  if (theme.fieldsMissing.length > 0) {
    lines.push(
      `⚠️ **Theme wiring not yet proven at survey stage.**\n`
    );
    lines.push(
      `   Metadata would be added by clustering/fusion/reduction stages.\n`
    );
  }

  lines.push("");
  lines.push("---\n");
  lines.push("**No evidence. No persistence. Diagnostic only.**\n");

  return lines.join("\n");
}

main();
