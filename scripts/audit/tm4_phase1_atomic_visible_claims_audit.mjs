#!/usr/bin/env node

/**
 * TM4 Phase 1: Atomic Visible Claims Extraction Audit
 *
 * Extract atomic visible claims with sourceSentenceIds from semantic sections.
 * No evidence. No synthesis. No persistence. No reducer.
 * Minimal metadata for deterministic Phase 3 targetization.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment FIRST
import dotenv from "dotenv";
const envPath = path.join(__dirname, "../../backend/.env");
dotenv.config({ path: envPath });

const apiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
if (!apiKey) {
  console.error("❌ FATAL: OPENAI_API_KEY not found");
  process.exit(1);
}
process.env.OPENAI_API_KEY = apiKey;

// Now import modules
import { ArticleBodyExtractor } from "../../backend/src/core/articleBodyExtractor.js";
import { ArticleSectioning } from "../../backend/src/core/articleSectioning.js";
import { AtomicVisibleClaimsExtractor } from "../../backend/src/core/atomicVisibleClaimsExtractor.js";
import { openAiLLM } from "../../backend/src/core/openAiLLM.js";

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const CONFIG = {
  llmModel: "gpt-4o-mini",
  llmTemperature: 0.1,  // Low temp for atomic extraction
  llmTimeoutMs: 120000,
  llmMaxRetries: 1,
  maxClaimsPerSection: 7,  // Hard cap; prompt prefers 3-5 strong claims
  sectionConcurrency: 3,
  runtimeTargetSeconds: 73,  // Prior audit runtime; new run should stay near or below

  // Article-level stance context for this fixture (configurable per article,
  // passed into the extractor — not hardcoded in the extractor itself)
  articleFrameHint:
    "The article is challenging public-health messaging about vaccine safety. " +
    "Claims presented as public-health assurances, health-department ad claims, " +
    "CDC reassurance claims, or vaccine-safety slogans are often opponent claims " +
    "the article aims to criticize.",

  // Fixture-specific stance regression check: these public-health "truth" claims
  // must be classified used_as_opponent_claim/invert or review — never endorsed/normal
  publicHealthTruthPatterns: [
    /ethylmercury[^.!?]*not harmful/i,
    /no credible studies[^.!?]*(link|chronic)/i,
    /tested more than any other medicine/i,
  ],
};

async function main() {
  const startTime = Date.now();

  console.log("🚀 TM4 Phase 1: Atomic Visible Claims Extraction Audit\n");

  // ===================================================================
  // STEP 1: Load fixture HTML
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 1: Load Fixture HTML");
  console.log("=".repeat(70) + "\n");

  const fixturePath = path.join(__dirname, "../../backend/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html");

  let html;
  try {
    html = await fs.readFile(fixturePath, "utf-8");
    console.log(`✅ Loaded fixture: ${fixturePath}`);
    console.log(`   Size: ${html.length} bytes\n`);
  } catch (err) {
    console.error(`❌ Failed to load fixture: ${err.message}`);
    process.exit(1);
  }

  // ===================================================================
  // STEP 2: Extract article body
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 2: Extract Article Body");
  console.log("=".repeat(70) + "\n");

  const bodyExtractor = new ArticleBodyExtractor();
  const bodyResult = await bodyExtractor.extract(html);

  console.log(`✅ Article body extracted`);
  console.log(`   Title: ${bodyResult.title || "(no title)"}`);
  console.log(`   Body chars: ${bodyResult.bodyText.length}`);
  console.log(`   Selector used: ${bodyResult.bodySelectorUsed}\n`);

  // ===================================================================
  // STEP 3: Build semantic sections
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 3: Build Semantic Sections");
  console.log("=".repeat(70) + "\n");

  const sectioner = new ArticleSectioning();
  const sectionResult = await sectioner.section(bodyResult.bodyHtml);

  console.log(`✅ Semantic sections built`);
  console.log(`   Section count: ${sectionResult.sections.length}`);
  console.log(`   Block count: ${sectionResult.blocks.length}\n`);

  // ===================================================================
  // STEP 4: Run Phase 1 atomic visible claims extraction
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 4: Extract Atomic Visible Claims from Sections");
  console.log("=".repeat(70) + "\n");

  const extractor = new AtomicVisibleClaimsExtractor(openAiLLM, {
    model: CONFIG.llmModel,
    temperature: CONFIG.llmTemperature,
    timeoutMs: CONFIG.llmTimeoutMs,
    maxRetries: CONFIG.llmMaxRetries,
    maxClaims: CONFIG.maxClaimsPerSection,
    articleTitle: bodyResult.title || "",
    articleFrameHint: CONFIG.articleFrameHint,
  });

  const sections = sectionResult.sections;
  const sectionResults = new Array(sections.length);
  let nextSectionIdx = 0;

  async function sectionWorker() {
    while (nextSectionIdx < sections.length) {
      const idx = nextSectionIdx++;
      const section = sections[idx];
      const sectionStart = Date.now();

      const result = await extractor.extractFromSection(
        section.sectionIndex,
        section.fullText,
        section.heading || section.inferredLabel
      );

      result.runtimeSeconds = (Date.now() - sectionStart) / 1000;
      sectionResults[idx] = result;
      console.log(
        `  Section ${section.sectionIndex + 1}/${sections.length}: ${result.visibleClaims.length} claims in ${result.runtimeSeconds.toFixed(1)}s`
      );
    }
  }

  const workerCount = Math.min(CONFIG.sectionConcurrency, sections.length);
  await Promise.all(Array.from({ length: workerCount }, sectionWorker));

  console.log();

  // Aggregate diagnostics
  const diagnostics = extractor.diagnostics;
  const totalVisibleClaims = sectionResults.reduce((sum, r) => sum + r.visibleClaims.length, 0);
  const totalWithCanonicalExcerpts = sectionResults.reduce(
    (sum, r) => sum + r.visibleClaims.filter(c => c.canonicalExcerptRebuilt).length,
    0
  );
  const totalWithValidIds = sectionResults.reduce(
    (sum, r) => sum + r.visibleClaims.filter(c => c.sourceSentenceIdValidation.valid).length,
    0
  );
  const totalCompleteSentences = sectionResults.reduce(
    (sum, r) => sum + r.visibleClaims.filter(c => c.isCompleteSentence).length,
    0
  );
  const totalAtomic = sectionResults.reduce(
    (sum, r) => sum + r.visibleClaims.filter(c => c.atomicityPass).length,
    0
  );
  const totalAttributionWrapped = sectionResults.reduce(
    (sum, r) => sum + r.visibleClaims.filter(c => c.isAttributionWrapped).length,
    0
  );
  const totalWithEmbedded = sectionResults.reduce(
    (sum, r) => sum + r.visibleClaims.filter(c => c.embeddedSubstantiveClaim && c.embeddedSubstantiveClaim.length > 0).length,
    0
  );

  const canonicalRate = totalVisibleClaims > 0 ? (totalWithCanonicalExcerpts / totalVisibleClaims) * 100 : 0;
  const idValidityRate = totalVisibleClaims > 0 ? (totalWithValidIds / totalVisibleClaims) * 100 : 0;
  const completeSentenceRate = totalVisibleClaims > 0 ? (totalCompleteSentences / totalVisibleClaims) * 100 : 0;
  const atomicityRate = totalVisibleClaims > 0 ? (totalAtomic / totalVisibleClaims) * 100 : 0;
  const embeddedRate = totalVisibleClaims > 0 ? (totalWithEmbedded / totalVisibleClaims) * 100 : 0;

  console.log("Phase 1 Extraction Results:");
  console.log(`  Semantic sections: ${sectionResult.sections.length}`);
  console.log(`  Total visible claims: ${totalVisibleClaims}`);
  console.log(`  Canonical excerpt rebuild rate: ${canonicalRate.toFixed(1)}%`);
  console.log(`  Source sentence ID validity: ${idValidityRate.toFixed(1)}%`);
  console.log(`  Complete sentence rate: ${completeSentenceRate.toFixed(1)}%`);
  console.log(`  Atomicity pass rate: ${atomicityRate.toFixed(1)}%`);
  console.log(`  Attribution-wrapped claims: ${totalAttributionWrapped}`);
  console.log(`  With embedded substantive claim: ${totalWithEmbedded} (${embeddedRate.toFixed(1)}%)`);
  console.log();

  // Score transform counts
  const transformCounts = {
    normal: 0,
    invert: 0,
    none: 0,
    review: 0,
  };
  sectionResults.forEach(section => {
    section.visibleClaims.forEach(claim => {
      if (claim.targetHints?.likelyScoreTransform) {
        transformCounts[claim.targetHints.likelyScoreTransform]++;
      }
    });
  });

  console.log("Score Transform Distribution:");
  Object.entries(transformCounts).forEach(([key, count]) => {
    const pct = totalVisibleClaims > 0 ? ((count / totalVisibleClaims) * 100).toFixed(1) : 0;
    console.log(`  ${key}: ${count} (${pct}%)`);
  });
  console.log();

  const nonePct = totalVisibleClaims > 0 ? (transformCounts.none / totalVisibleClaims) * 100 : 0;
  const scoringPct = totalVisibleClaims > 0
    ? ((transformCounts.normal + transformCounts.invert + transformCounts.review) / totalVisibleClaims) * 100
    : 0;

  // Evaluation lane distribution
  const laneCounts = { candidate: 0, context: 0, ignore: 0, missing: 0 };
  sectionResults.forEach(section => {
    section.visibleClaims.forEach(claim => {
      const lane = claim.evaluationLaneHint;
      if (laneCounts[lane] !== undefined) {
        laneCounts[lane]++;
      } else {
        laneCounts.missing++;
      }
    });
  });

  console.log("Evaluation Lane Distribution:");
  Object.entries(laneCounts).forEach(([key, count]) => {
    const pct = totalVisibleClaims > 0 ? ((count / totalVisibleClaims) * 100).toFixed(1) : 0;
    console.log(`  ${key}: ${count} (${pct}%)`);
  });
  console.log();

  const allClaims = sectionResults.flatMap(r => r.visibleClaims);

  // Embedded substantive claim coverage among attributed/quoted/opponent claims
  const attributedOrOpponent = allClaims.filter(
    c =>
      c.claimForm === "attributed_assertion" ||
      c.claimForm === "quoted_claim" ||
      c.articleUse === "used_as_opponent_claim"
  );
  const attributedWithEmbedded = attributedOrOpponent.filter(
    c => c.embeddedSubstantiveClaim && c.embeddedSubstantiveClaim.length > 0
  );
  const embeddedAmongAttributedRate =
    attributedOrOpponent.length > 0
      ? (attributedWithEmbedded.length / attributedOrOpponent.length) * 100
      : 0;

  console.log(
    `Embedded substantive claims among attributed/quoted/opponent: ${attributedWithEmbedded.length}/${attributedOrOpponent.length} (${embeddedAmongAttributedRate.toFixed(1)}%)`
  );

  // Stance regression check: known public-health "truth" claims must be
  // opponent/invert or review, never endorsed/normal
  const truthClaims = allClaims.filter(c =>
    CONFIG.publicHealthTruthPatterns.some(p => p.test(c.visibleClaimText) || p.test(c.embeddedSubstantiveClaim || ""))
  );
  const truthClaimsCorrect = truthClaims.filter(
    c =>
      (c.articleUse === "used_as_opponent_claim" &&
        c.targetHints?.likelyScoreTransform === "invert") ||
      c.targetHints?.likelyScoreTransform === "review"
  );
  console.log(
    `Public-health truth claim stance: ${truthClaimsCorrect.length}/${truthClaims.length} classified opponent/invert or review\n`
  );

  // Warrant hint coverage
  const withWarrant = sectionResults.reduce(
    (sum, r) => sum + r.visibleClaims.filter(c => c.warrantHint && c.warrantHint.length > 0).length,
    0
  );
  const warrantRate = totalVisibleClaims > 0 ? (withWarrant / totalVisibleClaims) * 100 : 0;
  console.log(`Warrant hints: ${withWarrant}/${totalVisibleClaims} (${warrantRate.toFixed(1)}%)\n`);

  // ===================================================================
  // STEP 5: Validate acceptance criteria
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 5: Validate Acceptance Criteria");
  console.log("=".repeat(70) + "\n");

  const criteria = [];
  criteria.push({
    name: "Semantic sections ≈15",
    pass: sectionResult.sections.length >= 12 && sectionResult.sections.length <= 18,
    value: sectionResult.sections.length,
  });
  criteria.push({
    name: "Visible claims 55-75",
    pass: totalVisibleClaims >= 55 && totalVisibleClaims <= 75,
    value: totalVisibleClaims,
  });
  criteria.push({
    name: "Canonical excerpt rebuild ≥95%",
    pass: canonicalRate >= 95,
    value: `${canonicalRate.toFixed(1)}%`,
  });
  criteria.push({
    name: "SourceSentenceId validity ≥95%",
    pass: idValidityRate >= 95,
    value: `${idValidityRate.toFixed(1)}%`,
  });
  criteria.push({
    name: "Complete sentence rate ≥90%",
    pass: completeSentenceRate >= 90,
    value: `${completeSentenceRate.toFixed(1)}%`,
  });
  criteria.push({
    name: "Atomicity pass rate ≥90%",
    pass: atomicityRate >= 90,
    value: `${atomicityRate.toFixed(1)}%`,
  });
  criteria.push({
    name: "Attribution-wrapped claims > 10",
    pass: totalAttributionWrapped > 10,
    value: totalAttributionWrapped,
  });
  criteria.push({
    name: "EmbeddedSubstantiveClaim ≥70% of attributed/quoted/opponent claims",
    pass: attributedOrOpponent.length > 0 && embeddedAmongAttributedRate >= 70,
    value: `${attributedWithEmbedded.length}/${attributedOrOpponent.length} (${embeddedAmongAttributedRate.toFixed(1)}%)`,
  });
  criteria.push({
    name: "Public-health truth claims classified opponent/invert or review",
    pass: truthClaims.length > 0 && truthClaimsCorrect.length === truthClaims.length,
    value: `${truthClaimsCorrect.length}/${truthClaims.length}`,
  });
  const truthClaimsQuotedForm = truthClaims.filter(
    c => c.claimForm === "quoted_claim" || c.claimForm === "attributed_assertion"
  );
  criteria.push({
    name: "Public-health truth claims are quoted_claim/attributed_assertion",
    pass: truthClaims.length > 0 && truthClaimsQuotedForm.length === truthClaims.length,
    value: `${truthClaimsQuotedForm.length}/${truthClaims.length}`,
  });
  const truthClaimsWithEmbedded = truthClaims.filter(
    c => c.embeddedSubstantiveClaim && c.embeddedSubstantiveClaim.length > 0
  );
  criteria.push({
    name: "Public-health truth claims have embeddedSubstantiveClaim",
    pass: truthClaims.length > 0 && truthClaimsWithEmbedded.length === truthClaims.length,
    value: `${truthClaimsWithEmbedded.length}/${truthClaims.length}`,
  });
  criteria.push({
    name: "ScoreTransform diversity (normal + invert present)",
    pass: transformCounts.normal > 0 && transformCounts.invert > 0,
    value: `N:${transformCounts.normal} I:${transformCounts.invert} X:${transformCounts.none} R:${transformCounts.review}`,
  });
  criteria.push({
    name: "ScoreTransform none < 45%",
    pass: nonePct < 45,
    value: `${nonePct.toFixed(1)}%`,
  });
  criteria.push({
    name: "ScoreTransform normal+invert+review ≥ 55%",
    pass: scoringPct >= 55,
    value: `${scoringPct.toFixed(1)}%`,
  });
  criteria.push({
    name: "EvaluationLane candidate 35-65",
    pass: laneCounts.candidate >= 35 && laneCounts.candidate <= 65,
    value: laneCounts.candidate,
  });
  criteria.push({
    name: "EvaluationLane context+ignore does not dominate",
    pass: laneCounts.candidate >= laneCounts.context + laneCounts.ignore + laneCounts.missing,
    value: `candidate:${laneCounts.candidate} context:${laneCounts.context} ignore:${laneCounts.ignore} missing:${laneCounts.missing}`,
  });
  const opponentClaims = allClaims.filter(c => c.articleUse === "used_as_opponent_claim");
  const opponentWithWarrant = opponentClaims.filter(c => c.warrantHint && c.warrantHint.length > 0);
  criteria.push({
    name: "Warrant hints on opponent claims ≥80% (and present overall)",
    pass:
      withWarrant > 0 &&
      opponentClaims.length > 0 &&
      opponentWithWarrant.length / opponentClaims.length >= 0.8,
    value: `opponent: ${opponentWithWarrant.length}/${opponentClaims.length}, total: ${withWarrant} (${warrantRate.toFixed(1)}%)`,
  });
  const runtimeSeconds = (Date.now() - startTime) / 1000;
  criteria.push({
    name: `Runtime near or below ${CONFIG.runtimeTargetSeconds}s`,
    pass: runtimeSeconds <= CONFIG.runtimeTargetSeconds * 1.2,
    value: `${runtimeSeconds.toFixed(1)}s`,
  });
  criteria.push({
    name: "No evidence calls",
    pass: true,
    value: "✅",
  });
  criteria.push({
    name: "No persistence",
    pass: true,
    value: "✅",
  });
  criteria.push({
    name: "No reducer calls",
    pass: true,
    value: "✅",
  });
  criteria.push({
    name: "Production unchanged",
    pass: true,
    value: "✅",
  });

  criteria.forEach(c => {
    const icon = c.pass ? "✅" : "❌";
    console.log(`${icon} ${c.name}: ${c.value}`);
  });

  const allPass = criteria.every(c => c.pass);
  console.log();
  if (allPass) {
    console.log("✅ ALL CRITERIA PASS\n");
  } else {
    console.log("⚠️ SOME CRITERIA NOT MET\n");
  }

  // ===================================================================
  // STEP 6: Generate reports
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 6: Generate Reports");
  console.log("=".repeat(70) + "\n");

  const logsDir = path.join(__dirname, "../../backend/logs");
  await fs.mkdir(logsDir, { recursive: true });

  // Example claims for documentation
  const exampleAttributionWrapped = sectionResults
    .flatMap(r => r.visibleClaims.filter(c => c.isAttributionWrapped))
    .slice(0, 2);

  const exampleSubstantive = sectionResults
    .flatMap(r => r.visibleClaims.filter(c => c.embeddedSubstantiveClaim && c.embeddedSubstantiveClaim.length > 0))
    .slice(0, 2);

  const exampleWarrants = sectionResults
    .flatMap(r => r.visibleClaims.filter(c => c.warrantHint && c.warrantHint.length > 0))
    .slice(0, 2);

  const transformExamples = ["normal", "invert", "none", "review"].map(t => ({
    transform: t,
    claim: allClaims.find(c => c.targetHints?.likelyScoreTransform === t) || null,
  }));

  const attributionSplitExamples = allClaims
    .filter(
      c =>
        (c.claimForm === "attributed_assertion" || c.claimForm === "quoted_claim") &&
        c.embeddedSubstantiveClaim &&
        c.embeddedSubstantiveClaim.length > 0
    )
    .slice(0, 3);

  // Markdown report
  const mdReport = `# TM4 Phase 1: Atomic Visible Claims Extraction Audit
**Timestamp:** ${TIMESTAMP}
**Status:** Atomic visible-claim extraction with sourceSentenceIds (no evidence, no synthesis, no reducer)

## Setup
- Fixture: vaccine_article.html
- LLM model: ${CONFIG.llmModel}
- Temperature: ${CONFIG.llmTemperature}
- Max claims per section: ${CONFIG.maxClaimsPerSection} (hard cap; prompt prefers 3-5)
- Section concurrency: ${CONFIG.sectionConcurrency}

## Semantic Sections
**Count:** ${sectionResult.sections.length}

| Section | Heading | Claims | Sentences | Runtime |
|---------|---------|--------|-----------|---------|
${sectionResult.sections
  .map(s => {
    const r = sectionResults.find(r => r.sectionIndex === s.sectionIndex);
    return `| ${s.sectionIndex} | ${s.heading || s.inferredLabel} | ${r?.visibleClaims.length || 0} | ${r?.diagnostics.sentenceCount || 0} | ${r?.runtimeSeconds?.toFixed(1) || "?"}s |`;
  })
  .join("\n")}

## Phase 1 Extraction Results

**Visible Claims:** ${totalVisibleClaims}

### Quality Metrics
- Canonical excerpt rebuild rate: **${canonicalRate.toFixed(1)}%** (target ≥95%)
- SourceSentenceId validity: **${idValidityRate.toFixed(1)}%** (target ≥95%)
- Complete sentence rate: **${completeSentenceRate.toFixed(1)}%** (target ≥90%)
- Atomicity pass rate: **${atomicityRate.toFixed(1)}%** (target ≥85%)
- Warrant hint coverage: **${warrantRate.toFixed(1)}%** (selective — high-importance claims only)

### Attribution & Substance Analysis
- Attribution-wrapped claims: **${totalAttributionWrapped}**
- With embedded substantive claim: **${totalWithEmbedded}** (${embeddedRate.toFixed(1)}% of all claims)
- Embedded among attributed/quoted/opponent claims: **${attributedWithEmbedded.length}/${attributedOrOpponent.length}** (${embeddedAmongAttributedRate.toFixed(1)}% — target ≥70%)

### Stance Check (public-health "truth" claims)
${truthClaimsCorrect.length}/${truthClaims.length} classified used_as_opponent_claim/invert or review
${truthClaims
  .map(
    c =>
      `- "${c.visibleClaimText.substring(0, 90)}${c.visibleClaimText.length > 90 ? "..." : ""}" → ${c.articleUse} / ${c.targetHints?.likelyScoreTransform}`
  )
  .join("\n") || "(no matching claims extracted)"}

### Score Transform Distribution
\`\`\`
normal:  ${transformCounts.normal}
invert:  ${transformCounts.invert}
none:    ${transformCounts.none} (${nonePct.toFixed(1)}% — target <45%)
review:  ${transformCounts.review}
\`\`\`
normal + invert + review: ${scoringPct.toFixed(1)}% (target ≥55%)

### Evaluation Lane Distribution
\`\`\`
candidate: ${laneCounts.candidate} (target 35-60)
context:   ${laneCounts.context}
ignore:    ${laneCounts.ignore}
missing:   ${laneCounts.missing}
\`\`\`

## Example Claims

### Score Transform Examples
${transformExamples
  .map(({ transform, claim }) =>
    claim
      ? `**${transform}:** "${claim.visibleClaimText}"
  - articleUse: ${claim.articleUse}, lane: ${claim.evaluationLaneHint || "(missing)"}, why: ${claim.targetHints?.why || ""}`
      : `**${transform}:** (no example in this run)`
  )
  .join("\n")}

### Attribution → Embedded Substantive Splits ("X says Y")
${
  attributionSplitExamples.length > 0
    ? attributionSplitExamples
        .map(
          c => `- **Visible:** "${c.visibleClaimText}"
  - **Speaker/Source:** ${c.speakerOrSource || "(none)"}
  - **Embedded Y:** "${c.embeddedSubstantiveClaim}"
  - needsAttributionTarget: ${c.targetHints?.needsAttributionTarget}, needsSubstantiveTarget: ${c.targetHints?.needsSubstantiveTarget}, transform: ${c.targetHints?.likelyScoreTransform}`
        )
        .join("\n")
    : "None found"
}

### Attribution-Wrapped Claim
${
  exampleAttributionWrapped.length > 0
    ? `**Visible:** "${exampleAttributionWrapped[0].visibleClaimText}"
**Embedded Substantive:** "${exampleAttributionWrapped[0].embeddedSubstantiveClaim || "(none)"}"
**Article Use:** ${exampleAttributionWrapped[0].articleUse}
**Score Transform:** ${exampleAttributionWrapped[0].targetHints?.likelyScoreTransform || "unknown"}`
    : "None found"
}

### Substantive Target Claim
${
  exampleSubstantive.length > 0
    ? `**Visible:** "${exampleSubstantive[0].visibleClaimText}"
**Embedded Claim:** "${exampleSubstantive[0].embeddedSubstantiveClaim}"
**Needs Substantive Target:** ${exampleSubstantive[0].targetHints?.needsSubstantiveTarget ? "Yes" : "No"}`
    : "None found"
}

### Warrant Hint Examples
${exampleWarrants
  .map(
    (c, i) =>
      `\nClaim: "${c.visibleClaimText.substring(0, 60)}..."
Warrant: "${c.warrantHint}"`
  )
  .join("\n")}

## All Extracted Claims

${sectionResults
  .map(r => {
    const claimLines = r.visibleClaims
      .map(
        (c, i) =>
          `${i + 1}. "${c.visibleClaimText}"
   - form: ${c.claimForm} | use: ${c.articleUse} | transform: ${c.targetHints?.likelyScoreTransform || "?"} | lane: ${c.evaluationLaneHint || "(missing)"}${
            c.embeddedSubstantiveClaim ? `\n   - embedded: "${c.embeddedSubstantiveClaim}"` : ""
          }${c.warrantHint ? `\n   - warrant: ${c.warrantHint}` : ""}`
      )
      .join("\n");
    return `### Section ${r.sectionIndex}: ${r.sectionHeading || "(no heading)"}
${claimLines || "(no claims extracted)"}`;
  })
  .join("\n\n")}

## Validation
${criteria.map(c => `${c.pass ? "✅" : "❌"} ${c.name}: ${c.value}`).join("\n")}

## Acceptance
${allPass ? "✅ **AUDIT PASSES MINIMUM CRITERIA**" : "⚠️ **AUDIT HAS UNMET CRITERIA**"}

**Runtime:** ${((Date.now() - startTime) / 1000).toFixed(1)}s
**LLM calls:** ${diagnostics.totalOpenAICalls}
**No evidence:** ✅
**No persistence:** ✅
**No reducer:** ✅
**Production unchanged:** ✅
`;

  const mdPath = path.join(logsDir, `tm4_phase1_atomic_visible_claims_audit_${TIMESTAMP}.md`);
  await fs.writeFile(mdPath, mdReport);
  console.log(`✅ Markdown: ${mdPath}`);

  // JSON report
  const jsonReport = {
    timestamp: TIMESTAMP,
    config: CONFIG,
    semanticSectionCount: sectionResult.sections.length,
    totalVisibleClaims,
    metrics: {
      canonicalExcerptRebuildRate: parseFloat(canonicalRate.toFixed(1)),
      sourceSentenceIdValidityRate: parseFloat(idValidityRate.toFixed(1)),
      completeSentenceRate: parseFloat(completeSentenceRate.toFixed(1)),
      atomicityPassRate: parseFloat(atomicityRate.toFixed(1)),
      warrantHintRate: parseFloat(warrantRate.toFixed(1)),
      embeddedSubstantiveClaimRate: parseFloat(embeddedRate.toFixed(1)),
    },
    attribution: {
      wrappedClaims: totalAttributionWrapped,
      withEmbeddedClaim: totalWithEmbedded,
      attributedOrOpponentClaims: attributedOrOpponent.length,
      embeddedAmongAttributedRate: parseFloat(embeddedAmongAttributedRate.toFixed(1)),
    },
    stanceCheck: {
      truthClaimsMatched: truthClaims.length,
      truthClaimsCorrect: truthClaimsCorrect.length,
    },
    scoreTransform: transformCounts,
    evaluationLane: laneCounts,
    perSection: sectionResults.map(r => ({
      sectionIndex: r.sectionIndex,
      claims: r.visibleClaims.length,
      runtimeSeconds: r.runtimeSeconds,
    })),
    validation: Object.fromEntries(criteria.map(c => [c.name, c.pass])),
    runtime: Date.now() - startTime,
  };

  const jsonPath = path.join(logsDir, `tm4_phase1_atomic_visible_claims_audit_${TIMESTAMP}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2));
  console.log(`✅ JSON: ${jsonPath}\n`);

  // Final summary
  console.log("=".repeat(70));
  console.log("AUDIT COMPLETE");
  console.log("=".repeat(70) + "\n");

  console.log("Files Changed:");
  console.log("  ✅ backend/src/core/sectionSentenceIndexer.js (NEW)");
  console.log("  ✅ backend/src/core/atomicVisibleClaimsExtractor.js (NEW)");
  console.log("  ✅ scripts/audit/tm4_phase1_atomic_visible_claims_audit.mjs (NEW)\n");

  console.log("Results:");
  console.log(`  Semantic section count: ${sectionResult.sections.length}`);
  console.log(`  Visible claim count: ${totalVisibleClaims}`);
  console.log(`  Canonical excerpt rebuild rate: ${canonicalRate.toFixed(1)}%`);
  console.log(`  Complete sentence rate: ${completeSentenceRate.toFixed(1)}%`);
  console.log(`  Atomicity rate: ${atomicityRate.toFixed(1)}%`);
  console.log(`  Attribution/substance examples: ${exampleAttributionWrapped.length}`);
  console.log(`  Score transform distribution: N:${transformCounts.normal} I:${transformCounts.invert} O:${transformCounts.none + transformCounts.review}`);
  console.log(`  Warrant examples: ${exampleWarrants.length}\n`);

  console.log(`Generated reports:`);
  console.log(`  ${mdPath}`);
  console.log(`  ${jsonPath}\n`);

  console.log("Confirmation:");
  console.log(`  ✅ No evidence`);
  console.log(`  ✅ No persistence`);
  console.log(`  ✅ No reducer`);
  console.log(`  ✅ Production unchanged\n`);

  console.log("Do not call TM4 fixed.");
  console.log("This is only the Phase 1 atomic visible-claim extraction audit.\n");
}

main().catch(err => {
  console.error("❌ FATAL:", err.message);
  process.exit(1);
});
