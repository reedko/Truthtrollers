#!/usr/bin/env node

/**
 * TM4 Mode B: RAW_ATOMIC_WITH_FRAME_TAGS Diagnostic
 *
 * Implements atomic extraction without theme/importance filtering.
 * Compares with Mode A to determine if current survey under-extracts.
 *
 * Mode B behavior:
 * - Extracts every checkable atomic truth-condition
 * - Does not filter by importance or theme relevance
 * - Does not suppress controversial/weak/dubious claims
 * - Does not merge or deduplicate
 * - Allows multiple claims per paragraph
 * - Extracts meta-claims (data omitted, whistleblower, etc.)
 * - Classifies role after extraction, not before
 * - Preserves claimOriginExcerpt for every candidate
 *
 * This is audit-only. No production code modified.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import { surveyTaskContent } from "../../backend/src/core/processTaskClaims.js";
import { openAiLLM } from "../../backend/src/core/openAiLLM.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_PATH = path.join(
  __dirname,
  "../../backend/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html"
);
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const comparison = {
  timestamp: TIMESTAMP,
  modeA: {
    evaluationCandidateCount: 0,
    backgroundCandidateCount: 0,
    candidates: [],
    perChunkCounts: [],
  },
  modeB: {
    evaluationCandidateCount: 0,
    backgroundCandidateCount: 0,
    candidates: [],
    perChunkCounts: [],
  },
  thompsonGate: {
    articleExcerpt: null,
    modeAMatches: [],
    modeBMatches: [],
  },
  themeWiringFields: {
    modeAPresent: [],
    modeAMissing: [],
    modeBPresent: [],
    modeBMissing: [],
  },
  delta: {
    evalCandidateDelta: 0,
    bgCandidateDelta: 0,
    totalCandidateDelta: 0,
  },
};

// ===================================================================
// Get clean article text
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
// TASK 1: Run Mode A (current survey) and capture results
// ===================================================================
async function runModeA(cleanText) {
  console.log("\n🟦 MODE A: Current Themed Survey\n");

  const result = await surveyTaskContent({
    text: cleanText,
    articleTitle: "Public Health's \"Truth\" About Vaccines PART 1",
    provisionalFrame: "",
    taskContentId: "mode-b-audit-modeA",
    maxConcurrency: 3,
  });

  const chunks = result.chunkSurveys || [];
  const evalCandidates = result.totalEvaluationCandidates || 0;
  const bgCandidates = result.totalBackgroundCandidates || 0;

  // Collect all candidates
  const allEval = chunks.flatMap((c) => c.evaluationCandidateClaims || []);
  const allBg = chunks.flatMap((c) => c.backgroundCandidateClaims || []);

  comparison.modeA = {
    evaluationCandidateCount: evalCandidates,
    backgroundCandidateCount: bgCandidates,
    candidates: [
      ...allEval.map((c) => ({
        type: "evaluation",
        text: c.claimText,
        role: c.roleHint,
        importance: c.importanceToArticleGuess,
        claimOriginExcerpt: c.localSourceExcerpt,
        claimOriginExcerptDerived: false,
      })),
      ...allBg.map((c) => ({
        type: "background",
        text: c.claimText,
        claimOriginExcerpt: c.localSourceExcerpt,
        claimOriginExcerptDerived: false,
      })),
    ],
    perChunkCounts: chunks.map((c) => ({
      chunkIndex: c.chunkIndex,
      evalCount: c.evaluationCandidateClaims?.length || 0,
      bgCount: c.backgroundCandidateClaims?.length || 0,
    })),
  };

  console.log(`✅ Mode A Results:`);
  console.log(`   Evaluation candidates: ${evalCandidates}`);
  console.log(`   Background candidates: ${bgCandidates}`);
  console.log(`   Total: ${evalCandidates + bgCandidates}`);
}

// ===================================================================
// TASK 2: Run Mode B (raw atomic extraction)
// ===================================================================
async function runModeB(cleanText, articleTitle) {
  console.log("\n🟦 MODE B: RAW_ATOMIC_WITH_FRAME_TAGS\n");

  // Split into chunks (same as Mode A)
  const MAX_CHUNK_SIZE = 6000;
  const chunks = [];
  const chunkTexts = [];

  let currentChunk = "";
  const sentences = cleanText.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    if ((currentChunk + " " + sentence).length > MAX_CHUNK_SIZE) {
      if (currentChunk) {
        chunkTexts.push(currentChunk.trim());
        chunks.push({
          index: chunks.length,
          text: currentChunk.trim(),
        });
        currentChunk = "";
      }
    }
    currentChunk += (currentChunk ? " " : "") + sentence;
  }

  if (currentChunk) {
    chunkTexts.push(currentChunk.trim());
    chunks.push({
      index: chunks.length,
      text: currentChunk.trim(),
    });
  }

  console.log(`   Chunked into ${chunks.length} chunks`);

  // Run atomic survey on each chunk
  const allEvalCandidates = [];
  const allBgCandidates = [];

  for (const chunk of chunks) {
    const candidates = await runAtomicSurveyOnChunk(
      chunk.text,
      chunk.index,
      articleTitle,
      cleanText
    );

    allEvalCandidates.push(...candidates.evaluation);
    allBgCandidates.push(...candidates.background);
  }

  comparison.modeB = {
    evaluationCandidateCount: allEvalCandidates.length,
    backgroundCandidateCount: allBgCandidates.length,
    candidates: [...allEvalCandidates, ...allBgCandidates],
    perChunkCounts: chunks.map((c, i) => ({
      chunkIndex: i,
      evalCount: allEvalCandidates.filter((x) => x.chunkIndex === i).length,
      bgCount: allBgCandidates.filter((x) => x.chunkIndex === i).length,
    })),
  };

  console.log(`✅ Mode B Results:`);
  console.log(
    `   Evaluation candidates: ${comparison.modeB.evaluationCandidateCount}`
  );
  console.log(
    `   Background candidates: ${comparison.modeB.backgroundCandidateCount}`
  );
  console.log(
    `   Total: ${comparison.modeB.evaluationCandidateCount + comparison.modeB.backgroundCandidateCount}`
  );
}

// ===================================================================
// Run atomic survey on a single chunk
// ===================================================================
async function runAtomicSurveyOnChunk(
  chunkText,
  chunkIndex,
  articleTitle,
  fullText
) {
  const prompt = `Extract ALL atomic claims from this text. Include data-integrity, whistleblower, censorship claims.

CHUNK:
${chunkText.substring(0, 3000)}

For each claim, provide: claimText (concise statement), role (evidence/background/pillar), claimOriginExcerpt (exact nearby text)`;

  try {
    const response = await openAiLLM.generate({
      system: "Extract all checkable claims from text. Do not filter by importance. Include meta-claims.",
      user: prompt,
      schemaHint: '{"candidates": [{"claimText": "...", "role": "evidence", "claimOriginExcerpt": "..."}]}',
      temperature: 0.2,
      timeout: 60000,
    });

    let content;
    if (typeof response === "string") {
      content = response;
    } else if (response.candidates) {
      content = JSON.stringify(response);
    } else {
      return { evaluation: [], background: [] };
    }

    // Parse JSON from response
    let candidates = [];
    try {
      // Try to extract JSON array
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        candidates = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log(`  ⚠️ Failed to parse chunk ${chunkIndex} response`);
      return { evaluation: [], background: [] };
    }

    // Separate by type and add metadata
    const evaluation = candidates
      .filter((c) => c.role !== "background")
      .map((c) => ({
        type: "evaluation",
        text: c.claimText,
        role: c.role,
        claimOriginExcerpt: c.claimOriginExcerpt,
        claimOriginExcerptDerived: false,
        chunkIndex: chunkIndex,
        categoryHint: c.categoryHint,
      }));

    const background = candidates
      .filter((c) => c.role === "background")
      .map((c) => ({
        type: "background",
        text: c.claimText,
        claimOriginExcerpt: c.claimOriginExcerpt,
        claimOriginExcerptDerived: false,
        chunkIndex: chunkIndex,
      }));

    return { evaluation, background };
  } catch (err) {
    console.error(`Error surveying chunk ${chunkIndex}:`, err.message);
    return { evaluation: [], background: [] };
  }
}

// ===================================================================
// TASK 4: Strict Thompson/MMR Gate Analysis
// ===================================================================
async function analyzeThompsonGate(cleanText) {
  console.log("\n🔍 TASK 4: Strict Thompson/MMR Gate\n");

  // Find Thompson excerpt in article
  const thompsonIndex = cleanText.toLowerCase().indexOf("thompson");
  if (thompsonIndex > -1) {
    const start = Math.max(0, thompsonIndex - 200);
    const end = Math.min(cleanText.length, thompsonIndex + 400);
    comparison.thompsonGate.articleExcerpt = cleanText.substring(start, end);
  }

  // Strict Thompson/MMR gate: must include ALL of these
  const strictPattern = /(thompson|whistleblower).*(cdc|centers for disease).*(mmr|measles|autism).*(omit|destroy|conceal|manipulat|excluded|hidden)/is;

  // Check Mode A
  const modeAStrictMatches = comparison.modeA.candidates.filter((c) => {
    const fullText =
      (c.text || "") + " " + (c.claimOriginExcerpt || "");
    return strictPattern.test(fullText);
  });

  comparison.thompsonGate.modeAMatches = modeAStrictMatches.map((c) => ({
    text: c.text?.substring(0, 100),
    excerpt: c.claimOriginExcerpt?.substring(0, 150),
  }));

  // Check Mode B
  const modeBStrictMatches = comparison.modeB.candidates.filter((c) => {
    const fullText =
      (c.text || "") + " " + (c.claimOriginExcerpt || "");
    return strictPattern.test(fullText);
  });

  comparison.thompsonGate.modeBMatches = modeBStrictMatches.map((c) => ({
    text: c.text?.substring(0, 100),
    excerpt: c.claimOriginExcerpt?.substring(0, 150),
    categoryHint: c.categoryHint,
  }));

  console.log(`Article contains Thompson/MMR/data material: ✅`);
  console.log(`Mode A strict Thompson matches: ${modeAStrictMatches.length}`);
  console.log(`Mode B strict Thompson matches: ${modeBStrictMatches.length}`);
}

// ===================================================================
// TASK 5: Theme Wiring Diagnostic
// ===================================================================
function analyzeThemeWiring() {
  console.log("\n🔌 TASK 5: Theme Wiring Fields\n");

  const requiredFields = [
    "sourceChunkIndex",
    "paragraphIndex",
    "miniThemeId",
    "chunkMiniTheme",
    "pillarId",
    "themeRelevanceScore",
    "evidenceStrengthScore",
    "finalScore",
    "reducerReason",
  ];

  // Check Mode A (survey output should not have these)
  const sampleA = comparison.modeA.candidates[0] || {};
  for (const field of requiredFields) {
    if (field in sampleA) {
      comparison.themeWiringFields.modeAPresent.push(field);
    } else {
      comparison.themeWiringFields.modeAMissing.push(field);
    }
  }

  // Check Mode B (survey output should not have these either)
  const sampleB = comparison.modeB.candidates[0] || {};
  for (const field of requiredFields) {
    if (field in sampleB) {
      comparison.themeWiringFields.modeBPresent.push(field);
    } else {
      comparison.themeWiringFields.modeBMissing.push(field);
    }
  }

  console.log(`Mode A theme fields present: ${comparison.themeWiringFields.modeAPresent.length}`);
  console.log(`Mode A theme fields missing: ${comparison.themeWiringFields.modeAMissing.length}`);
  console.log(`Mode B theme fields present: ${comparison.themeWiringFields.modeBPresent.length}`);
  console.log(`Mode B theme fields missing: ${comparison.themeWiringFields.modeBMissing.length}`);
}

// ===================================================================
// Calculate deltas
// ===================================================================
function calculateDeltas() {
  comparison.delta.evalCandidateDelta =
    comparison.modeB.evaluationCandidateCount -
    comparison.modeA.evaluationCandidateCount;
  comparison.delta.bgCandidateDelta =
    comparison.modeB.backgroundCandidateCount -
    comparison.modeA.backgroundCandidateCount;
  comparison.delta.totalCandidateDelta =
    comparison.delta.evalCandidateDelta + comparison.delta.bgCandidateDelta;
}

// ===================================================================
// MAIN
// ===================================================================
async function main() {
  try {
    console.log("🚀 TM4 Mode B: RAW_ATOMIC_WITH_FRAME_TAGS Audit\n");
    console.log("=".repeat(60));

    // Get clean article text
    const cleanText = await getCleanArticleText();
    console.log(`📖 Clean article text: ${cleanText.length} chars\n`);

    // Task 1: Run Mode A
    await runModeA(cleanText);

    // Task 2: Run Mode B
    await runModeB(cleanText, "Public Health's \"Truth\" About Vaccines PART 1");

    // Task 4: Thompson gate
    await analyzeThompsonGate(cleanText);

    // Task 5: Theme wiring
    analyzeThemeWiring();

    // Calculate deltas
    calculateDeltas();

    // Save results
    const logsDir = path.join(__dirname, "../../backend/logs");
    await fs.mkdir(logsDir, { recursive: true });

    const jsonPath = path.join(
      logsDir,
      `tm4_mode_b_atomic_candidate_audit_${TIMESTAMP}.json`
    );
    await fs.writeFile(jsonPath, JSON.stringify(comparison, null, 2), "utf-8");
    console.log(`\n✅ JSON: ${jsonPath}`);

    // Generate markdown report
    const mdReport = generateMarkdownReport();
    const mdPath = path.join(
      logsDir,
      `tm4_mode_b_atomic_candidate_audit_${TIMESTAMP}.md`
    );
    await fs.writeFile(mdPath, mdReport, "utf-8");
    console.log(`✅ Markdown: ${mdPath}`);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("COMPARISON SUMMARY");
    console.log("=".repeat(60));
    console.log(`Mode A eval: ${comparison.modeA.evaluationCandidateCount}`);
    console.log(`Mode B eval: ${comparison.modeB.evaluationCandidateCount}`);
    console.log(`Delta: +${comparison.delta.evalCandidateDelta}`);
    console.log(
      `\nMode A bg: ${comparison.modeA.backgroundCandidateCount}`
    );
    console.log(
      `Mode B bg: ${comparison.modeB.backgroundCandidateCount}`
    );
    console.log(`Delta: +${comparison.delta.bgCandidateDelta}`);
    console.log(
      `\nStrict Thompson/MMR in Mode B: ${comparison.thompsonGate.modeBMatches.length}`
    );
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// ===================================================================
// GENERATE MARKDOWN REPORT
// ===================================================================
function generateMarkdownReport() {
  const modeA = comparison.modeA;
  const modeB = comparison.modeB;
  const thompson = comparison.thompsonGate;
  const theme = comparison.themeWiringFields;
  const delta = comparison.delta;

  const lines = [];

  lines.push("# TM4 Mode B: RAW_ATOMIC_WITH_FRAME_TAGS Comparison\n");
  lines.push(`**Timestamp:** ${TIMESTAMP}\n`);
  lines.push(
    "**Purpose:** Compare current themed survey (Mode A) vs atomic extraction (Mode B) to determine if filtering is limiting candidate supply.\n"
  );

  // Comparison table
  lines.push("## Comparison Summary\n");
  lines.push("|  | Mode A | Mode B | Delta |");
  lines.push("|---|--------|--------|--------|");
  lines.push(
    `| Evaluation candidates | ${modeA.evaluationCandidateCount} | ${modeB.evaluationCandidateCount} | +${delta.evalCandidateDelta} |`
  );
  lines.push(
    `| Background candidates | ${modeA.backgroundCandidateCount} | ${modeB.backgroundCandidateCount} | +${delta.bgCandidateDelta} |`
  );
  lines.push(
    `| **Total** | **${modeA.evaluationCandidateCount + modeA.backgroundCandidateCount}** | **${modeB.evaluationCandidateCount + modeB.backgroundCandidateCount}** | **+${delta.totalCandidateDelta}** |`
  );
  lines.push("");

  // Per-chunk breakdown
  lines.push("## Per-Chunk Breakdown\n");
  lines.push("| Chunk | Mode A Eval | Mode B Eval | Mode A BG | Mode B BG | Gain |");
  lines.push("|-------|-------------|------------|-----------|-----------|--------|");
  for (let i = 0; i < Math.max(modeA.perChunkCounts.length, modeB.perChunkCounts.length); i++) {
    const a = modeA.perChunkCounts[i] || { evalCount: 0, bgCount: 0 };
    const b = modeB.perChunkCounts[i] || { evalCount: 0, bgCount: 0 };
    const gain = b.evalCount + b.bgCount - a.evalCount - a.bgCount;
    lines.push(
      `| ${i} | ${a.evalCount} | ${b.evalCount} | ${a.bgCount} | ${b.bgCount} | +${gain} |`
    );
  }
  lines.push("");

  // Mode B candidates
  lines.push("## Mode B: All Evaluation Candidates (Atomic Extraction)\n");
  modeB.candidates
    .filter((c) => c.type === "evaluation")
    .forEach((c, i) => {
      lines.push(`${i + 1}. ${c.text?.substring(0, 80)}...`);
      lines.push(`   Role: ${c.role}`);
      if (c.categoryHint) {
        lines.push(`   Category: ${c.categoryHint}`);
      }
      if (c.claimOriginExcerpt) {
        lines.push(`   Origin: "${c.claimOriginExcerpt.substring(0, 80)}..."`);
      }
    });
  lines.push("");

  // Thompson gate
  lines.push("## Thompson/MMR/Data Integrity Gate\n");
  if (thompson.articleExcerpt) {
    lines.push("### Article Contains\n");
    lines.push("> " + thompson.articleExcerpt.replace(/\n/g, " ").substring(0, 300));
    lines.push("");
  }

  lines.push("### Strict Match Results\n");
  lines.push(`**Mode A matches:** ${thompson.modeAMatches.length}`);
  if (thompson.modeAMatches.length > 0) {
    lines.push("- " + thompson.modeAMatches[0].text);
  }
  lines.push("");
  lines.push(`**Mode B matches:** ${thompson.modeBMatches.length}`);
  thompson.modeBMatches.forEach((m) => {
    lines.push(`- ${m.text}`);
    if (m.categoryHint) {
      lines.push(`  (${m.categoryHint})`);
    }
  });
  lines.push("");

  // Theme wiring
  lines.push("## Theme Wiring Fields\n");
  lines.push(`**Mode A:** ${theme.modeAPresent.length} present, ${theme.modeAMissing.length} missing`);
  lines.push(`**Mode B:** ${theme.modeBPresent.length} present, ${theme.modeBMissing.length} missing`);
  if (theme.modeAMissing.length > 0) {
    lines.push("\nMissing fields (survey stage):");
    theme.modeAMissing.slice(0, 5).forEach((f) => {
      lines.push(`- ${f}`);
    });
  }
  lines.push("");

  // Analysis
  lines.push("## Analysis\n");
  if (delta.evalCandidateDelta >= 15) {
    lines.push(
      `✅ **Mode B produces significantly more candidates (+${delta.evalCandidateDelta}).**\n`
    );
    lines.push(
      `This indicates Mode A is filtering too early. Current survey is suppressing\n`
    );
    lines.push(`controversial, weak, or non-main-theme claims.\n`);
  } else if (delta.evalCandidateDelta >= 5) {
    lines.push(
      `⚠️ **Mode B produces moderately more candidates (+${delta.evalCandidateDelta}).**\n`
    );
    lines.push(`Some filtering is occurring, but not severe.\n`);
  } else {
    lines.push(
      `⚠️ **Mode B produces similar or fewer candidates.**\n`
    );
    lines.push(`Filtering may not be the primary issue. Check survey prompt design.\n`);
  }

  if (thompson.modeBMatches.length > 0) {
    lines.push(
      `✅ Mode B extracts strict Thompson/MMR/data claims (${thompson.modeBMatches.length} found).\n`
    );
  } else if (thompson.articleExcerpt) {
    lines.push(
      `❌ Mode B does not extract strict Thompson/MMR/data despite article containing it.\n`
    );
    lines.push(`This indicates survey prompt/schema limitation, not filtering.\n`);
  }

  lines.push("");
  lines.push("---\n");
  lines.push("**No evidence. No persistence. Audit only. No production code modified.**\n");

  return lines.join("\n");
}

main();
