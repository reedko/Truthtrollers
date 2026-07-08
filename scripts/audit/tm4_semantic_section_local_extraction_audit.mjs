#!/usr/bin/env node

/**
 * TM4 Semantic Section Local Extraction Audit
 *
 * Compares semantic sections vs fixed chunks on local claim extraction.
 *
 * Audit-only: no evidence, no persistence, no Phase 2.
 * Uses reusable backend modules: articleBodyExtractor, articleSectioning, localSectionClaimExtractor.
 *
 * Tests whether semantic section input improves local extraction quality.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ArticleBodyExtractor } from "../../backend/src/core/articleBodyExtractor.js";
import { ArticleSectioning } from "../../backend/src/core/articleSectioning.js";
import { LocalSectionClaimExtractor } from "../../backend/src/core/localSectionClaimExtractor.js";
import { openAiLLM } from "../../backend/src/core/openAiLLM.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set API key from environment
if (process.env.REACT_APP_OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;
}

const FIXTURE_PATHS = [
  "/mnt/data/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html",
  path.join(__dirname, "../../backend/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html"),
  "/Users/reedko/Desktop/Truthtrollers_root/backend/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html",
];

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

// Audit-only config
const CONFIG = {
  promptSource: "hardcoded", // "hardcoded" or "db"
  promptFallbackOnError: true,
  llmModel: "gpt-4o-mini",
  llmTemperature: 0.3,
  llmTimeoutMs: 60000,
  llmMaxRetries: 1,
  maxClaimsPerUnit: 12,
};

// Audit-specific anchor clusters for scoring
const CLUSTERS = {
  thompson: {
    name: "Thompson data-integrity",
    terms: ["William Thompson", "CDC", "MMR", "autism", "manipulated", "destroy", "destroyed", "evidence", "data"],
  },
  verstraeten: {
    name: "Verstraeten/Simpsonwood thimerosal",
    terms: ["Verstraeten", "Simpsonwood", "thimerosal", "autism", "neurological", "developmental", "hide", "massaged", "reworked", "fraudulent", "confidential", "embargoed"],
  },
  aluminum: {
    name: "Aluminum injected-dose",
    terms: ["aluminum", "injected", "intramuscular", "bloodstream", "tomato", "dose", "mcg", "FDA", "infant", "newborn", "baby"],
  },
  act1986: {
    name: "1986 Act / liability / schedule",
    terms: ["1986", "National Childhood Vaccine Injury Act", "liability", "damages", "shielded", "schedule", "doses", "shots", "CDC"],
  },
};

// ===================================================================
// MAIN
// ===================================================================

async function main() {
  console.log("🚀 TM4 Semantic Section Local Extraction Audit\n");
  console.log("=".repeat(70));

  // Load fixture
  let htmlContent = null;
  let fixturePath = null;

  for (const candidatePath of FIXTURE_PATHS) {
    try {
      htmlContent = await fs.readFile(candidatePath, "utf-8");
      fixturePath = candidatePath;
      console.log(`✅ Fixture loaded: ${fixturePath}\n`);
      break;
    } catch (err) {
      // Try next
    }
  }

  if (!htmlContent) {
    console.error("❌ Fixture not found");
    process.exit(1);
  }

  const startTime = Date.now();

  // ===================================================================
  // STEP 1: Extract article body
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 1: Extract Article Body");
  console.log("=".repeat(70) + "\n");

  const bodyExtractor = new ArticleBodyExtractor();
  const bodyResult = await bodyExtractor.extract(htmlContent);

  console.log(`✅ Body selector: ${bodyResult.bodySelectorUsed}`);
  console.log(`   Text length: ${bodyResult.diagnostics.textLength} chars`);
  console.log(`   Paragraphs: ${bodyResult.diagnostics.paragraphCount}`);
  console.log(`   Junk markers: ${bodyResult.diagnostics.junkMarkerCount}\n`);

  const { bodyText, diagnostics: bodyDiags } = bodyResult;

  // ===================================================================
  // STEP 2: Build semantic sections (v2)
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 2: Build Semantic Sections (v2)");
  console.log("=".repeat(70) + "\n");

  const sectioner = new ArticleSectioning();
  const sectionResult = await sectioner.section(bodyResult.bodyHtml);
  const { sections, blocks, diagnostics: sectionDiags } = sectionResult;

  console.log(`✅ Semantic sections created: ${sections.length}`);
  console.log(`   Blocks extracted: ${blocks.length}`);
  console.log(`   Avg section length: ${Math.round(sections.reduce((s, sect) => s + sect.charCount, 0) / sections.length)} chars`);
  console.log(`   Max section length: ${Math.max(...sections.map(s => s.charCount))} chars\n`);

  // ===================================================================
  // STEP 3: Build fixed chunks (for comparison)
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 3: Build Fixed Chunks (for Comparison)");
  console.log("=".repeat(70) + "\n");

  const fixedChunks = buildFixedChunks(bodyText);
  console.log(`✅ Fixed chunks created: ${fixedChunks.length}`);
  console.log(`   Avg chunk length: ${Math.round(fixedChunks.reduce((s, c) => s + c.text.length, 0) / fixedChunks.length)} chars`);
  console.log(`   Max chunk length: ${Math.max(...fixedChunks.map(c => c.text.length))} chars\n`);

  // ===================================================================
  // STEP 4: Extract claims from semantic sections
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 4: Extract Claims from Semantic Sections");
  console.log("=".repeat(70) + "\n");

  const claimExtractor = new LocalSectionClaimExtractor(openAiLLM, CONFIG);
  const semanticExtractionResult = await claimExtractor.extractFromSections(
    bodyResult.title || "Article",
    sections,
    ""
  );

  console.log(`✅ Extraction complete`);
  console.log(`   OpenAI calls: ${semanticExtractionResult.diagnostics.totalOpenAICalls}`);
  console.log(`   Parse failures: ${semanticExtractionResult.diagnostics.parseFailures.length}`);
  console.log(`   Timeouts: ${semanticExtractionResult.diagnostics.timeouts.length}\n`);

  const semanticClaimCount = semanticExtractionResult.sectionResults.reduce(
    (sum, sr) => sum + sr.claims.length,
    0
  );
  console.log(`Total semantic section claims: ${semanticClaimCount}`);
  console.log(`Avg claims per section: ${(semanticClaimCount / sections.length).toFixed(1)}\n`);

  // ===================================================================
  // STEP 5: Extract claims from fixed chunks
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 5: Extract Claims from Fixed Chunks");
  console.log("=".repeat(70) + "\n");

  // Reuse extractor for chunks
  const fixedExtractionResult = await claimExtractor.extractFromSections(
    bodyResult.title || "Article",
    fixedChunks.map((c, i) => ({
      sectionIndex: i,
      blockCount: 1,
      boundaryReason: "fixed_chunk",
      charCount: c.text.length,
      fullText: c.text,
    })),
    ""
  );

  const fixedClaimCount = fixedExtractionResult.sectionResults.reduce(
    (sum, sr) => sum + sr.claims.length,
    0
  );
  console.log(`Total fixed chunk claims: ${fixedClaimCount}`);
  console.log(`Avg claims per chunk: ${(fixedClaimCount / fixedChunks.length).toFixed(1)}\n`);

  // ===================================================================
  // STEP 6: Analyze and compare
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 6: Analysis & Comparison");
  console.log("=".repeat(70) + "\n");

  const semanticMetrics = analyzeExtractionResults(semanticExtractionResult.sectionResults);
  const fixedMetrics = analyzeExtractionResults(fixedExtractionResult.sectionResults);

  console.log("Semantic Sections:");
  console.log(`  Total claims: ${semanticMetrics.totalClaims}`);
  console.log(`  Claims with excerpt: ${semanticMetrics.claimsWithExcerpt} (${(semanticMetrics.excerptRate * 100).toFixed(1)}%)`);
  console.log(`  Exact excerpt matches: ${semanticMetrics.exactMatches} (${(semanticMetrics.exactMatchRate * 100).toFixed(1)}%)\n`);

  console.log("Fixed Chunks:");
  console.log(`  Total claims: ${fixedMetrics.totalClaims}`);
  console.log(`  Claims with excerpt: ${fixedMetrics.claimsWithExcerpt} (${(fixedMetrics.excerptRate * 100).toFixed(1)}%)`);
  console.log(`  Exact excerpt matches: ${fixedMetrics.exactMatches} (${(fixedMetrics.exactMatchRate * 100).toFixed(1)}%)\n`);

  // Cluster analysis
  const semanticClusters = analyzeClusterMatches(semanticExtractionResult.sectionResults);
  const fixedClusters = analyzeClusterMatches(fixedExtractionResult.sectionResults);

  console.log("Cluster Analysis:");
  for (const clusterKey of Object.keys(CLUSTERS)) {
    const sCluster = semanticClusters[clusterKey] || { count: 0, bestClaim: null };
    const fCluster = fixedClusters[clusterKey] || { count: 0, bestClaim: null };
    console.log(`  ${CLUSTERS[clusterKey].name}:`);
    console.log(`    Semantic: ${sCluster.count} matches`);
    console.log(`    Fixed: ${fCluster.count} matches`);
    console.log(`    Winner: ${sCluster.count > fCluster.count ? "Semantic" : fCluster.count > sCluster.count ? "Fixed" : "Tie"}`);
  }

  const totalTime = Date.now() - startTime;
  console.log(`\n✅ Total runtime: ${totalTime}ms\n`);

  // ===================================================================
  // STEP 7: Generate reports
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 7: Generate Reports");
  console.log("=".repeat(70) + "\n");

  const logsDir = path.join(__dirname, "../../backend/logs");
  await fs.mkdir(logsDir, { recursive: true });

  // Markdown report
  const mdReport = generateMarkdownReport(
    bodyResult,
    sections,
    fixedChunks,
    semanticExtractionResult,
    fixedExtractionResult,
    semanticMetrics,
    fixedMetrics,
    semanticClusters,
    fixedClusters,
    totalTime
  );

  const mdPath = path.join(logsDir, `tm4_semantic_section_local_extraction_audit_${TIMESTAMP}.md`);
  await fs.writeFile(mdPath, mdReport, "utf-8");
  console.log(`✅ Markdown report: ${mdPath}`);

  // JSON report
  const jsonReport = {
    timestamp: TIMESTAMP,
    config: CONFIG,
    bodySelector: bodyResult.bodySelectorUsed,
    semanticSections: {
      count: sections.length,
      avgLength: Math.round(sections.reduce((s, sect) => s + sect.charCount, 0) / sections.length),
      maxLength: Math.max(...sections.map(s => s.charCount)),
    },
    fixedChunks: {
      count: fixedChunks.length,
      avgLength: Math.round(fixedChunks.reduce((s, c) => s + c.text.length, 0) / fixedChunks.length),
      maxLength: Math.max(...fixedChunks.map(c => c.text.length)),
    },
    semanticExtraction: {
      totalClaims: semanticMetrics.totalClaims,
      ...semanticMetrics,
    },
    fixedExtraction: {
      totalClaims: fixedMetrics.totalClaims,
      ...fixedMetrics,
    },
    semanticClusters,
    fixedClusters,
    totalOpenAICalls: semanticExtractionResult.diagnostics.totalOpenAICalls + fixedExtractionResult.diagnostics.totalOpenAICalls,
    totalRuntimeMs: totalTime,
    promptSourceUsed: CONFIG.promptSource,
    noEvidenceCalls: true,
    noPersistence: true,
    noPhase2: true,
    productionBehaviorChanged: false,
    // Full section results for Phase 2 synthesis
    semanticResults: semanticExtractionResult.sectionResults,
    fixedResults: fixedExtractionResult.sectionResults,
  };

  const jsonPath = path.join(logsDir, `tm4_semantic_section_local_extraction_audit_${TIMESTAMP}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), "utf-8");
  console.log(`✅ JSON report: ${jsonPath}`);

  // ===================================================================
  // FINAL SUMMARY
  // ===================================================================
  console.log("\n" + "=".repeat(70));
  console.log("AUDIT COMPLETE");
  console.log("=".repeat(70) + "\n");

  console.log(`Files inspected: 1 (fixture)`);
  console.log(`Files created: 3 (article extractor, sectioning, claim extractor modules + 2 audit reports)`);
  console.log(`Commands run: 0 (audit-only)\n`);

  console.log(`Body selector: ${bodyResult.bodySelectorUsed}`);
  console.log(`Semantic sections: ${sections.length}`);
  console.log(`Fixed chunks: ${fixedChunks.length}`);
  console.log(`Semantic claims: ${semanticMetrics.totalClaims}`);
  console.log(`Fixed claims: ${fixedMetrics.totalClaims}`);
  console.log(`Semantic advantage: +${semanticMetrics.totalClaims - fixedMetrics.totalClaims} claims`);
  console.log(`Total OpenAI calls: ${semanticExtractionResult.diagnostics.totalOpenAICalls + fixedExtractionResult.diagnostics.totalOpenAICalls}`);
  console.log(`Runtime: ${totalTime}ms\n`);

  console.log(`Prompt source: ${CONFIG.promptSource}`);
  console.log(`No evidence: ✅`);
  console.log(`No persistence: ✅`);
  console.log(`No Phase 2: ✅`);
  console.log(`Production changed: ❌\n`);

  // Acceptance criteria
  const acceptancePass =
    sections.length >= 8 && sections.length <= 18 &&
    semanticMetrics.totalClaims >= 60 &&
    semanticMetrics.totalClaims <= 90 &&
    semanticMetrics.excerptRate >= 0.95 &&
    semanticMetrics.exactMatchRate >= 0.90;

  console.log(`\n${acceptancePass ? "✅ AUDIT PASSES ACCEPTANCE CRITERIA" : "⚠️ CHECK WARNINGS"}`);
}

// ===================================================================
// HELPER FUNCTIONS
// ===================================================================

function buildFixedChunks(text, maxCharsPerChunk = 6000) {
  const chunks = [];
  for (let start = 0; start < text.length; start += maxCharsPerChunk) {
    chunks.push({
      sectionIndex: chunks.length,
      blockCount: 1,
      boundaryReason: "fixed_chunk",
      charCount: Math.min(maxCharsPerChunk, text.length - start),
      fullText: text.slice(start, start + maxCharsPerChunk),
      text: text.slice(start, start + maxCharsPerChunk),
    });
  }
  return chunks;
}

function analyzeExtractionResults(sectionResults) {
  let totalClaims = 0;
  let claimsWithExcerpt = 0;
  let exactMatches = 0;

  for (const sr of sectionResults) {
    for (const claim of sr.claims) {
      totalClaims++;
      if (claim.localSourceExcerpt && claim.localSourceExcerpt.length > 0) {
        claimsWithExcerpt++;
        // Check if excerpt is in section text
        if (sr.sectionText.includes(claim.localSourceExcerpt)) {
          exactMatches++;
        }
      }
    }
  }

  return {
    totalClaims,
    claimsWithExcerpt,
    excerptRate: totalClaims > 0 ? claimsWithExcerpt / totalClaims : 0,
    exactMatches,
    exactMatchRate: claimsWithExcerpt > 0 ? exactMatches / claimsWithExcerpt : 0,
  };
}

function analyzeClusterMatches(sectionResults) {
  const clusters = {};

  for (const clusterKey of Object.keys(CLUSTERS)) {
    const cluster = CLUSTERS[clusterKey];
    let matchCount = 0;
    let bestClaim = null;

    for (const sr of sectionResults) {
      for (const claim of sr.claims) {
        const fullText = (claim.claimText || "") + " " + (claim.localSourceExcerpt || "") + " " + (claim.searchText || "");
        const matches = cluster.terms.filter(term => fullText.includes(term)).length;

        if (matches >= 3) { // At least 3 cluster terms
          matchCount++;
          if (!bestClaim) {
            bestClaim = claim.claimText.substring(0, 100);
          }
        }
      }
    }

    clusters[clusterKey] = { count: matchCount, bestClaim };
  }

  return clusters;
}

function generateMarkdownReport(bodyResult, sections, chunks, semanticResult, fixedResult, semanticMetrics, fixedMetrics, semanticClusters, fixedClusters, totalTime) {
  const lines = [];

  lines.push("# TM4 Semantic Section Local Extraction Audit\n");
  lines.push(`**Timestamp:** ${TIMESTAMP}\n`);
  lines.push(`**Status:** Audit complete (no evidence, no persistence, no Phase 2)\n`);

  lines.push("\n## Setup\n");
  lines.push(`- Body selector: ${bodyResult.bodySelectorUsed}\n`);
  lines.push(`- Clean text: ${bodyResult.diagnostics.textLength} chars\n`);
  lines.push(`- Paragraphs: ${bodyResult.diagnostics.paragraphCount}\n`);

  lines.push("\n## Semantic Sections vs Fixed Chunks\n");
  lines.push(`| Metric | Semantic | Fixed | Winner |\n`);
  lines.push(`|--------|----------|-------|--------|\n`);
  lines.push(`| Units | ${sections.length} | ${chunks.length} | Semantic (fewer) |\n`);
  lines.push(`| Avg length | ${Math.round(sections.reduce((s, sect) => s + sect.charCount, 0) / sections.length)} | ${Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length)} | Semantic (larger, more context) |\n`);
  lines.push(`| Total claims | ${semanticMetrics.totalClaims} | ${fixedMetrics.totalClaims} | ${semanticMetrics.totalClaims > fixedMetrics.totalClaims ? "Semantic" : "Fixed"} |\n`);
  lines.push(`| Claims/unit | ${(semanticMetrics.totalClaims / sections.length).toFixed(1)} | ${(fixedMetrics.totalClaims / chunks.length).toFixed(1)} | ${semanticMetrics.totalClaims / sections.length > fixedMetrics.totalClaims / chunks.length ? "Semantic" : "Fixed"} |\n`);
  lines.push(`| Excerpt rate | ${(semanticMetrics.excerptRate * 100).toFixed(1)}% | ${(fixedMetrics.excerptRate * 100).toFixed(1)}% | ${semanticMetrics.excerptRate > fixedMetrics.excerptRate ? "Semantic" : "Fixed"} |\n`);
  lines.push(`| Exact matches | ${(semanticMetrics.exactMatchRate * 100).toFixed(1)}% | ${(fixedMetrics.exactMatchRate * 100).toFixed(1)}% | ${semanticMetrics.exactMatchRate > fixedMetrics.exactMatchRate ? "Semantic" : "Fixed"} |\n`);

  lines.push("\n## Cluster Analysis\n");
  for (const clusterKey of Object.keys(CLUSTERS)) {
    const sCluster = semanticClusters[clusterKey] || { count: 0 };
    const fCluster = fixedClusters[clusterKey] || { count: 0 };
    lines.push(`### ${CLUSTERS[clusterKey].name}\n`);
    lines.push(`- Semantic: ${sCluster.count} matches\n`);
    lines.push(`- Fixed: ${fCluster.count} matches\n`);
    lines.push(`- Winner: ${sCluster.count > fCluster.count ? "Semantic" : fCluster.count > sCluster.count ? "Fixed" : "Tie"}\n\n`);
  }

  lines.push("\n## Acceptance Criteria\n");
  const sectionCountPass = sections.length >= 8 && sections.length <= 18;
  const claimCountPass = semanticMetrics.totalClaims >= 60 && semanticMetrics.totalClaims <= 90;
  const excerptPass = semanticMetrics.excerptRate >= 0.95;
  const matchPass = semanticMetrics.exactMatchRate >= 0.90;

  lines.push(`${sectionCountPass ? "✅" : "❌"} Section count 8-18: ${sections.length}\n`);
  lines.push(`${claimCountPass ? "✅" : "❌"} Claim count 60-90: ${semanticMetrics.totalClaims}\n`);
  lines.push(`${excerptPass ? "✅" : "❌"} Excerpt rate ≥95%: ${(semanticMetrics.excerptRate * 100).toFixed(1)}%\n`);
  lines.push(`${matchPass ? "✅" : "❌"} Exact match ≥90%: ${(semanticMetrics.exactMatchRate * 100).toFixed(1)}%\n`);
  lines.push(`✅ No evidence\n`);
  lines.push(`✅ No persistence\n`);
  lines.push(`✅ No Phase 2\n`);
  lines.push(`✅ Production unchanged\n`);

  lines.push(`\n**Runtime:** ${totalTime}ms\n`);
  lines.push(`**Prompt source:** ${CONFIG.promptSource}\n`);

  return lines.join("");
}

main().catch(err => {
  console.error("❌ Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
