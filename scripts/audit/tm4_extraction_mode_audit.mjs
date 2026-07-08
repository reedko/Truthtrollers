#!/usr/bin/env node

/**
 * TM4 Extraction Mode Audit
 *
 * Compares three extraction modes from the same fixture HTML:
 * 1. old_article_selector - original limited selector
 * 2. full_body_text - $("body").text() with all content
 * 3. clean_article_body - Divi post-content module, junk excluded
 *
 * Only runs LLM survey ONCE on clean_article_body.
 * Determines if candidate supply issue is extraction-related or pipeline-related.
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

const results = {
  timestamp: TIMESTAMP,
  fixture: FIXTURE_PATH,
  extractionModes: {
    old_article_selector: null,
    full_body_text: null,
    clean_article_body: null,
  },
  surveyResults: null,
};

// ===================================================================
// HELPER: Check for junk markers
// ===================================================================
function checkJunkMarkers(text) {
  const junkPatterns = {
    comments: /comments?/i,
    reply: /reply|respond/i,
    leave_a_reply: /leave a reply/i,
    previous_post: /previous post|previous article/i,
    next_post: /next post|next article/i,
    related_posts: /related posts?|similar articles?/i,
    copyright: /copyright|©|all rights reserved/i,
    footer: /footer|subscribe|newsletter/i,
  };

  const found = {};
  for (const [key, pattern] of Object.entries(junkPatterns)) {
    found[key] = pattern.test(text);
  }
  return found;
}

// ===================================================================
// MODE 1: Old article selector (original limited)
// ===================================================================
function extractOldArticleSelector(html) {
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

  return text;
}

// ===================================================================
// MODE 2: Full body text
// ===================================================================
function extractFullBodyText(html) {
  const $ = cheerio.load(html);
  return $("body").text().trim();
}

// ===================================================================
// MODE 3: Clean article body (Divi post-content only)
// ===================================================================
function extractCleanArticleBody(html) {
  const $ = cheerio.load(html);

  // Target Divi post-content module
  let text = $(".et_pb_module.et_pb_post_content").text().trim();

  if (!text) {
    // Fallback to article tag if Divi selector not found
    text = $("article").text().trim();
  }

  if (!text) {
    // Last resort: body
    text = $("body").text().trim();
  }

  // Remove known junk sections
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
// ANALYZE: Extract and compare
// ===================================================================
async function analyzeExtractions(html) {
  console.log("🔍 Analyzing extraction modes...\n");

  // Mode 1
  const mode1Text = extractOldArticleSelector(html);
  const mode1JunkMarkers = checkJunkMarkers(mode1Text);
  results.extractionModes.old_article_selector = {
    textLength: mode1Text.length,
    first300: mode1Text.substring(0, 300),
    last300: mode1Text.substring(Math.max(0, mode1Text.length - 300)),
    junkMarkersFound: mode1JunkMarkers,
    hasThompson: /thompson/i.test(mode1Text),
    hasCDC: /cdc/i.test(mode1Text),
    hasMMR: /mmr/i.test(mode1Text),
    hasAutism: /autism/i.test(mode1Text),
  };

  console.log(`✅ Mode 1 (old_article_selector): ${mode1Text.length} chars`);
  console.log(`   Thompson: ${results.extractionModes.old_article_selector.hasThompson}`);
  console.log(`   Junk markers: ${Object.values(mode1JunkMarkers).filter(Boolean).length} found`);

  // Mode 2
  const mode2Text = extractFullBodyText(html);
  const mode2JunkMarkers = checkJunkMarkers(mode2Text);
  results.extractionModes.full_body_text = {
    textLength: mode2Text.length,
    first300: mode2Text.substring(0, 300),
    last300: mode2Text.substring(Math.max(0, mode2Text.length - 300)),
    junkMarkersFound: mode2JunkMarkers,
    hasThompson: /thompson/i.test(mode2Text),
    hasCDC: /cdc/i.test(mode2Text),
    hasMMR: /mmr/i.test(mode2Text),
    hasAutism: /autism/i.test(mode2Text),
  };

  console.log(`✅ Mode 2 (full_body_text): ${mode2Text.length} chars`);
  console.log(`   Thompson: ${results.extractionModes.full_body_text.hasThompson}`);
  console.log(`   Junk markers: ${Object.values(mode2JunkMarkers).filter(Boolean).length} found`);

  // Mode 3
  const mode3Text = extractCleanArticleBody(html);
  const mode3JunkMarkers = checkJunkMarkers(mode3Text);
  results.extractionModes.clean_article_body = {
    textLength: mode3Text.length,
    first300: mode3Text.substring(0, 300),
    last300: mode3Text.substring(Math.max(0, mode3Text.length - 300)),
    junkMarkersFound: mode3JunkMarkers,
    hasThompson: /thompson/i.test(mode3Text),
    hasCDC: /cdc/i.test(mode3Text),
    hasMMR: /mmr/i.test(mode3Text),
    hasAutism: /autism/i.test(mode3Text),
  };

  console.log(`✅ Mode 3 (clean_article_body): ${mode3Text.length} chars`);
  console.log(`   Thompson: ${results.extractionModes.clean_article_body.hasThompson}`);
  console.log(`   Junk markers: ${Object.values(mode3JunkMarkers).filter(Boolean).length} found`);

  return mode3Text;
}

// ===================================================================
// RUN SURVEY on clean_article_body ONLY
// ===================================================================
async function runSurvey(cleanText) {
  console.log("\n🟩 Running LLM survey on clean_article_body only...\n");

  const surveyResult = await surveyTaskContent({
    text: cleanText,
    articleTitle: "Public Health's \"Truth\" About Vaccines PART 1",
    provisionalFrame: "",
    taskContentId: "extraction-audit",
    maxConcurrency: 3,
  });

  const chunks = surveyResult.chunkSurveys || [];
  const evalCandidates = surveyResult.totalEvaluationCandidates || 0;
  const bgCandidates = surveyResult.totalBackgroundCandidates || 0;

  // Collect all evaluation candidate texts
  const allEvalCandidates = chunks.flatMap((c) => c.evaluationCandidateClaims || []);

  // Check for Thompson/CDC/MMR family
  const thompsonFamilyFound = allEvalCandidates.filter((c) => {
    const text = (c.claimText || "").toLowerCase();
    return /thompson|cdc|mmr|autism|whistleblower|data.*manip|data.*destruct/.test(text);
  });

  results.surveyResults = {
    cleanTextLength: cleanText.length,
    chunkCount: chunks.length,
    evaluationCandidateCount: evalCandidates,
    backgroundCandidateCount: bgCandidates,
    thompsonFamilyFound: thompsonFamilyFound.length,
    allEvaluationCandidates: allEvalCandidates.map((c) => ({
      text: c.claimText?.substring(0, 80) || "(unknown)",
      role: c.roleHint,
      importance: c.importanceToArticleGuess,
    })),
  };

  console.log(`✅ Survey complete:`);
  console.log(`   Chunks: ${chunks.length}`);
  console.log(`   Evaluation candidates: ${evalCandidates}`);
  console.log(`   Background candidates: ${bgCandidates}`);
  console.log(`   Thompson family found: ${thompsonFamilyFound.length}`);
}

// ===================================================================
// MAIN
// ===================================================================
async function main() {
  try {
    console.log("🚀 TM4 Extraction Mode Audit\n");

    // Read fixture
    const html = await fs.readFile(FIXTURE_PATH, "utf-8");
    console.log(`📖 Loaded fixture: ${FIXTURE_PATH}\n`);

    // Analyze extraction modes
    const cleanText = await analyzeExtractions(html);

    // Run survey only on clean_article_body
    await runSurvey(cleanText);

    // Save results
    const logsDir = path.join(__dirname, "../../backend/logs");
    await fs.mkdir(logsDir, { recursive: true });

    // Save JSON
    const jsonPath = path.join(logsDir, `tm4_extraction_mode_comparison_${TIMESTAMP}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(results, null, 2), "utf-8");
    console.log(`\n✅ JSON: ${jsonPath}`);

    // Save Markdown report
    const mdReport = generateMarkdownReport();
    const mdPath = path.join(logsDir, `tm4_clean_article_candidate_audit_${TIMESTAMP}.md`);
    await fs.writeFile(mdPath, mdReport, "utf-8");
    console.log(`✅ Markdown: ${mdPath}`);

    // Summary
    console.log("\n=== EXTRACTION PARITY AUDIT COMPLETE ===");
    console.log(`Clean article body: ${results.extractionModes.clean_article_body.textLength} chars`);
    console.log(`Evaluation candidates: ${results.surveyResults.evaluationCandidateCount}`);
    console.log(`Thompson/CDC/MMR family found: ${results.surveyResults.thompsonFamilyFound}`);
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
}

// ===================================================================
// GENERATE MARKDOWN REPORT
// ===================================================================
function generateMarkdownReport() {
  const m1 = results.extractionModes.old_article_selector;
  const m2 = results.extractionModes.full_body_text;
  const m3 = results.extractionModes.clean_article_body;
  const s = results.surveyResults;

  const lines = [];

  lines.push("# TM4 Extraction Mode Audit\n");
  lines.push(`**Timestamp:** ${TIMESTAMP}\n`);

  lines.push("## Extraction Mode Comparison\n");
  lines.push("| Mode | Length | Thompson | CDC | MMR | Autism | Junk Markers |");
  lines.push("|------|--------|----------|-----|-----|--------|--------------|");
  lines.push(
    `| old_article_selector | ${m1.textLength} | ${m1.hasThompson ? "✅" : "❌"} | ${/cdc/i.test(m1.first300 + m1.last300) ? "✅" : "❌"} | ${m1.hasMMR ? "✅" : "❌"} | ${m1.hasAutism ? "✅" : "❌"} | ${Object.values(m1.junkMarkersFound).filter(Boolean).length} |`
  );
  lines.push(
    `| full_body_text | ${m2.textLength} | ${m2.hasThompson ? "✅" : "❌"} | ${/cdc/i.test(m2.first300 + m2.last300) ? "✅" : "❌"} | ${m2.hasMMR ? "✅" : "❌"} | ${m2.hasAutism ? "✅" : "❌"} | ${Object.values(m2.junkMarkersFound).filter(Boolean).length} |`
  );
  lines.push(
    `| clean_article_body | ${m3.textLength} | ${m3.hasThompson ? "✅" : "❌"} | ${/cdc/i.test(m3.first300 + m3.last300) ? "✅" : "❌"} | ${m3.hasMMR ? "✅" : "❌"} | ${m3.hasAutism ? "✅" : "❌"} | ${Object.values(m3.junkMarkersFound).filter(Boolean).length} |`
  );
  lines.push("");

  lines.push("## Clean Article Body Analysis\n");
  lines.push(`- **Text length:** ${m3.textLength} chars`);
  lines.push(`- **Expected range:** 50–56K chars`);
  lines.push(`- **Range assessment:** ${m3.textLength >= 50000 && m3.textLength <= 56000 ? "✅ Within expected range" : m3.textLength < 50000 ? "⚠️ Below expected range" : "⚠️ Above expected range"}`);
  lines.push("");

  lines.push("## Survey Results (clean_article_body)\n");
  lines.push(`- **Chunks:** ${s.chunkCount}`);
  lines.push(`- **Evaluation candidates:** ${s.evaluationCandidateCount}`);
  lines.push(`- **Background candidates:** ${s.backgroundCandidateCount}`);
  lines.push(`- **Thompson/CDC/MMR family found:** ${s.thompsonFamilyFound}`);
  lines.push("");

  lines.push("## Candidate Supply Assessment\n");
  if (s.evaluationCandidateCount >= 50) {
    lines.push(
      `✅ **Candidate supply is OKAY.** Clean article body produces ${s.evaluationCandidateCount} evaluation candidates.`
    );
    lines.push(`   Previous ~30-candidate runs likely used wrong extraction path or incomplete text.`);
  } else if (s.evaluationCandidateCount >= 30) {
    lines.push(
      `⚠️ **Candidate supply is REDUCED.** Clean article body produces ${s.evaluationCandidateCount} candidates (expected 50+).`
    );
    lines.push(`   Pipeline may not be extracting all candidates from the full text.`);
  } else {
    lines.push(
      `❌ **Candidate supply is BROKEN.** Clean article body produces only ${s.evaluationCandidateCount} candidates.`
    );
    lines.push(`   Issue is not extraction; it's in the survey/extraction pipeline.`);
  }
  lines.push("");

  lines.push("## All Evaluation Candidates\n");
  for (let i = 0; i < s.allEvaluationCandidates.length; i++) {
    const c = s.allEvaluationCandidates[i];
    lines.push(`${i + 1}. ${c.text}... (role: ${c.role}, importance: ${c.importance})`);
  }
  lines.push("");

  lines.push("## Thompson/CDC/MMR Family Candidates\n");
  if (s.thompsonFamilyFound > 0) {
    lines.push(`✅ **${s.thompsonFamilyFound} candidates matched Thompson/CDC/MMR family**`);
    const thompsonCandidates = s.allEvaluationCandidates.filter((c) => {
      const text = c.text.toLowerCase();
      return /thompson|cdc|mmr|autism|whistleblower|data.*manip|data.*destruct/.test(text);
    });
    for (const c of thompsonCandidates) {
      lines.push(`- ${c.text}`);
    }
  } else {
    lines.push(`❌ **No Thompson/CDC/MMR family candidates found**`);
  }
  lines.push("");

  lines.push("---\n");
  lines.push("**No evidence. No persistence. Extraction audit only.**\n");

  return lines.join("\n");
}

main();
