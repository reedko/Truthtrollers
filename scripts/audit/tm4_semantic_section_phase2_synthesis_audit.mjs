#!/usr/bin/env node

/**
 * TM4 Semantic Section Phase 2 Claim-Map Synthesis Audit
 *
 * Article-internal synthesis only (no evidence, no source search, no persistence).
 * Consumes Phase 1 local extraction output.
 * Produces article theme, pillars, and synthesized evaluation candidates.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment FIRST, before any other imports
import dotenv from "dotenv";
const envPath = path.join(__dirname, "../../backend/.env");
const result = dotenv.config({ path: envPath });

if (result.error && result.error.code !== 'ENOENT') {
  console.error(`❌ Error loading .env: ${result.error.message}`);
}

// Manually set OPENAI_API_KEY from environment
const apiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
if (!apiKey) {
  console.error("❌ FATAL: OPENAI_API_KEY not found in environment or backend/.env");
  process.exit(1);
}
process.env.OPENAI_API_KEY = apiKey;

// Now import modules that depend on env vars
import { LocalClaimMapSynthesizer } from "../../backend/src/core/localClaimMapSynthesizer.js";
import { openAiLLM } from "../../backend/src/core/openAiLLM.js";
import { buildDeterministicClaimClusters } from "../../backend/src/core/deterministicClaimClustering.js";

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

// Phase 2 config
const CONFIG = {
  promptSource: "hardcoded",
  promptFallbackOnError: true,
  llmModel: "gpt-4o-mini",
  llmTemperature: 0.2,
  llmTimeoutMs: 150000,  // Increased for cluster payload
  llmMaxRetries: 1,
};

// Cluster audit definitions (for scoring only)
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
  console.log("🚀 TM4 Semantic Section Phase 2 Claim-Map Synthesis Audit\n");
  console.log("=".repeat(70));

  const startTime = Date.now();

  // ===================================================================
  // STEP 1: Find latest Phase 1 audit JSON
  // ===================================================================
  console.log("STEP 1: Load Phase 1 Local Extraction Results");
  console.log("=".repeat(70) + "\n");

  const phase1JsonPath = await findLatestPhase1Json();
  if (!phase1JsonPath) {
    console.error("❌ No Phase 1 audit JSON found. Cannot proceed.");
    process.exit(1);
  }

  console.log(`✅ Found Phase 1 JSON: ${phase1JsonPath}`);

  const phase1Data = JSON.parse(await fs.readFile(phase1JsonPath, "utf-8"));

  const semanticResults = phase1Data.semanticResults || [];
  console.log(`   Semantic section claims: ${semanticResults.length}`);

  // ===================================================================
  // STEP 2: Prepare local claims for Phase 2
  // ===================================================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 2: Prepare Local Claims for Phase 2");
  console.log("=".repeat(70) + "\n");

  const localClaimsForPhase2 = prepareClaims(semanticResults, "semantic_section");
  const phase1SemanticTotalClaims = phase1Data.semanticExtraction?.totalClaims || 0;

  console.log(`✅ Prepared ${localClaimsForPhase2.length} flattened local claims`);
  console.log(`   Phase 1 reported total: ${phase1SemanticTotalClaims}`);
  console.log(`   Sections: ${semanticResults.length}`);

  // Create ultra-compact claims for Phase 2 to avoid timeout
  const compactClaimsForLLM = localClaimsForPhase2.map(c => ({
    claimIndex: c.claimIndex,
    claimText: c.claimText.substring(0, 120),  // Truncate to 120 chars max
    searchText: c.searchText.substring(0, 60),  // Truncate searchText to 60 chars
  }));

  // Invariant check
  if (localClaimsForPhase2.length < 60) {
    console.error(`\n❌ FATAL: Flattened claims (${localClaimsForPhase2.length}) < 60. Cannot proceed.`);
    process.exit(1);
  }

  if (localClaimsForPhase2.length !== phase1SemanticTotalClaims) {
    console.warn(`⚠️ WARNING: Flattened claims (${localClaimsForPhase2.length}) !== Phase 1 total (${phase1SemanticTotalClaims})`);
  }

  // Validate claims
  const validationIssues = validateFlattenedClaims(localClaimsForPhase2);
  if (validationIssues.length > 0) {
    console.log(`\n❌ Validation issues found:`);
    validationIssues.forEach(issue => console.log(`   - ${issue}`));
    process.exit(1);
  }
  console.log(`✅ All claims passed validation\n`);

  // ===================================================================
  // STEP 3: Run Phase 2 synthesis on semantic claims
  // ===================================================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 3: Run Phase 2 Claim-Map Synthesis");
  console.log("=".repeat(70) + "\n");

  // Pre-LLM logging
  console.log(`Pre-LLM Status:`);
  console.log(`  Flattened semantic claim count: ${localClaimsForPhase2.length}`);

  const compactForLLM = localClaimsForPhase2.map(c => ({
    claimIndex: c.claimIndex,
    sectionIndex: c.unitIndex,
    claimText: c.claimText.substring(0, 100),
    searchText: c.searchText.substring(0, 50),
    theme: c.localThemeLabel,
    excerptPreview: (c.localSourceExcerpt || "").substring(0, 40),
  }));

  const compactJson = JSON.stringify(compactForLLM);
  console.log(`  Compact JSON char count: ${compactJson.length} chars`);

  // Build deterministic clusters
  const clusterResult = buildDeterministicClaimClusters(compactForLLM);
  console.log(`  Deterministic cluster count: ${clusterResult.clusters.length}`);
  console.log(`  Cluster diagnostic count: ${clusterResult.diagnostics.unclusteredClaimCount} unclustered\n`);

  // Display top clusters
  console.log(`Top 12 clusters (by score):`);
  clusterResult.clusters.slice(0, 12).forEach((cluster, i) => {
    console.log(`  [${i+1}] ${cluster.clusterLabel} (score: ${cluster.clusterScore})`);
    console.log(`      Claims: [${cluster.claimIndexes.join(", ")}]`);
    console.log(`      Anchors: ${cluster.anchors.slice(0, 3).join(", ")}`);
  });
  console.log();

  // Prepare payload
  const llmPayload = {
    claims: compactForLLM,
    deterministicClusters: clusterResult.clusters,
  };
  const payloadJson = JSON.stringify(llmPayload);

  console.log(`LLM Payload:`);
  console.log(`  Total char count: ${payloadJson.length} chars`);
  console.log(`  Planned LLM calls: 1`);
  console.log(`  Model: ${CONFIG.llmModel}`);
  console.log(`  Timeout: ${CONFIG.llmTimeoutMs}ms`);
  console.log(`  Temperature: ${CONFIG.llmTemperature}\n`);

  const synthesizer = new LocalClaimMapSynthesizer(openAiLLM, CONFIG);
  const synthesisResult = await synthesizer.synthesize(
    "Article",
    compactForLLM,
    localClaimsForPhase2  // Keep full claims for excerpt reattachment
  );

  console.log(`✅ Synthesis complete`);
  console.log(`   OpenAI calls: ${synthesisResult.diagnostics.totalOpenAICalls}`);
  console.log(`   Synthesized claims returned: ${synthesisResult.synthesizedClaims.length}`);
  console.log(`   Excerpts reattached: ${synthesisResult.synthesizedClaims.reduce((sum, s) => sum + (s.sourceExcerpts?.length || 0), 0)}\n`);

  console.log(`Article theme:`);
  console.log(`  Thesis: ${synthesisResult.articleTheme.thesis.substring(0, 80)}`);
  console.log(`  Dominant signals: ${synthesisResult.articleTheme.dominantSignals.length}`);
  console.log(`\nPillars: ${synthesisResult.pillars.length}`);
  console.log(`Synthesized claims: ${synthesisResult.synthesizedClaims.length}`);
  console.log(`Claim assignments: ${synthesisResult.claimAssignments.length}\n`);

  // ===================================================================
  // STEP 3b: Cluster Coverage Analysis
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 3b: Cluster Coverage Analysis");
  console.log("=".repeat(70) + "\n");

  // Check which clusters are covered by synthesized claims
  const clustersCovered = new Set();
  let synthFromClusters = 0;
  let synthFromOutside = 0;

  for (const synth of synthesisResult.synthesizedClaims) {
    const sourceIndexes = new Set(synth.sourceClaimIndexes || []);

    // Check if this synthesized claim comes from any cluster
    let foundCluster = false;
    for (const cluster of clusterResult.clusters) {
      const clusterIndexes = new Set(cluster.claimIndexes);
      const intersection = [...sourceIndexes].filter(idx => clusterIndexes.has(idx));

      if (intersection.length >= 2) {
        clustersCovered.add(cluster.clusterId);
        synthFromClusters++;
        foundCluster = true;
        break;
      } else if (intersection.length === 1) {
        // Partial cluster usage
        foundCluster = true;
        break;
      }
    }

    if (!foundCluster) {
      synthFromOutside++;
    }
  }

  console.log(`Cluster coverage:`);
  console.log(`  Clusters with synthesized claims: ${clustersCovered.size}/${clusterResult.clusters.length}`);
  console.log(`  Synthesized from clusters: ${synthFromClusters}`);
  console.log(`  Synthesized from outside clusters: ${synthFromOutside}`);
  console.log(`  Unclustered claims in article: ${clusterResult.diagnostics.unclusteredClaimCount}\n`);

  // ===================================================================
  // STEP 4: Validate Phase 2 output
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 4: Validate Phase 2 Output");
  console.log("=".repeat(70) + "\n");

  // CRITICAL: Fail immediately if synthesis, assignment, or clustering are insufficient
  const synthCount = synthesisResult.synthesizedClaims.length;
  const assignCount = synthesisResult.claimAssignments.length;
  const assignRate = localClaimsForPhase2.length > 0 ? (assignCount / localClaimsForPhase2.length) * 100 : 0;

  // Validate cluster count
  if (localClaimsForPhase2.length < 60) {
    console.error("\n❌ FATAL: Compact claim count below minimum.");
    console.error(`Compact claims: ${localClaimsForPhase2.length} (minimum 60)`);
    process.exit(1);
  }

  if (clusterResult.clusters.length < 8) {
    console.error("\n❌ FATAL: Deterministic cluster count below minimum.");
    console.error(`Clusters: ${clusterResult.clusters.length} (minimum 8)`);
    process.exit(1);
  }

  if (synthFromClusters === 0 && synthCount > 0) {
    console.error("\n❌ FATAL: No synthesized claims use multi-claim clusters.");
    console.error(`Synthesized from clusters: ${synthFromClusters} (minimum 1)`);
    process.exit(1);
  }

  if (synthCount < 3) {
    console.error("\n❌ FATAL: Phase 2 synthesis contract violated.");
    console.error(`Synthesized claims: ${synthCount} (target 8-24, minimum 3)`);
    console.error("The LLM MUST generate synthesized evaluation candidates from related local claims.");
    console.error("\nThe prompt requires:");
    console.error("  1. 8-24 synthesized claims (combining 2+ local claims each with shared anchors)");
    console.error("  2. Assignment of 80%+ of local claims to pillars");
    console.error("  3. 4+ pillars grouping related claims");
    console.error("\nAudit fails loudly.");
    process.exit(1);
  }

  if (assignRate < 80) {
    console.error("\n❌ FATAL: Phase 2 assignment contract violated.");
    console.error(`Claims assigned: ${assignCount}/${localClaimsForPhase2.length} (${assignRate.toFixed(1)}%, target ≥80%)`);
    console.error("The LLM MUST assign every claim to a pillar or use background/unclear role.");
    console.error("\nThe prompt requires:");
    console.error("  1. Assign 80%+ of local claims (61+ out of 76)");
    console.error("  2. Use background/unclear for non-pillar claims");
    console.error("  3. Do not leave claims unassigned");
    console.error("\nAudit fails loudly.");
    process.exit(1);
  }

  const phase2ValidationIssues = validatePhase2Output(synthesisResult, localClaimsForPhase2);
  if (phase2ValidationIssues.length > 0) {
    console.log(`❌ Phase 2 output validation failures:`);
    phase2ValidationIssues.forEach(issue => console.log(`   - ${issue}`));
    console.error("\n❌ FATAL: Phase 2 synthesis failed validation. Aborting.");
    process.exit(1);
  }
  console.log(`✅ Phase 2 output validation passed\n`);

  // ===================================================================
  // STEP 5: Cluster audit scoring
  // ===================================================================
  console.log("\n" + "=".repeat(70));
  console.log("STEP 5: Cluster Audit");
  console.log("=".repeat(70) + "\n");

  const clusterResults = auditClusters(synthesisResult.synthesizedClaims);

  for (const clusterKey of Object.keys(CLUSTERS)) {
    const result = clusterResults[clusterKey];
    console.log(`${CLUSTERS[clusterKey].name}:`);
    console.log(`  Found: ${result.found ? "✅ YES" : "❌ NO"}`);
    if (result.found) {
      console.log(`  Best text: ${result.bestText.substring(0, 100)}`);
      console.log(`  Source indexes: ${result.sourceIndexes.join(", ")}`);
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(`\n✅ Total runtime: ${totalTime}ms\n`);

  // ===================================================================
  // STEP 6: Generate reports
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 6: Generate Reports");
  console.log("=".repeat(70) + "\n");

  const logsDir = path.join(__dirname, "../../backend/logs");
  await fs.mkdir(logsDir, { recursive: true });

  // Calculate correct assignment rate
  const uniqueAssignedIndexes = new Set(
    synthesisResult.claimAssignments
      .map(ca => ca.claimIndex)
      .filter(idx => idx >= 0 && idx < localClaimsForPhase2.length)
  );
  const correctAssignmentRate = localClaimsForPhase2.length > 0 ?
    (uniqueAssignedIndexes.size / localClaimsForPhase2.length) * 100 : 0;
  const duplicateAssignments = synthesisResult.claimAssignments.length - uniqueAssignedIndexes.size;
  const unassignedClaims = localClaimsForPhase2.length - uniqueAssignedIndexes.size;

  // Input preview data
  const inputPreview = generateInputPreview(localClaimsForPhase2);

  // Markdown report
  const mdReport = generateMarkdownReport(
    phase1JsonPath,
    localClaimsForPhase2,
    synthesisResult,
    clusterResults,
    totalTime,
    inputPreview,
    correctAssignmentRate,
    duplicateAssignments,
    unassignedClaims,
    phase2ValidationIssues
  );

  const mdPath = path.join(logsDir, `tm4_semantic_section_phase2_synthesis_audit_${TIMESTAMP}.md`);
  await fs.writeFile(mdPath, mdReport, "utf-8");
  console.log(`✅ Markdown: ${mdPath}`);

  // JSON report
  const jsonReport = {
    timestamp: TIMESTAMP,
    config: CONFIG,
    phase1JsonPath,
    semanticLocalClaimCount: localClaimsForPhase2.length,
    phase1ReportedTotal: phase1SemanticTotalClaims,
    articleTheme: synthesisResult.articleTheme,
    pillars: synthesisResult.pillars.map(p => ({
      pillarId: p.pillarId,
      pillarText: p.pillarText.substring(0, 150),
      supportingClaimCount: p.supportingClaimIndexes?.length || 0,
    })),
    claimAssignmentCount: synthesisResult.claimAssignments.length,
    uniqueAssignedCount: uniqueAssignedIndexes.size,
    duplicateAssignmentCount: duplicateAssignments,
    unassignedClaimCount: unassignedClaims,
    claimAssignmentRate: correctAssignmentRate,
    synthesizedClaimCount: synthesisResult.synthesizedClaims.length,
    provenanceDiagnostics: synthesisResult.diagnostics.provenanceChecks,
    inputPreview,
    phase2ValidationIssues,
    clusterAudit: clusterResults,
    totalOpenAICalls: synthesisResult.diagnostics.totalOpenAICalls,
    totalRuntimeMs: totalTime,
    promptSourceUsed: CONFIG.promptSource,
    noEvidenceCalls: true,
    noPersistence: true,
    noReducerCalls: true,
    productionBehaviorChanged: false,
  };

  const jsonPath = path.join(logsDir, `tm4_semantic_section_phase2_synthesis_audit_${TIMESTAMP}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), "utf-8");
  console.log(`✅ JSON: ${jsonPath}`);

  // ===================================================================
  // FINAL SUMMARY
  // ===================================================================
  console.log("\n" + "=".repeat(70));
  console.log("AUDIT COMPLETE");
  console.log("=".repeat(70) + "\n");

  console.log(`Phase 1 JSON: ${path.basename(phase1JsonPath)}`);
  console.log(`Prompt source: ${CONFIG.promptSource}\n`);

  console.log(`Input normalization:`);
  console.log(`  Flattened semantic claims: ${localClaimsForPhase2.length}`);
  console.log(`  Phase 1 reported total: ${phase1SemanticTotalClaims}`);
  console.log(`  Match: ${localClaimsForPhase2.length === phase1SemanticTotalClaims ? "✅" : "❌"}\n`);

  console.log(`Phase 2 synthesis:`);
  console.log(`  Article theme thesis: ${synthesisResult.articleTheme.thesis ? "✅ Set" : "❌ BLANK"}`);
  console.log(`  Pillars: ${synthesisResult.pillars.length} (target ≥4)`);
  console.log(`  Synthesized claims: ${synthesisResult.synthesizedClaims.length}`);
  console.log(`  Claim assignments: ${synthesisResult.claimAssignments.length}`);
  console.log(`  Unique assigned: ${uniqueAssignedIndexes.size}`);
  console.log(`  Duplicate assignments: ${duplicateAssignments}`);
  console.log(`  Unassigned claims: ${unassignedClaims}`);
  console.log(`  Assignment rate: ${correctAssignmentRate.toFixed(1)}% (target ≥80%)\n`);

  console.log(`Cluster audit:`);
  for (const clusterKey of Object.keys(CLUSTERS)) {
    const result = clusterResults[clusterKey];
    console.log(`  ${CLUSTERS[clusterKey].name}: ${result.found ? "✅" : "❌"}`);
  }

  console.log(`\nLLM calls: ${synthesisResult.diagnostics.totalOpenAICalls}`);
  console.log(`Runtime: ${totalTime}ms`);
  console.log(`No evidence: ✅`);
  console.log(`No persistence: ✅`);
  console.log(`No reducer: ✅`);
  console.log(`Production unchanged: ✅\n`);

  const passInputNormalization = localClaimsForPhase2.length === phase1SemanticTotalClaims;
  const passThesis = synthesisResult.articleTheme.thesis && synthesisResult.articleTheme.thesis.length > 0;
  const passPillars = synthesisResult.pillars.length >= 4;
  const passSynthesizedMin = synthesisResult.synthesizedClaims.length >= 3;
  const passSynthesizedTarget = synthesisResult.synthesizedClaims.length >= 8;
  const passAssignmentRate = correctAssignmentRate >= 80 && correctAssignmentRate <= 100;
  const passAllClusters = Object.values(clusterResults).every(r => r.found);

  console.log(`Validation:`);
  console.log(`  ${passInputNormalization ? "✅" : "❌"} Input flattened claims match Phase 1 total`);
  console.log(`  ${passThesis ? "✅" : "❌"} Article theme thesis not blank`);
  console.log(`  ${passPillars ? "✅" : "❌"} At least 4 pillars`);
  console.log(`  ${passSynthesizedMin ? "✅" : "❌"} At least 3 synthesized claims`);
  console.log(`  ${passSynthesizedTarget ? "✅" : "⚠️"} Target 8-24 synthesized claims: ${synthesisResult.synthesizedClaims.length}`);
  console.log(`  ${passAssignmentRate ? "✅" : "❌"} Assignment rate 80-100%`);
  console.log(`  ${passAllClusters ? "✅" : "❌"} All cluster audit (4/4): ${Object.values(clusterResults).filter(r => r.found).length}/4\n`);

  const acceptancePass =
    passInputNormalization &&
    passThesis &&
    passPillars &&
    passSynthesizedMin &&
    passAssignmentRate;

  console.log(`${acceptancePass ? "✅ AUDIT PASSES MINIMUM CRITERIA" : "⚠️ AUDIT HAS FAILURES"}`);
}

// ===================================================================
// HELPER FUNCTIONS
// ===================================================================

async function findLatestPhase1Json() {
  const logsDir = path.join(__dirname, "../../backend/logs");
  try {
    const files = await fs.readdir(logsDir);
    const phase1Files = files
      .filter(f => f.startsWith("tm4_semantic_section_local_extraction_audit_") && f.endsWith(".json"))
      .sort()
      .reverse();

    if (phase1Files.length === 0) return null;
    return path.join(logsDir, phase1Files[0]);
  } catch (err) {
    return null;
  }
}

function prepareClaims(sectionResults, unitType) {
  const claims = [];
  let claimIndex = 0;

  for (const sr of sectionResults) {
    if (!sr.claims) continue;

    for (const claim of sr.claims) {
      claims.push({
        claimIndex: claimIndex++,
        unitType,
        unitIndex: sr.sectionIndex,
        unitCharCount: sr.sectionCharCount,
        localThemeLabel: sr.localTheme?.label || "",
        localThemeSummary: sr.localTheme?.summary || "",
        claimText: claim.claimText,
        localSourceExcerpt: claim.localSourceExcerpt,
        searchText: claim.searchText,
        excerptExactMatch: false, // Will be checked in synthesizer
        excerptNormalizedMatch: false,
        provenanceWarnings: [],
      });
    }
  }

  return claims;
}

function auditClusters(synthesizedClaims) {
  const results = {};

  for (const clusterKey of Object.keys(CLUSTERS)) {
    const cluster = CLUSTERS[clusterKey];
    let found = false;
    let bestText = "";
    let sourceIndexes = [];

    for (const claim of synthesizedClaims) {
      const fullText = (claim.synthesizedClaimText || "") + " " + (claim.searchText || "") + " " + claim.sourceExcerpts.join(" ");
      const matches = cluster.terms.filter(term => fullText.includes(term)).length;

      if (matches >= 3) {
        found = true;
        if (!bestText) {
          bestText = claim.synthesizedClaimText.substring(0, 200);
          sourceIndexes = claim.sourceClaimIndexes || [];
        }
      }
    }

    results[clusterKey] = { found, bestText, sourceIndexes };
  }

  return results;
}

function validateFlattenedClaims(claims) {
  const issues = [];

  if (claims.length < 60) {
    issues.push(`Flattened claim count (${claims.length}) < 60`);
  }

  const claimIndexes = new Set();
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];

    if (!claim.claimIndex && claim.claimIndex !== 0) {
      issues.push(`Claim ${i} missing claimIndex`);
    } else if (claimIndexes.has(claim.claimIndex)) {
      issues.push(`Duplicate claimIndex: ${claim.claimIndex}`);
    } else {
      claimIndexes.add(claim.claimIndex);
    }

    if (!claim.claimText) {
      issues.push(`Claim ${i} missing claimText`);
    }

    if (claim.unitIndex === undefined || claim.unitIndex === null) {
      issues.push(`Claim ${i} missing unitIndex`);
    }

    if (!claim.localSourceExcerpt && (!claim.provenanceWarnings || claim.provenanceWarnings.length === 0)) {
      issues.push(`Claim ${i} missing excerpt AND no provenance warning`);
    }
  }

  return issues;
}

function validatePhase2Output(synthesisResult, localClaims) {
  const issues = [];

  if (!synthesisResult.articleTheme.thesis || synthesisResult.articleTheme.thesis.trim().length === 0) {
    issues.push(`Article theme thesis is blank`);
  }

  if (!synthesisResult.articleTheme.summary || synthesisResult.articleTheme.summary.trim().length === 0) {
    issues.push(`Article theme summary is blank`);
  }

  if (synthesisResult.pillars.length < 4) {
    issues.push(`Pillar count (${synthesisResult.pillars.length}) < 4 (target 4+)`);
  }

  const synthCount = synthesisResult.synthesizedClaims.length;
  if (synthCount < 3) {
    issues.push(`Synthesized claims (${synthCount}) < 3 (target 8-24)`);
  }
  if (synthCount < 8) {
    issues.push(`Synthesized claims (${synthCount}) < 8 (target 8-24, minimum acceptable)`);
  }

  // Check assignment rate
  const uniqueAssigned = new Set(
    synthesisResult.claimAssignments
      .map(ca => ca.claimIndex)
      .filter(idx => idx >= 0 && idx < localClaims.length)
  );
  const assignmentRate = localClaims.length > 0 ? (uniqueAssigned.size / localClaims.length) : 0;
  if (assignmentRate < 0.80) {
    issues.push(`Assignment rate (${(assignmentRate * 100).toFixed(1)}%) < 80% (assigned ${uniqueAssigned.size}/${localClaims.length})`);
  }

  // Validate source indexes in synthesized claims
  let invalidSourceIndexes = false;
  for (let i = 0; i < synthesisResult.synthesizedClaims.length; i++) {
    const synth = synthesisResult.synthesizedClaims[i];
    const sourceIndexes = synth.sourceClaimIndexes || [];

    if (sourceIndexes.length < 2) {
      issues.push(`Synthesized claim ${i} has ${sourceIndexes.length} source indexes (need 2+)`);
    }

    for (const idx of sourceIndexes) {
      if (idx < 0 || idx >= localClaims.length) {
        if (!invalidSourceIndexes) {
          issues.push(`Synthesized claims contain invalid source indexes`);
          invalidSourceIndexes = true;
        }
      }
    }
  }

  return issues;
}

function generateInputPreview(claims) {
  const preview = {
    totalClaimCount: claims.length,
    claimsByUnit: {},
    claimsWithThompson: 0,
    claimsWithVerstraeten: 0,
    claimsWithSimpsonwood: 0,
    claimsWithAluminum: 0,
    claimsWithVaccineAct: 0,
    first5Claims: [],
    last5Claims: [],
  };

  // Count by unit
  for (const claim of claims) {
    const unit = `section_${claim.unitIndex}`;
    if (!preview.claimsByUnit[unit]) preview.claimsByUnit[unit] = 0;
    preview.claimsByUnit[unit]++;
  }

  // Count anchors and collect first/last
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    const fullText = (claim.claimText || "") + " " + (claim.searchText || "");

    if (fullText.includes("Thompson")) preview.claimsWithThompson++;
    if (fullText.includes("Verstraeten")) preview.claimsWithVerstraeten++;
    if (fullText.includes("Simpsonwood")) preview.claimsWithSimpsonwood++;
    if (fullText.includes("aluminum")) preview.claimsWithAluminum++;
    if (fullText.includes("1986") || fullText.includes("National Childhood Vaccine Injury Act")) {
      preview.claimsWithVaccineAct++;
    }

    if (i < 5) {
      preview.first5Claims.push({
        claimIndex: claim.claimIndex,
        claimText: claim.claimText.substring(0, 100),
      });
    }

    if (i >= claims.length - 5) {
      preview.last5Claims.push({
        claimIndex: claim.claimIndex,
        claimText: claim.claimText.substring(0, 100),
      });
    }
  }

  return preview;
}

function generateMarkdownReport(
  phase1Path,
  localClaims,
  synthesisResult,
  clusterResults,
  totalTime,
  inputPreview,
  assignmentRate,
  duplicateAssignments,
  unassignedClaims,
  validationIssues
) {
  const lines = [];

  lines.push("# TM4 Semantic Section Phase 2 Claim-Map Synthesis Audit\n");
  lines.push(`**Timestamp:** ${TIMESTAMP}\n`);
  lines.push(`**Status:** Phase 2 synthesis with input normalization verification\n`);

  lines.push("\n## Setup\n");
  lines.push(`- Phase 1 input: ${path.basename(phase1Path)}\n`);
  lines.push(`- Prompt source: ${CONFIG.promptSource}\n`);
  lines.push(`- LLM: ${CONFIG.llmModel} @ temp ${CONFIG.llmTemperature}\n`);

  lines.push("\n## Input Normalization\n");
  lines.push(`**Flattened semantic claims:** ${localClaims.length}\n`);
  lines.push(`**First 5 claims:**\n`);
  for (const claim of inputPreview.first5Claims) {
    lines.push(`- [${claim.claimIndex}] ${claim.claimText}\n`);
  }
  lines.push(`**Last 5 claims:**\n`);
  for (const claim of inputPreview.last5Claims) {
    lines.push(`- [${claim.claimIndex}] ${claim.claimText}\n`);
  }
  lines.push(`\n**Claims by section:**\n`);
  for (const [unit, count] of Object.entries(inputPreview.claimsByUnit)) {
    lines.push(`- ${unit}: ${count}\n`);
  }
  lines.push(`\n**Anchor distribution:**\n`);
  lines.push(`- With Thompson: ${inputPreview.claimsWithThompson}\n`);
  lines.push(`- With Verstraeten: ${inputPreview.claimsWithVerstraeten}\n`);
  lines.push(`- With Simpsonwood: ${inputPreview.claimsWithSimpsonwood}\n`);
  lines.push(`- With aluminum: ${inputPreview.claimsWithAluminum}\n`);
  lines.push(`- With 1986 Act: ${inputPreview.claimsWithVaccineAct}\n`);

  lines.push("\n## Article Theme\n");
  lines.push(`**Thesis:** ${synthesisResult.articleTheme.thesis || "(BLANK)"}\n\n`);
  lines.push(`**Summary:** ${synthesisResult.articleTheme.summary || "(BLANK)"}\n\n`);
  lines.push(`**Dominant Signals:**\n`);
  for (const signal of (synthesisResult.articleTheme.dominantSignals || [])) {
    lines.push(`- ${signal}\n`);
  }

  lines.push("\n## Pillars\n");
  lines.push(`**Count:** ${synthesisResult.pillars.length} (target ≥4)\n\n`);
  lines.push(`| ID | Pillar | Supporting Claims |\n`);
  lines.push(`|----|--------|------------------|\n`);
  for (const pillar of synthesisResult.pillars) {
    const count = pillar.supportingClaimIndexes?.length || 0;
    lines.push(`| ${pillar.pillarId} | ${pillar.pillarText.substring(0, 60)} | ${count} |\n`);
  }

  lines.push("\n## Claim Assignments\n");
  lines.push(`**Total assignments:** ${synthesisResult.claimAssignments.length}\n`);
  lines.push(`**Unique assigned claims:** ${new Set(synthesisResult.claimAssignments.map(ca => ca.claimIndex)).size}\n`);
  lines.push(`**Duplicate assignments:** ${duplicateAssignments}\n`);
  lines.push(`**Unassigned claims:** ${unassignedClaims}\n`);
  lines.push(`**Assignment rate:** ${assignmentRate.toFixed(1)}% (target 80-100%)\n`);

  lines.push("\n## Synthesized Claims\n");
  lines.push(`**Total:** ${synthesisResult.synthesizedClaims.length} (target ≥3)\n\n`);
  if (synthesisResult.synthesizedClaims.length > 0) {
    lines.push(`| Type | Claim | Sources | Warnings |\n`);
    lines.push(`|------|-------|---------|----------|\n`);
    for (const claim of synthesisResult.synthesizedClaims.slice(0, 10)) {
      const warnings = (claim.provenanceWarnings || []).length;
      lines.push(`| ${claim.synthesisType} | ${claim.synthesizedClaimText.substring(0, 50)} | ${claim.sourceClaimIndexes.length} | ${warnings} |\n`);
    }
  } else {
    lines.push(`⚠️ No synthesized claims generated\n`);
  }

  lines.push("\n## Cluster Audit\n");
  for (const clusterKey of Object.keys(CLUSTERS)) {
    const result = clusterResults[clusterKey];
    lines.push(`### ${CLUSTERS[clusterKey].name}\n`);
    lines.push(`- Status: ${result.found ? "✅ Found" : "❌ Not found"}\n`);
    if (result.found) {
      lines.push(`- Best claim: ${result.bestText.substring(0, 100)}\n`);
      lines.push(`- Source indexes: ${result.sourceIndexes.join(", ")}\n`);
    }
    lines.push("\n");
  }

  lines.push("\n## Provenance Diagnostics\n");
  lines.push(`**Status:** Provenance inherited from Phase 1 or marked as not revalidated in Phase 2 (missing unit text)\n\n`);
  lines.push(`- Exact matches (inherited): ${synthesisResult.diagnostics.provenanceChecks.exactMatches}\n`);
  lines.push(`- Normalized matches (inherited): ${synthesisResult.diagnostics.provenanceChecks.normalizedMatches}\n`);
  lines.push(`- Entity matches (inherited): ${synthesisResult.diagnostics.provenanceChecks.entityMatches}\n`);
  lines.push(`- Failures (inherited): ${synthesisResult.diagnostics.provenanceChecks.failures}\n\n`);
  lines.push(`**Note:** Phase 2 does not revalidate excerpts when source unit text is not provided. Provenance data from Phase 1 is preserved as-is.\n`);

  if (validationIssues.length > 0) {
    lines.push("\n## Validation Issues\n");
    lines.push(`**Count:** ${validationIssues.length}\n\n`);
    for (const issue of validationIssues) {
      lines.push(`- ${issue}\n`);
    }
  }

  lines.push("\n## Acceptance Criteria\n");
  const passThesis = synthesisResult.articleTheme.thesis && synthesisResult.articleTheme.thesis.length > 0;
  const passPillars = synthesisResult.pillars.length >= 4;
  const passSynthesized = synthesisResult.synthesizedClaims.length >= 3;
  const passAssignmentRate = assignmentRate >= 80 && assignmentRate <= 100;
  const passAllClusters = Object.values(clusterResults).every(r => r.found);

  lines.push(`${passThesis ? "✅" : "❌"} Article theme thesis not blank\n`);
  lines.push(`${passPillars ? "✅" : "❌"} At least 4 pillars: ${synthesisResult.pillars.length}\n`);
  lines.push(`${passSynthesized ? "✅" : "❌"} At least 3 synthesized claims: ${synthesisResult.synthesizedClaims.length}\n`);
  lines.push(`${passAssignmentRate ? "✅" : "❌"} Claim assignment rate 80-100%: ${assignmentRate.toFixed(1)}%\n`);
  lines.push(`${passAllClusters ? "✅" : "⚠️"} All cluster audit: ${Object.values(clusterResults).filter(r => r.found).length}/${Object.keys(CLUSTERS).length}\n`);
  lines.push(`✅ No evidence\n`);
  lines.push(`✅ No persistence\n`);
  lines.push(`✅ No reducer\n`);
  lines.push(`✅ Production unchanged\n`);

  lines.push(`\n**Runtime:** ${totalTime}ms\n`);

  return lines.join("");
}

main().catch(err => {
  console.error("❌ Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
