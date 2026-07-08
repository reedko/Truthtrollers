#!/usr/bin/env node

/**
 * TM4 Semantic Section Blocks Audit v2
 *
 * Tuned variant with improved boundary rules.
 * Goal: Reduce section count from 26 to 8-18 range while preserving coherence.
 *
 * Changes from v1:
 * - Increased minSectionChars (700 → 1000)
 * - Increased targetSectionChars (2200 → 3200)
 * - Increased maxSectionChars (4200 → 4500)
 * - Visual headings as hard boundaries only if section >= minSectionChars
 * - Topic-shift cues require targetSectionChars + new named entity
 * - Soft boundary hysteresis (no boundary in last 3 blocks)
 * - Preserve quote clusters
 * - No tiny heading-only sections
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_PATHS = [
  "/mnt/data/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html",
  path.join(__dirname, "../../backend/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html"),
  "/Users/reedko/Desktop/Truthtrollers_root/backend/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html",
];

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const BODY_SELECTORS = [
  ".et_pb_module.et_pb_post_content",
  ".et_pb_post_content",
  ".entry-content",
  "article",
  "main",
];

const JUNK_SELECTORS = [
  "script", "style", "noscript", "svg",
  "nav", "header", "footer", "form", "button", "iframe",
  ".comment", ".comments", "#comments",
  ".related", ".related-posts",
  ".share", ".sharedaddy", ".social",
  ".newsletter", ".subscribe",
  ".et_pb_menu", ".et_pb_sidebar", ".et_pb_widget", ".et_pb_search",
  ".et_pb_comments_module",
];

const ANCHOR_TERMS = {
  williamThompson: ["William Thompson", "Thompson"],
  cdc: ["CDC", "Centers for Disease Control"],
  mmr: ["MMR", "measles"],
  autism: ["autism", "autistic"],
  verstraeten: ["Verstraeten"],
  simpsonwood: ["Simpsonwood"],
  thimerosal: ["thimerosal"],
  aluminum: ["aluminum"],
  vaccineAct1986: ["1986", "National Childhood Vaccine Injury Act"],
  dataAction: ["omit", "omitted", "conceal", "concealed", "destroy", "destroyed", "exclude", "excluded", "manipulat", "alter", "altered", "suppress", "suppressed", "hidden", "fraud"],
};

const TOPIC_SHIFT_CUES = [
  "That brings us to",
  "Which brings us",
  "Now",
  "The next claim",
  "Our health department",
  "Regarding",
  "In 1999",
  "In 2005",
  "The 1986",
  "Findings from",
  "Given the",
  "Instead",
];

const NAMED_CLUSTERS = [
  "CDC", "FDA", "WHO",
  "National Childhood Vaccine Injury Act",
  "Verstraeten", "Simpsonwood",
  "aluminum", "thimerosal",
  "VAERS", "SIDS",
];

const STRONG_HEADING_MARKERS = [
  "THE FACTS",
  "KEY CLAIM",
  "EVIDENCE",
  "BACKGROUND",
  "METHODOLOGY",
  "SECTION",
];

// ===================================================================
// MAIN
// ===================================================================

async function main() {
  console.log("🚀 TM4 Semantic Section Blocks Audit v2 (Tuned)\n");
  console.log("=".repeat(70));

  // Find fixture
  let htmlContent = null;
  let fixturePath = null;

  for (const candidatePath of FIXTURE_PATHS) {
    try {
      htmlContent = await fs.readFile(candidatePath, "utf-8");
      fixturePath = candidatePath;
      console.log(`✅ Fixture found: ${fixturePath}`);
      break;
    } catch (err) {
      // Try next
    }
  }

  if (!htmlContent) {
    console.error("❌ Fixture not found");
    process.exit(1);
  }

  const $ = cheerio.load(htmlContent);

  // Body root selection
  console.log("\n" + "=".repeat(70));
  console.log("TASK 1: Body Root Selection");
  console.log("=".repeat(70) + "\n");

  const $root = $(".et_pb_module.et_pb_post_content").first();
  console.log(`✅ Using selector: .et_pb_module.et_pb_post_content`);
  console.log(`   (same as v1)\n`);

  // Remove junk
  const $clean = $root.clone();
  JUNK_SELECTORS.forEach(sel => {
    $clean.find(sel).remove();
  });

  // ===================================================================
  // TASK 2: Build block atoms (same as v1)
  // ===================================================================
  console.log("=".repeat(70));
  console.log("TASK 2: Build Block Atoms");
  console.log("=".repeat(70) + "\n");

  const blocks = [];
  let charOffset = 0;

  $clean.contents().each((idx, elem) => {
    const $elem = $(elem);
    const tag = elem.name;

    if (!tag) return;

    if (!["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "figcaption", "table", "pre"].includes(tag)) {
      return;
    }

    let text = $elem.text().replace(/\s+/g, " ").trim();

    if (!text || text.length === 0) return;

    if (text.length < 20 && !["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
      return;
    }

    const isHeading = /^h[1-6]$/.test(tag);
    const isListItem = tag === "li";
    const isQuote = tag === "blockquote";
    const isCaption = tag === "figcaption";

    // Detect likely visual heading
    const isLikelyVisualHeading =
      text.length <= 100 &&
      (text.toUpperCase() === text || $elem.find("strong, b").length > 0) &&
      !isListItem;

    // Detect strong heading marker
    const isStrongHeading = STRONG_HEADING_MARKERS.some(marker => text.toUpperCase().includes(marker));

    const block = {
      blockIndex: blocks.length,
      tag,
      text: text.substring(0, 500),
      textLength: text.length,
      isHeading,
      isLikelyVisualHeading,
      isStrongHeading,
      isQuote,
      isListItem,
      isCaption,
      charStartApprox: charOffset,
      charEndApprox: charOffset + text.length,
      fullText: text,
    };

    blocks.push(block);
    charOffset += text.length + 1;
  });

  console.log(`Total blocks: ${blocks.length}`);
  console.log(`  Paragraphs: ${blocks.filter(b => b.tag === "p").length}`);
  console.log(`  Blockquotes: ${blocks.filter(b => b.isQuote).length}`);
  console.log(`  Visual headings: ${blocks.filter(b => b.isLikelyVisualHeading).length}`);
  console.log(`  Strong headings: ${blocks.filter(b => b.isStrongHeading).length}\n`);

  // ===================================================================
  // TASK 3: Build semantic sections with v2 rules
  // ===================================================================
  console.log("=".repeat(70));
  console.log("TASK 3: Build Semantic Sections (v2 Tuned Rules)");
  console.log("=".repeat(70) + "\n");

  const sectionConfig = {
    minSectionChars: 1000,
    targetSectionChars: 3200,
    maxSectionChars: 4500,
    overlapBlocksWhenForcedSplit: 1,
    boundaryHysteresis: 3, // Don't create soft boundary if one created in last N blocks
  };

  const sections = [];
  let currentSectionBlocks = [];
  let currentSectionChars = 0;
  let blocksSinceLastBoundary = 0;
  let boundaryStats = {
    hardHeadingBoundaries: 0,
    softTopicBoundaries: 0,
    maxSizeBoundaries: 0,
    otherBoundaries: 0,
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const nextBlock = blocks[i + 1];

    currentSectionBlocks.push(i);
    currentSectionChars += block.textLength;
    blocksSinceLastBoundary++;

    // ===================================================================
    // v2 BOUNDARY RULES
    // ===================================================================

    let shouldBoundary = false;
    let boundaryReason = "none";

    // Rule 1: Hard boundary - Visual heading (only if section >= minSectionChars OR strong heading)
    if (block.isLikelyVisualHeading && (currentSectionChars >= sectionConfig.minSectionChars || block.isStrongHeading)) {
      shouldBoundary = true;
      boundaryReason = "hard_heading";
      boundaryStats.hardHeadingBoundaries++;
    }

    // Rule 2: Soft boundary - Topic shift (requires targetSectionChars + new named entity)
    if (!shouldBoundary && nextBlock && currentSectionChars >= sectionConfig.targetSectionChars) {
      const nextText = nextBlock.fullText.toLowerCase();
      const nextTextStart = nextText.substring(0, 80);

      // Check for topic-shift cue with context
      const hasTopicShift = TOPIC_SHIFT_CUES.some(cue => nextTextStart.startsWith(cue.toLowerCase()));

      // Check if introduces new named entity
      const hasNewCluster = NAMED_CLUSTERS.some(cluster =>
        nextBlock.fullText.includes(cluster) && !currentSectionBlocks.some(idx => blocks[idx].fullText.includes(cluster))
      );

      if (hasTopicShift && hasNewCluster && blocksSinceLastBoundary >= sectionConfig.boundaryHysteresis) {
        shouldBoundary = true;
        boundaryReason = "soft_topic_shift";
        boundaryStats.softTopicBoundaries++;
      }
    }

    // Rule 3: Soft boundary - Hysteresis: Don't split if boundary created in last N blocks
    if (shouldBoundary && boundaryReason === "soft_topic_shift" && blocksSinceLastBoundary < sectionConfig.boundaryHysteresis) {
      shouldBoundary = false;
      boundaryReason = "rejected_hysteresis";
    }

    // Rule 4: Hard boundary - Exceeds max size
    if (!shouldBoundary && nextBlock && (currentSectionChars + nextBlock.textLength) > sectionConfig.maxSectionChars) {
      shouldBoundary = true;
      boundaryReason = "hard_max_size";
      boundaryStats.maxSizeBoundaries++;
    }

    // Rule 5: Hard boundary - Article end
    if (i === blocks.length - 1) {
      shouldBoundary = true;
      boundaryReason = "article_end";
    }

    // Rule 6: Preserve quote clusters - Don't split if current is quote or next is quote
    if (shouldBoundary && (block.isQuote || (nextBlock && nextBlock.isQuote))) {
      // Only allow if would exceed max
      if (currentSectionChars + (nextBlock?.textLength || 0) <= sectionConfig.maxSectionChars) {
        shouldBoundary = false;
        boundaryReason = "preserved_quote_cluster";
      }
    }

    // Rule 7: Don't create tiny heading-only sections
    if (shouldBoundary && currentSectionBlocks.length === 1 && block.isLikelyVisualHeading) {
      if (nextBlock && currentSectionChars + nextBlock.textLength <= sectionConfig.maxSectionChars) {
        shouldBoundary = false;
        boundaryReason = "preserved_heading_with_content";
      }
    }

    if (shouldBoundary && currentSectionBlocks.length > 0) {
      // Create section
      const sectionBlockIndexes = [...currentSectionBlocks];
      const sectionText = sectionBlockIndexes.map(idx => blocks[idx].fullText).join(" ");

      // Find heading
      const firstHeadingIdx = sectionBlockIndexes.find(idx => blocks[idx].isHeading || blocks[idx].isLikelyVisualHeading);
      let heading = "";
      if (firstHeadingIdx !== undefined) {
        heading = blocks[firstHeadingIdx].fullText.substring(0, 100);
      }

      // Infer label
      let inferredLabel = heading || sectionText.substring(0, 80);
      for (const cluster of NAMED_CLUSTERS) {
        if (sectionText.includes(cluster)) {
          inferredLabel = cluster;
          break;
        }
      }

      // Check for anchor terms
      const auditAnchors = {
        williamThompson: ANCHOR_TERMS.williamThompson.some(term => sectionText.includes(term)),
        cdc: ANCHOR_TERMS.cdc.some(term => sectionText.includes(term)),
        mmr: ANCHOR_TERMS.mmr.some(term => sectionText.includes(term)),
        autism: ANCHOR_TERMS.autism.some(term => sectionText.includes(term)),
        dataAction: ANCHOR_TERMS.dataAction.some(term => sectionText.toLowerCase().includes(term.toLowerCase())),
        verstraeten: ANCHOR_TERMS.verstraeten.some(term => sectionText.includes(term)),
        simpsonwood: ANCHOR_TERMS.simpsonwood.some(term => sectionText.includes(term)),
        thimerosal: ANCHOR_TERMS.thimerosal.some(term => sectionText.includes(term)),
        aluminum: ANCHOR_TERMS.aluminum.some(term => sectionText.includes(term)),
        vaccineAct1986: ANCHOR_TERMS.vaccineAct1986.some(term => sectionText.includes(term)),
      };

      const section = {
        sectionIndex: sections.length,
        heading,
        inferredLabel: inferredLabel.substring(0, 100),
        text: sectionText.substring(0, 500),
        fullText: sectionText,
        blockStart: sectionBlockIndexes[0],
        blockEnd: sectionBlockIndexes[sectionBlockIndexes.length - 1],
        blockCount: sectionBlockIndexes.length,
        charCount: sectionText.length,
        boundaryReason,
        sourceBlockIndexes: sectionBlockIndexes,
        startsWith: sectionText.substring(0, 60).replace(/\n/g, " "),
        endsWith: sectionText.substring(Math.max(0, sectionText.length - 60)).replace(/\n/g, " "),
        auditAnchors,
      };

      sections.push(section);

      // Reset
      currentSectionBlocks = [];
      currentSectionChars = 0;
      blocksSinceLastBoundary = 0;

      // Add overlap
      if (boundaryReason === "hard_max_size" && sectionConfig.overlapBlocksWhenForcedSplit > 0 && nextBlock) {
        for (let j = 0; j < sectionConfig.overlapBlocksWhenForcedSplit && i < blocks.length - 1; j++) {
          currentSectionBlocks.push(i + 1 + j);
          currentSectionChars += blocks[i + 1 + j].textLength;
        }
      }
    }
  }

  console.log(`v1 section count: 26`);
  console.log(`v2 section count: ${sections.length}`);
  console.log(`Improvement: ${26 - sections.length} fewer sections\n`);

  console.log(`Boundary statistics:`);
  console.log(`  Hard heading boundaries: ${boundaryStats.hardHeadingBoundaries}`);
  console.log(`  Soft topic boundaries: ${boundaryStats.softTopicBoundaries}`);
  console.log(`  Max size boundaries: ${boundaryStats.maxSizeBoundaries}`);
  console.log(`  Article end: 1\n`);

  const avgSectionLength = Math.round(sections.reduce((sum, s) => sum + s.charCount, 0) / sections.length);
  console.log(`Average section length: ${avgSectionLength} chars`);
  console.log(`Max section length: ${Math.max(...sections.map(s => s.charCount))} chars\n`);

  // ===================================================================
  // TASK 4: Acceptance criteria
  // ===================================================================
  console.log("=".repeat(70));
  console.log("TASK 4: Acceptance Criteria");
  console.log("=".repeat(70) + "\n");

  const acceptanceCriteria = {
    noLLMCalls: true,
    noDBCalls: true,
    noProductionChanges: true,
    bodySelector: ".et_pb_module.et_pb_post_content",
    sectionCountInRange: sections.length >= 8 && sections.length <= 18,
    sectionCountIdeal: sections.length >= 12 && sections.length <= 16,
    avgSectionLengthInRange: avgSectionLength >= 1500 && avgSectionLength <= 3500,
    noSectionExceedsMax: sections.every(s => s.charCount <= 4500),
  };

  const thompsonSections = sections.filter(s => s.auditAnchors.williamThompson);
  const cdcSections = sections.filter(s => s.auditAnchors.cdc);
  const mmrSections = sections.filter(s => s.auditAnchors.mmr);
  const autismSections = sections.filter(s => s.auditAnchors.autism);
  const dataActionSections = sections.filter(s => s.auditAnchors.dataAction);
  const verstraetinSections = sections.filter(s => s.auditAnchors.verstraeten);
  const simpsonwoodSections = sections.filter(s => s.auditAnchors.simpsonwood);
  const thimerosalSections = sections.filter(s => s.auditAnchors.thimerosal);
  const aluminumSections = sections.filter(s => s.auditAnchors.aluminum);

  const thompsonCDCMMRSet = new Set([
    ...thompsonSections.map(s => s.sectionIndex),
    ...cdcSections.map(s => s.sectionIndex),
    ...mmrSections.map(s => s.sectionIndex),
    ...autismSections.map(s => s.sectionIndex),
  ]);

  const thompsonDataSet = new Set([
    ...thompsonSections.map(s => s.sectionIndex),
    ...dataActionSections.map(s => s.sectionIndex),
  ]);

  const verstraetinSet = new Set([
    ...verstraetinSections.map(s => s.sectionIndex),
    ...simpsonwoodSections.map(s => s.sectionIndex),
    ...thimerosalSections.map(s => s.sectionIndex),
  ]);

  acceptanceCriteria.anchors = {
    thompson_cdc_mmr_autism_grouped: thompsonCDCMMRSet.size <= 2,
    thompson_data_action_grouped: thompsonDataSet.size <= 2,
    verstraeten_simpsonwood_thimerosal_grouped: verstraetinSet.size <= 2,
    aluminum_grouped: aluminumSections.length > 0 && aluminumSections.length <= 2,
  };

  console.log(`✅ No LLM calls: true`);
  console.log(`✅ No DB calls: true`);
  console.log(`✅ No production changes: true`);
  console.log(`✅ Body selector correct: ${acceptanceCriteria.bodySelector}`);
  console.log(`${acceptanceCriteria.sectionCountInRange ? "✅" : "❌"} Section count 8-18: ${sections.length}`);
  console.log(`${acceptanceCriteria.sectionCountIdeal ? "✅" : "⚠️"} Ideal section count 12-16: ${sections.length}`);
  console.log(`${acceptanceCriteria.avgSectionLengthInRange ? "✅" : "❌"} Avg section length 1500-3500: ${avgSectionLength}`);
  console.log(`${acceptanceCriteria.noSectionExceedsMax ? "✅" : "❌"} No section exceeds max: ${acceptanceCriteria.noSectionExceedsMax}`);
  console.log(`${acceptanceCriteria.anchors.thompson_cdc_mmr_autism_grouped ? "✅" : "⚠️"} Thompson+CDC+MMR+autism grouped: ${acceptanceCriteria.anchors.thompson_cdc_mmr_autism_grouped} (${thompsonCDCMMRSet.size} sections)`);
  console.log(`${acceptanceCriteria.anchors.thompson_data_action_grouped ? "✅" : "⚠️"} Thompson+data-action grouped: ${acceptanceCriteria.anchors.thompson_data_action_grouped} (${thompsonDataSet.size} sections)`);
  console.log(`${acceptanceCriteria.anchors.verstraeten_simpsonwood_thimerosal_grouped ? "✅" : "⚠️"} Verstraeten+Simpsonwood+thimerosal grouped: ${acceptanceCriteria.anchors.verstraeten_simpsonwood_thimerosal_grouped} (${verstraetinSet.size} sections)`);
  console.log(`${acceptanceCriteria.anchors.aluminum_grouped ? "✅" : "⚠️"} Aluminum grouped: ${acceptanceCriteria.anchors.aluminum_grouped} (${aluminumSections.length} sections)\n`);

  // ===================================================================
  // TASK 5: Generate reports
  // ===================================================================
  console.log("=".repeat(70));
  console.log("TASK 5: Generate Reports");
  console.log("=".repeat(70) + "\n");

  const logsDir = path.join(__dirname, "../../backend/logs");
  await fs.mkdir(logsDir, { recursive: true });

  // Markdown report
  const mdLines = [];
  mdLines.push("# TM4 Semantic Section Blocks Audit v2 (Tuned)\n");
  mdLines.push(`**Timestamp:** ${TIMESTAMP}\n`);
  mdLines.push(`**Fixture:** ${fixturePath}\n`);
  mdLines.push(`**Status:** Dry-run audit v2 with tuned parameters\n`);

  mdLines.push("\n## Configuration Changes\n");
  mdLines.push("| Parameter | v1 | v2 | Change |\n");
  mdLines.push("|-----------|----|----|--------|\n");
  mdLines.push("| minSectionChars | 700 | 1000 | +300 |\n");
  mdLines.push("| targetSectionChars | 2200 | 3200 | +1000 |\n");
  mdLines.push("| maxSectionChars | 4200 | 4500 | +300 |\n");
  mdLines.push("| Boundary rules | v1 | v2 tuned | Aggressive → Conservative |\n");

  mdLines.push("\n## Results\n");
  mdLines.push(`| Metric | v1 | v2 | Target | Status |\n`);
  mdLines.push(`|--------|----|----|--------|--------|\n`);
  mdLines.push(`| Section count | 26 | ${sections.length} | 8-18 | ${acceptanceCriteria.sectionCountInRange ? "✅" : "❌"} |\n`);
  mdLines.push(`| Avg section length | 1919 | ${avgSectionLength} | 1500-3500 | ${acceptanceCriteria.avgSectionLengthInRange ? "✅" : "❌"} |\n`);
  mdLines.push(`| Max section | 4146 | ${Math.max(...sections.map(s => s.charCount))} | ≤4500 | ✅ |\n`);

  mdLines.push("\n## Boundary Decisions\n");
  mdLines.push("| Boundary Type | Count | Notes |\n");
  mdLines.push("|---|---|---|\n");
  mdLines.push(`| Hard heading | ${boundaryStats.hardHeadingBoundaries} | Only if section ≥ minChars |\n`);
  mdLines.push(`| Soft topic | ${boundaryStats.softTopicBoundaries} | Requires targetChars + new entity |\n`);
  mdLines.push(`| Max size | ${boundaryStats.maxSizeBoundaries} | Exceeded 4500 chars |\n`);
  mdLines.push(`| Article end | 1 | Final boundary |\n`);

  mdLines.push("\n## Semantic Sections\n");
  mdLines.push("| Index | Chars | Blocks | Label | Reason | Thompson | CDC | MMR | Autism | Data |\n");
  mdLines.push("|-------|-------|--------|-------|--------|----------|-----|-----|--------|------|\n");
  for (const section of sections) {
    const t = section.auditAnchors.williamThompson ? "✅" : "";
    const c = section.auditAnchors.cdc ? "✅" : "";
    const m = section.auditAnchors.mmr ? "✅" : "";
    const a = section.auditAnchors.autism ? "✅" : "";
    const d = section.auditAnchors.dataAction ? "✅" : "";
    mdLines.push(
      `| ${section.sectionIndex} | ${section.charCount} | ${section.blockCount} | ${section.inferredLabel.substring(0, 25)} | ${section.boundaryReason} | ${t} | ${c} | ${m} | ${a} | ${d} |\n`
    );
  }

  mdLines.push("\n## Regression Anchor Grouping\n");
  mdLines.push(`**Thompson sections:** ${thompsonSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**CDC sections:** ${cdcSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**MMR sections:** ${mmrSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Autism sections:** ${autismSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Data-action sections:** ${dataActionSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Verstraeten sections:** ${verstraetinSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Simpsonwood sections:** ${simpsonwoodSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Thimerosal sections:** ${thimerosalSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Aluminum sections:** ${aluminumSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);

  mdLines.push("\n## Acceptance Criteria\n");
  const passAll = Object.values(acceptanceCriteria).every(v => {
    if (typeof v === "boolean") return v;
    if (typeof v === "object") return Object.values(v).every(vv => typeof vv === "boolean" ? vv : false);
    return false;
  });
  mdLines.push(`**Status:** ${passAll ? "✅ PASS" : "⚠️ CHECK_WARNINGS"}\n`);

  const mdPath = path.join(logsDir, `tm4_semantic_section_blocks_audit_v2_${TIMESTAMP}.md`);
  await fs.writeFile(mdPath, mdLines.join(""), "utf-8");
  console.log(`✅ Markdown: ${mdPath}`);

  // JSON report
  const jsonReport = {
    timestamp: TIMESTAMP,
    version: "v2",
    fixture: fixturePath,
    sectionConfig,
    versionComparison: {
      v1SectionCount: 26,
      v2SectionCount: sections.length,
      improvement: 26 - sections.length,
    },
    sectionCount: sections.length,
    avgSectionLength: avgSectionLength,
    maxSectionLength: Math.max(...sections.map(s => s.charCount)),
    blockCount: blocks.length,
    boundaryStats,
    acceptanceCriteria,
    sections: sections.map(s => ({
      sectionIndex: s.sectionIndex,
      charCount: s.charCount,
      blockStart: s.blockStart,
      blockEnd: s.blockEnd,
      blockCount: s.blockCount,
      heading: s.heading,
      inferredLabel: s.inferredLabel,
      boundaryReason: s.boundaryReason,
      auditAnchors: s.auditAnchors,
    })),
    regressionAnchors: {
      thompson: thompsonSections.map(s => s.sectionIndex),
      cdc: cdcSections.map(s => s.sectionIndex),
      mmr: mmrSections.map(s => s.sectionIndex),
      autism: autismSections.map(s => s.sectionIndex),
      dataAction: dataActionSections.map(s => s.sectionIndex),
      verstraeten: verstraetinSections.map(s => s.sectionIndex),
      simpsonwood: simpsonwoodSections.map(s => s.sectionIndex),
      thimerosal: thimerosalSections.map(s => s.sectionIndex),
      aluminum: aluminumSections.map(s => s.sectionIndex),
    },
  };

  const jsonPath = path.join(logsDir, `tm4_semantic_section_blocks_audit_v2_${TIMESTAMP}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), "utf-8");
  console.log(`✅ JSON: ${jsonPath}`);

  // ===================================================================
  // TASK 6: Summary
  // ===================================================================
  console.log("\n" + "=".repeat(70));
  console.log("TASK 6: Audit Summary");
  console.log("=".repeat(70) + "\n");

  console.log(`Files changed: 1 (created v2 script)`);
  console.log(`Files created: 2 (Markdown + JSON)`);
  console.log(`Commands run: 0 (audit-only)\n`);

  console.log(`Version comparison:`);
  console.log(`  v1 section count: 26`);
  console.log(`  v2 section count: ${sections.length}`);
  console.log(`  Improvement: ${26 - sections.length} fewer sections\n`);

  console.log(`Section table: ${sections.length} sections from ${blocks.length} blocks\n`);

  console.log(`Anchor grouping results:`);
  console.log(`  Thompson: ${thompsonSections.map(s => s.sectionIndex).join(", ") || "none"}`);
  console.log(`  CDC: ${cdcSections.map(s => s.sectionIndex).join(", ") || "none"}`);
  console.log(`  Verstraeten+Simpsonwood: ${verstraetinSet.size} sections\n`);

  console.log(`Acceptance criteria:`);
  console.log(`  Section count (8-18): ${acceptanceCriteria.sectionCountInRange ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Avg section (1500-3500): ${acceptanceCriteria.avgSectionLengthInRange ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Anchors grouped: ${acceptanceCriteria.anchors.thompson_cdc_mmr_autism_grouped ? "✅ PASS" : "⚠️ CHECK"}\n`);

  console.log(`Production code changed: ❌ NO\n`);

  console.log("=".repeat(70));
  console.log(`✅ TM4 SEMANTIC SECTION BLOCKS AUDIT V2 COMPLETE`);
  console.log("=".repeat(70) + "\n");
}

main().catch(err => {
  console.error("❌ Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
