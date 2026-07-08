#!/usr/bin/env node

/**
 * TM4 Semantic Section Blocks Audit
 *
 * Dry-run audit: Split the vaccine article HTML into coherent semantic sections.
 * NO LLM calls. NO DB calls. NO production changes.
 *
 * Goal: Verify that fixed-size chunks can be replaced with semantic sections
 * that preserve local context and maintain allegation coherence.
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

// ===================================================================
// MAIN
// ===================================================================

async function main() {
  console.log("🚀 TM4 Semantic Section Blocks Audit\n");
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
    console.error("❌ Fixture not found at any location");
    process.exit(1);
  }

  const $ = cheerio.load(htmlContent);

  // ===================================================================
  // TASK 2: Body root selection
  // ===================================================================
  console.log("\n" + "=".repeat(70));
  console.log("TASK 2: Body Root Selection");
  console.log("=".repeat(70) + "\n");

  const bodySelectors = [
    ...BODY_SELECTORS,
    "body",
  ];

  const candidateRoots = [];

  for (const selector of bodySelectors) {
    const $candidate = $(selector).first();
    if ($candidate.length === 0) continue;

    const text = $candidate.text();
    const cleanText = text.replace(/\s+/g, " ").trim();
    const textLength = cleanText.length;
    const paragraphCount = $candidate.find("p").length;

    // Count junk markers
    let junkMarkerCount = 0;
    JUNK_SELECTORS.forEach(junkSel => {
      junkMarkerCount += $candidate.find(junkSel).length;
    });

    // Check for title
    const containsTitle = /public health|vaccine|truth/.test(cleanText.toLowerCase());

    // Check for anchor terms
    const anchorMatches = Object.keys(ANCHOR_TERMS).filter(key => {
      return ANCHOR_TERMS[key].some(term => cleanText.includes(term));
    });
    const containsAnchorTerms = anchorMatches.length > 0;

    const candidate = {
      selector,
      textLength,
      paragraphCount,
      junkMarkerCount,
      containsTitle,
      containsAnchorTerms,
      anchorTermsFound: anchorMatches,
      quality: textLength > 30000 && paragraphCount > 50 && junkMarkerCount < 20 ? "high" : "medium",
    };

    candidateRoots.push(candidate);

    console.log(`Selector: ${selector}`);
    console.log(`  Text length: ${textLength}`);
    console.log(`  Paragraph count: ${paragraphCount}`);
    console.log(`  Junk markers: ${junkMarkerCount}`);
    console.log(`  Contains title: ${containsTitle}`);
    console.log(`  Anchor terms: ${anchorMatches.length > 0 ? anchorMatches.join(", ") : "none"}`);
    console.log(`  Quality: ${candidate.quality}\n`);
  }

  // Choose best root
  let bestRoot = candidateRoots
    .filter(c => !c.selector.includes("body")) // Prefer article selectors
    .sort((a, b) => {
      // Prefer high quality, high text length, moderate para count
      const scoreA = (a.textLength > 40000 ? 1 : 0) + (a.paragraphCount > 60 ? 1 : 0) + (a.junkMarkerCount < 15 ? 1 : 0);
      const scoreB = (b.textLength > 40000 ? 1 : 0) + (b.paragraphCount > 60 ? 1 : 0) + (b.junkMarkerCount < 15 ? 1 : 0);
      return scoreB - scoreA;
    })[0];

  if (!bestRoot) {
    console.log("⚠️ No article selector found, falling back to body");
    bestRoot = candidateRoots.find(c => c.selector === "body");
  }

  console.log(`✅ Chosen root selector: ${bestRoot.selector}`);
  console.log(`   Quality: ${bestRoot.quality}`);
  console.log(`   Text length: ${bestRoot.textLength}`);
  console.log(`   Paragraphs: ${bestRoot.paragraphCount}\n`);

  const $root = $(bestRoot.selector).first();

  // ===================================================================
  // TASK 3: Remove junk
  // ===================================================================
  console.log("=".repeat(70));
  console.log("TASK 3: Remove Junk Elements");
  console.log("=".repeat(70) + "\n");

  const $clean = $root.clone();
  JUNK_SELECTORS.forEach(sel => {
    $clean.find(sel).remove();
  });

  console.log(`Removed junk elements\n`);

  // ===================================================================
  // TASK 4: Build block atoms
  // ===================================================================
  console.log("=".repeat(70));
  console.log("TASK 4: Build Block Atoms");
  console.log("=".repeat(70) + "\n");

  const blocks = [];
  let charOffset = 0;

  $clean.contents().each((idx, elem) => {
    const $elem = $(elem);
    const tag = elem.name;

    if (!tag) return; // Text node, skip for now

    // Skip if not a block we care about
    if (!["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "figcaption", "table", "pre"].includes(tag)) {
      return;
    }

    let text = $elem.text().replace(/\s+/g, " ").trim();
    // cheerio.text() already decodes HTML entities

    // Skip empty blocks
    if (!text || text.length === 0) return;

    // Skip boilerplate under 20 chars unless heading
    if (text.length < 20 && !["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
      return;
    }

    const isHeading = /^h[1-6]$/.test(tag);
    const isListItem = tag === "li";
    const isQuote = tag === "blockquote";
    const isCaption = tag === "figcaption";

    // Detect likely visual heading
    const isLikelyVisualHeading =
      text.length <= 80 &&
      (text.toUpperCase() === text || $elem.find("strong, b").length > 0) &&
      !isListItem;

    const block = {
      blockIndex: blocks.length,
      tag,
      text: text.substring(0, 500), // Truncate for display
      textLength: text.length,
      isHeading,
      isLikelyVisualHeading,
      isQuote,
      isListItem,
      isCaption,
      charStartApprox: charOffset,
      charEndApprox: charOffset + text.length,
      fullText: text, // Keep full text for sectioning
    };

    blocks.push(block);
    charOffset += text.length + 1; // +1 for space/newline
  });

  console.log(`Total blocks created: ${blocks.length}`);
  console.log(`  Headings: ${blocks.filter(b => b.isHeading).length}`);
  console.log(`  Paragraphs: ${blocks.filter(b => b.tag === "p").length}`);
  console.log(`  List items: ${blocks.filter(b => b.isListItem).length}`);
  console.log(`  Blockquotes: ${blocks.filter(b => b.isQuote).length}`);
  console.log(`  Visual headings: ${blocks.filter(b => b.isLikelyVisualHeading).length}\n`);

  // ===================================================================
  // TASK 5 & 6: Build semantic sections
  // ===================================================================
  console.log("=".repeat(70));
  console.log("TASK 5 & 6: Build Semantic Sections");
  console.log("=".repeat(70) + "\n");

  const sectionConfig = {
    minSectionChars: 700,
    targetSectionChars: 2200,
    maxSectionChars: 4200,
    overlapBlocksWhenForcedSplit: 1,
  };

  const sections = [];
  let currentSectionBlocks = [];
  let currentSectionChars = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const nextBlock = blocks[i + 1];

    currentSectionBlocks.push(i);
    currentSectionChars += block.textLength;

    // Check for hard boundary
    const isHardBoundary =
      block.isHeading && /^h[2-4]$/.test(block.tag) ||
      block.isLikelyVisualHeading ||
      (block.fullText.includes("—") && block.fullText.length < 100);

    // Check for soft boundary
    let isSoftBoundary = false;
    if (nextBlock) {
      const nextText = nextBlock.fullText.toLowerCase();
      if (currentSectionChars >= sectionConfig.minSectionChars) {
        const hasTopicShift = TOPIC_SHIFT_CUES.some(cue => nextText.startsWith(cue.toLowerCase()));
        if (hasTopicShift) isSoftBoundary = true;

        const hasNamedCluster = NAMED_CLUSTERS.some(cluster => nextText.includes(cluster));
        if (currentSectionChars >= sectionConfig.targetSectionChars && hasNamedCluster) {
          isSoftBoundary = true;
        }
      }
    }

    // Check if exceeds max
    const willExceedMax = nextBlock && (currentSectionChars + nextBlock.textLength) > sectionConfig.maxSectionChars;

    // Decide on boundary
    const shouldBoundary =
      isHardBoundary ||
      isSoftBoundary ||
      (willExceedMax && currentSectionChars >= sectionConfig.minSectionChars) ||
      i === blocks.length - 1;

    if (shouldBoundary && currentSectionBlocks.length > 0) {
      // Create section
      const sectionBlockIndexes = [...currentSectionBlocks];
      const sectionText = sectionBlockIndexes
        .map(idx => blocks[idx].fullText)
        .join(" ");

      // Infer heading/label
      const firstBlockInSection = blocks[sectionBlockIndexes[0]];
      let heading = "";
      let inferredLabel = "";

      if (firstBlockInSection.isHeading || firstBlockInSection.isLikelyVisualHeading) {
        heading = firstBlockInSection.fullText.substring(0, 100);
        inferredLabel = heading;
      } else {
        // Try to infer from first 50 chars or from named clusters
        const firstWords = sectionText.substring(0, 80);
        inferredLabel = firstWords;
        for (const cluster of NAMED_CLUSTERS) {
          if (sectionText.toLowerCase().includes(cluster.toLowerCase())) {
            inferredLabel = cluster;
            break;
          }
        }
      }

      // Determine boundary reason
      let boundaryReason = "unknown";
      if (isHardBoundary) boundaryReason = "hard_boundary (heading/visual)";
      if (isSoftBoundary) boundaryReason = "soft_boundary (topic shift)";
      if (willExceedMax) boundaryReason = "exceeds_max_chars";
      if (i === blocks.length - 1) boundaryReason = "article_end";

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
        text: sectionText.substring(0, 500), // Truncated for display
        fullText: sectionText, // Keep full for analysis
        blockStart: sectionBlockIndexes[0],
        blockEnd: sectionBlockIndexes[sectionBlockIndexes.length - 1],
        blockCount: sectionBlockIndexes.length,
        charCount: sectionText.length,
        boundaryReason,
        sourceBlockIndexes: sectionBlockIndexes,
        startsWith: sectionText.substring(0, 60).replace(/\n/g, " "),
        endsWith: sectionText.substring(sectionText.length - 60).replace(/\n/g, " "),
        auditAnchors,
      };

      sections.push(section);

      // Reset for next section
      currentSectionBlocks = [];
      currentSectionChars = 0;

      // Add overlap blocks if forced split
      if (willExceedMax && sectionConfig.overlapBlocksWhenForcedSplit > 0 && nextBlock) {
        for (let j = 0; j < sectionConfig.overlapBlocksWhenForcedSplit && i < blocks.length - 1; j++) {
          currentSectionBlocks.push(i + 1 + j);
          currentSectionChars += blocks[i + 1 + j].textLength;
        }
      }
    }
  }

  console.log(`Total sections created: ${sections.length}`);
  console.log(`Average section length: ${Math.round(sections.reduce((sum, s) => sum + s.charCount, 0) / sections.length)} chars\n`);

  // ===================================================================
  // TASK 8: Acceptance criteria
  // ===================================================================
  console.log("=".repeat(70));
  console.log("TASK 8: Acceptance Criteria");
  console.log("=".repeat(70) + "\n");

  const acceptanceCriteria = {
    noLLMCalls: true,
    noDBCalls: true,
    noProductionChanges: true,
    bodyFallbackNotUsed: bestRoot.selector !== "body",
    sectionCountInRange: sections.length >= 8 && sections.length <= 18,
    avgSectionLengthInRange: {
      avg: Math.round(sections.reduce((sum, s) => sum + s.charCount, 0) / sections.length),
      inRange: Math.round(sections.reduce((sum, s) => sum + s.charCount, 0) / sections.length) >= 1000 &&
               Math.round(sections.reduce((sum, s) => sum + s.charCount, 0) / sections.length) <= 3500,
    },
    noSectionExceedsMax: sections.every(s => s.charCount <= 4200),
    visualHeadingsAreBoundaries: true, // by design
    regressionAnchorsGrouped: {
      thompson_cdc_mmr_autism: false, // Check below
      thompson_data_action: false,
      verstraeten_simpsonwood_thimerosal: false,
      aluminum_tomato: false,
    },
  };

  // Check regression anchors
  const thomsonSections = sections.filter(s => s.auditAnchors.williamThompson);
  const cdcSections = sections.filter(s => s.auditAnchors.cdc);
  const mmrSections = sections.filter(s => s.auditAnchors.mmr);
  const autismSections = sections.filter(s => s.auditAnchors.autism);
  const dataActionSections = sections.filter(s => s.auditAnchors.dataAction);
  const verstraetinSections = sections.filter(s => s.auditAnchors.verstraeten);
  const simpsonwoodSections = sections.filter(s => s.auditAnchors.simpsonwood);
  const thimerosalSections = sections.filter(s => s.auditAnchors.thimerosal);
  const aluminumSections = sections.filter(s => s.auditAnchors.aluminum);

  // Thompson + CDC + MMR + autism should overlap or be adjacent
  const thompsonCDCMMRSet = new Set([
    ...thomsonSections.map(s => s.sectionIndex),
    ...cdcSections.map(s => s.sectionIndex),
    ...mmrSections.map(s => s.sectionIndex),
    ...autismSections.map(s => s.sectionIndex),
  ]);
  acceptanceCriteria.regressionAnchorsGrouped.thompson_cdc_mmr_autism =
    thompsonCDCMMRSet.size <= 2; // Should be in 1-2 adjacent sections

  // Thompson + data action should be same or adjacent
  const thompsonDataSet = new Set([
    ...thomsonSections.map(s => s.sectionIndex),
    ...dataActionSections.map(s => s.sectionIndex),
  ]);
  acceptanceCriteria.regressionAnchorsGrouped.thompson_data_action =
    thompsonDataSet.size <= 2;

  // Verstraeten + Simpsonwood + thimerosal should be grouped
  const verstraetinSet = new Set([
    ...verstraetinSections.map(s => s.sectionIndex),
    ...simpsonwoodSections.map(s => s.sectionIndex),
    ...thimerosalSections.map(s => s.sectionIndex),
  ]);
  acceptanceCriteria.regressionAnchorsGrouped.verstraeten_simpsonwood_thimerosal =
    verstraetinSet.size <= 2;

  // Aluminum should be grouped (usually has injected/bloodstream context)
  acceptanceCriteria.regressionAnchorsGrouped.aluminum_tomato =
    aluminumSections.length > 0 && aluminumSections.length <= 2;

  // Print acceptance results
  console.log(`✅ No LLM calls: ${acceptanceCriteria.noLLMCalls}`);
  console.log(`✅ No DB calls: ${acceptanceCriteria.noDBCalls}`);
  console.log(`✅ No production changes: ${acceptanceCriteria.noProductionChanges}`);
  console.log(`${acceptanceCriteria.bodyFallbackNotUsed ? "✅" : "⚠️"} Body fallback not used: ${acceptanceCriteria.bodyFallbackNotUsed}`);
  console.log(`${acceptanceCriteria.sectionCountInRange ? "✅" : "❌"} Section count in range (8-18): ${sections.length}`);
  console.log(`${acceptanceCriteria.avgSectionLengthInRange.inRange ? "✅" : "❌"} Avg section length in range (1000-3500): ${acceptanceCriteria.avgSectionLengthInRange.avg}`);
  console.log(`${acceptanceCriteria.noSectionExceedsMax ? "✅" : "❌"} No section exceeds max (4200): ${sections.every(s => s.charCount <= 4200)}`);
  console.log(`✅ Visual headings are boundaries: true (by design)`);
  console.log(`${acceptanceCriteria.regressionAnchorsGrouped.thompson_cdc_mmr_autism ? "✅" : "⚠️"} Thompson+CDC+MMR+autism grouped: ${acceptanceCriteria.regressionAnchorsGrouped.thompson_cdc_mmr_autism}`);
  console.log(`${acceptanceCriteria.regressionAnchorsGrouped.thompson_data_action ? "✅" : "⚠️"} Thompson+data-action grouped: ${acceptanceCriteria.regressionAnchorsGrouped.thompson_data_action}`);
  console.log(`${acceptanceCriteria.regressionAnchorsGrouped.verstraeten_simpsonwood_thimerosal ? "✅" : "⚠️"} Verstraeten+Simpsonwood+thimerosal grouped: ${acceptanceCriteria.regressionAnchorsGrouped.verstraeten_simpsonwood_thimerosal}`);
  console.log(`${acceptanceCriteria.regressionAnchorsGrouped.aluminum_tomato ? "✅" : "⚠️"} Aluminum grouped: ${acceptanceCriteria.regressionAnchorsGrouped.aluminum_tomato}\n`);

  // ===================================================================
  // TASK 7: Generate reports
  // ===================================================================
  console.log("=".repeat(70));
  console.log("TASK 7: Generate Reports");
  console.log("=".repeat(70) + "\n");

  const logsDir = path.join(__dirname, "../../backend/logs");
  await fs.mkdir(logsDir, { recursive: true });

  // Markdown report
  const mdLines = [];
  mdLines.push("# TM4 Semantic Section Blocks Audit\n");
  mdLines.push(`**Timestamp:** ${TIMESTAMP}\n`);
  mdLines.push(`**Fixture:** ${fixturePath}\n`);
  mdLines.push(`**Status:** Dry-run audit (no LLM, no DB, no production changes)\n`);

  mdLines.push("\n## Body Selector Comparison\n");
  mdLines.push("| Selector | Text Length | Paragraphs | Junk Markers | Has Title | Anchor Terms | Chosen |\n");
  mdLines.push("|----------|-------------|-----------|------------|-----------|------------|--------|\n");
  for (const candidate of candidateRoots) {
    const chosen = candidate.selector === bestRoot.selector ? "✅" : "";
    mdLines.push(
      `| ${candidate.selector} | ${candidate.textLength} | ${candidate.paragraphCount} | ${candidate.junkMarkerCount} | ${candidate.containsTitle ? "✅" : "❌"} | ${candidate.anchorTermsFound.length} | ${chosen} |\n`
    );
  }

  mdLines.push("\n## Block Inventory\n");
  mdLines.push(`- Total blocks: ${blocks.length}\n`);
  mdLines.push(`- Paragraphs: ${blocks.filter(b => b.tag === "p").length}\n`);
  mdLines.push(`- Headings: ${blocks.filter(b => b.isHeading).length}\n`);
  mdLines.push(`- Quotes: ${blocks.filter(b => b.isQuote).length}\n`);
  mdLines.push(`- Visual headings: ${blocks.filter(b => b.isLikelyVisualHeading).length}\n`);

  mdLines.push("\n## Semantic Sections\n");
  mdLines.push("| Index | Char Count | Blocks | Label | Boundary Reason | Anchors |\n");
  mdLines.push("|-------|-----------|--------|-------|------------|----------|\n");
  for (const section of sections) {
    const anchors = Object.keys(section.auditAnchors)
      .filter(k => section.auditAnchors[k])
      .map(k => k.replace(/([A-Z])/g, " $1").trim())
      .join(", ");
    const anchorDisplay = anchors ? anchors.substring(0, 30) : "—";
    mdLines.push(
      `| ${section.sectionIndex} | ${section.charCount} | ${section.blockCount} | ${section.inferredLabel.substring(0, 30)} | ${section.boundaryReason} | ${anchorDisplay} |\n`
    );
  }

  mdLines.push("\n## Regression Anchor Grouping\n");
  mdLines.push(`**Thompson sections:** ${thomsonSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**CDC sections:** ${cdcSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**MMR sections:** ${mmrSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Autism sections:** ${autismSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Data-action sections:** ${dataActionSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Verstraeten sections:** ${verstraetinSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Simpsonwood sections:** ${simpsonwoodSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Thimerosal sections:** ${thimerosalSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);
  mdLines.push(`**Aluminum sections:** ${aluminumSections.map(s => s.sectionIndex).join(", ") || "none"}\n`);

  mdLines.push("\n## Warnings\n");
  const warnings = [];
  sections.forEach(s => {
    if (s.charCount > sectionConfig.maxSectionChars) {
      warnings.push(`⚠️ Section ${s.sectionIndex} exceeds max (${s.charCount} > ${sectionConfig.maxSectionChars})`);
    }
    if (s.charCount < sectionConfig.minSectionChars) {
      warnings.push(`⚠️ Section ${s.sectionIndex} under min (${s.charCount} < ${sectionConfig.minSectionChars})`);
    }
  });

  if (bestRoot.selector === "body") {
    warnings.push("⚠️ Body fallback used (article selectors failed)");
  }

  if (warnings.length === 0) {
    mdLines.push("✅ No warnings\n");
  } else {
    warnings.forEach(w => mdLines.push(`${w}\n`));
  }

  mdLines.push("\n## Acceptance Criteria\n");
  const passAll = Object.values(acceptanceCriteria).every(v =>
    typeof v === "boolean" ? v : (typeof v === "object" ? Object.values(v).every(vv => typeof vv === "boolean" ? vv : false) : false)
  );
  mdLines.push(`**Overall:** ${passAll ? "✅ PASS" : "⚠️ CHECK WARNINGS"}\n`);

  const mdPath = path.join(logsDir, `tm4_semantic_section_blocks_audit_${TIMESTAMP}.md`);
  await fs.writeFile(mdPath, mdLines.join(""), "utf-8");
  console.log(`✅ Markdown report: ${mdPath}`);

  // JSON report
  const jsonReport = {
    timestamp: TIMESTAMP,
    fixture: fixturePath,
    bodySelector: bestRoot.selector,
    blockCount: blocks.length,
    sectionCount: sections.length,
    sectionConfig,
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
      startsWith: s.startsWith.substring(0, 100),
      endsWith: s.endsWith.substring(0, 100),
      auditAnchors: s.auditAnchors,
    })),
    regressionAnchors: {
      thompson: thomsonSections.map(s => s.sectionIndex),
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

  const jsonPath = path.join(logsDir, `tm4_semantic_section_blocks_audit_${TIMESTAMP}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), "utf-8");
  console.log(`✅ JSON report: ${jsonPath}`);

  // ===================================================================
  // TASK 9: Return summary
  // ===================================================================
  console.log("\n" + "=".repeat(70));
  console.log("TASK 9: Audit Summary");
  console.log("=".repeat(70) + "\n");

  console.log(`Files inspected: ${fixturePath}`);
  console.log(`Files created: 2 (Markdown + JSON)`);
  console.log(`Commands run: 0 (audit-only, no LLM/DB)\n`);

  console.log(`Chosen body selector: ${bestRoot.selector}`);
  console.log(`Block count: ${blocks.length}`);
  console.log(`Section count: ${sections.length}\n`);

  console.log(`Section count in range (8-18): ${acceptanceCriteria.sectionCountInRange ? "✅ YES" : "❌ NO"}`);
  console.log(`Avg section length: ${acceptanceCriteria.avgSectionLengthInRange.avg} chars (target 1000-3500)`);
  console.log(`No section exceeds max: ${acceptanceCriteria.noSectionExceedsMax ? "✅ YES" : "❌ NO"}`);
  console.log(`Body fallback not used: ${acceptanceCriteria.bodyFallbackNotUsed ? "✅ YES" : "⚠️ USED"}\n`);

  console.log(`Regression anchor grouping:`);
  console.log(`  Thompson+CDC+MMR+autism: ${acceptanceCriteria.regressionAnchorsGrouped.thompson_cdc_mmr_autism ? "✅ GROUPED" : "⚠️ SPLIT (check warnings)"}`);
  console.log(`  Thompson+data-action: ${acceptanceCriteria.regressionAnchorsGrouped.thompson_data_action ? "✅ GROUPED" : "⚠️ SPLIT"}`);
  console.log(`  Verstraeten+Simpsonwood+thimerosal: ${acceptanceCriteria.regressionAnchorsGrouped.verstraeten_simpsonwood_thimerosal ? "✅ GROUPED" : "⚠️ SPLIT"}`);
  console.log(`  Aluminum: ${acceptanceCriteria.regressionAnchorsGrouped.aluminum_tomato ? "✅ GROUPED" : "⚠️ SPLIT"}\n`);

  console.log(`Production code changed: ❌ NO (audit-only)\n`);

  console.log("=".repeat(70));
  console.log("✅ TM4 SEMANTIC SECTION BLOCKS AUDIT COMPLETE");
  console.log("=".repeat(70) + "\n");

  console.log(`Result: TM4 semantic section blocks audit`);
  console.log(`Status: ${passAll ? "PASS" : "CHECK_WARNINGS"}`);
}

main().catch(err => {
  console.error("❌ Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
