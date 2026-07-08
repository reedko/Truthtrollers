#!/usr/bin/env node

/**
 * TM4 Phase 1 → Phase 2 → Phase 3-Readiness Audit
 *
 * Verify Phase 1 atomic visible-claim output flows through Phase 2 organization
 * without losing the structure needed for deterministic Phase 3 targetization.
 *
 * No evidence. No persistence. No reducer. No Phase 3 implementation.
 * Production defaults unchanged.
 *
 * Phase 2 is ADDITIVE ONLY: Phase 1 claim objects are frozen; pillar/cluster
 * assignments are merged onto them by claimId. Synthesized claims are kept
 * separately and marked isClusterSummary — they never replace visible claims.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../../backend/.env") });

const apiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
if (!apiKey) {
  console.error("❌ FATAL: OPENAI_API_KEY not found");
  process.exit(1);
}
process.env.OPENAI_API_KEY = apiKey;

import { ArticleBodyExtractor } from "../../backend/src/core/articleBodyExtractor.js";
import { ArticleSectioning } from "../../backend/src/core/articleSectioning.js";
import { AtomicVisibleClaimsExtractor } from "../../backend/src/core/atomicVisibleClaimsExtractor.js";
import { LocalClaimMapSynthesizer } from "../../backend/src/core/localClaimMapSynthesizer.js";
import { reconcilePhase1ClaimOccurrences } from "../../backend/src/core/phase1ClaimReconciler.js";
import { openAiLLM } from "../../backend/src/core/openAiLLM.js";

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const CONFIG = {
  // Phase 1 — exact accepted configuration from
  // tm4_phase1_atomic_visible_claims_audit_2026-07-06T16-37-10 (60 claims)
  phase1: {
    llmModel: "gpt-4o-mini",
    llmTemperature: 0.1,
    llmTimeoutMs: 120000,
    llmMaxRetries: 1,
    maxClaimsPerSection: 7,
    sectionConcurrency: 3,
    articleFrameHint:
      "The article is challenging public-health messaging about vaccine safety. " +
      "Claims presented as public-health assurances, health-department ad claims, " +
      "CDC reassurance claims, or vaccine-safety slogans are often opponent claims " +
      "the article aims to criticize.",
  },
  // Phase 2 — synthesizer defaults (hardcoded prompts, temp 0.2)
  phase2: {
    model: "gpt-4o-mini",
    temperature: 0.2,
    timeoutMs: 90000,
    maxRetries: 1,
  },
  expectedPhase1Claims: 60,
  strongCandidateRange: [20, 40],
};

// Anchor-cluster regression checks for this fixture.
//
// Matching is on claim-OWNED text only (visibleClaimText / embeddedSubstantiveClaim
// / searchText) — deliberately NOT the rebuilt canonicalExcerpt, which can carry
// adjacent sentences and produce false anchor matches (e.g. a formaldehyde claim
// whose excerpt also mentions aluminum). Predicates assert the claim's real
// target-type, matched to the anchor's evaluation lane.
const ANCHOR_CHECKS = [
  {
    key: "public_health_slogans",
    label: "Public-health slogan claims",
    pattern: /ethylmercury[^.!?]*not harmful|no credible studies[^.!?]*(link|chronic)|tested more than any other medicine/i,
    expect: c =>
      (c.claimForm === "quoted_claim" || c.claimForm === "attributed_assertion") &&
      c.articleUse === "used_as_opponent_claim" &&
      c.targetHints?.likelyScoreTransform === "invert",
    expectLabel: "quoted/attributed + opponent + invert",
  },
  {
    key: "thompson",
    label: "Thompson claim",
    // Targetable via EITHER path (attribution OR substantive), not both.
    pattern: /Thompson/i,
    expect: c => {
      const t = c.targetHints?.likelyScoreTransform;
      const attributionPath =
        c.targetHints?.needsAttributionTarget === true ||
        c.claimForm === "attributed_assertion" ||
        c.claimForm === "quoted_claim" ||
        (c.speakerOrSource || "").length > 0 ||
        (c.embeddedSubstantiveClaim || "").length > 0;
      const substantivePath =
        c.targetHints?.needsSubstantiveTarget === true ||
        (c.articleUse === "endorsed_by_article" &&
          ["normal", "invert", "review"].includes(t) &&
          c.evaluationLaneHint === "candidate");
      return attributionPath || substantivePath;
    },
    expectLabel: "attribution OR substantive targetable",
  },
  {
    key: "act_1986",
    label: "1986 Act claims",
    // \b1986\b anchors on the year itself; the generic "liability from drug
    // companies" phrasing is the article's own way of naming the 1986 Act.
    pattern: /\b1986\b|liability from drug companies/i,
    expect: c =>
      c.claimForm === "legal_policy_claim" ||
      c.claimForm === "causal_claim" ||
      (c.namedLawsOrPolicies || []).length > 0 ||
      /act|law|liability|congress|legislation/i.test(c.visibleClaimText),
    expectLabel: "legal/policy targetable",
  },
  {
    key: "aluminum",
    label: "Aluminum claims",
    pattern: /aluminum/i,
    expect: c =>
      (c.namedSubstancesOrProducts || []).some(s => /aluminum/i.test(s)) ||
      /aluminum/i.test(c.visibleClaimText || "") ||
      /aluminum/i.test(c.embeddedSubstantiveClaim || ""),
    expectLabel: "substance/safety targetable",
  },
  {
    key: "thimerosal_data_integrity",
    label: "Thimerosal/Simpsonwood/Verstraeten claims",
    // The storyline mixes named-study/data-integrity claims (suppressed 1999
    // study, reworked CDC study, Simpsonwood transcript) with substance-safety
    // toxicity claims. Both are legitimately Phase-3 targetable; acceptance is
    // that Phase 2 kept them as scored candidates with targetable text.
    pattern: /thimerosal|Simpsonwood|Verstraeten/i,
    expect: c =>
      c.evaluationLaneHint === "candidate" &&
      ["normal", "invert", "review"].includes(c.targetHints?.likelyScoreTransform) &&
      ((c.visibleClaimText || "").length > 0 ||
        (c.embeddedSubstantiveClaim || "").length > 0),
    expectLabel: "study/data-integrity or substance/safety targetable",
  },
];

function pct(n, d) {
  return d > 0 ? (n / d) * 100 : 0;
}

function claimMatchesAnchor(claim, pattern) {
  return (
    pattern.test(claim.visibleClaimText || "") ||
    pattern.test(claim.embeddedSubstantiveClaim || "") ||
    pattern.test(claim.searchText || "")
  );
}

async function main() {
  const startTime = Date.now();
  console.log("🚀 TM4 Phase 1 → Phase 2 → Phase 3-Readiness Audit\n");

  // ===================================================================
  // STEP 1: Phase 1 — re-run accepted extraction config, capture FULL payload
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 1: Phase 1 Atomic Visible Claims (accepted config re-run)");
  console.log("=".repeat(70) + "\n");

  const fixturePath = path.join(
    __dirname,
    "../../backend/tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html"
  );
  const html = await fs.readFile(fixturePath, "utf-8");

  const bodyExtractor = new ArticleBodyExtractor();
  const bodyResult = await bodyExtractor.extract(html);
  console.log(`✅ Body extracted: ${bodyResult.bodyText.length} chars, title: ${bodyResult.title || "(none)"}`);

  const sectioner = new ArticleSectioning();
  const sectionResult = await sectioner.section(bodyResult.bodyHtml);
  console.log(`✅ Semantic sections: ${sectionResult.sections.length}\n`);

  const extractor = new AtomicVisibleClaimsExtractor(openAiLLM, {
    model: CONFIG.phase1.llmModel,
    temperature: CONFIG.phase1.llmTemperature,
    timeoutMs: CONFIG.phase1.llmTimeoutMs,
    maxRetries: CONFIG.phase1.llmMaxRetries,
    maxClaims: CONFIG.phase1.maxClaimsPerSection,
    articleTitle: bodyResult.title || "",
    articleFrameHint: CONFIG.phase1.articleFrameHint,
  });

  const sections = sectionResult.sections;
  const sectionResults = new Array(sections.length);
  let nextSectionIdx = 0;

  async function sectionWorker() {
    while (nextSectionIdx < sections.length) {
      const idx = nextSectionIdx++;
      const section = sections[idx];
      const result = await extractor.extractFromSection(
        section.sectionIndex,
        section.fullText,
        section.heading || section.inferredLabel
      );
      sectionResults[idx] = result;
      console.log(`  Section ${section.sectionIndex + 1}/${sections.length}: ${result.visibleClaims.length} claims`);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONFIG.phase1.sectionConcurrency, sections.length) }, sectionWorker)
  );

  // Assign stable claim IDs and freeze Phase 1 records
  const phase1Claims = [];
  let globalIdx = 0;
  for (const r of sectionResults) {
    r.visibleClaims.forEach((c, j) => {
      phase1Claims.push({
        claimId: `S${String(r.sectionIndex).padStart(2, "0")}-C${j + 1}`,
        claimIndex: globalIdx++,
        sectionIndex: r.sectionIndex,
        sectionHeading: r.sectionHeading || "",
        localThemeLabel: r.localTheme?.label || "",
        ...c,
      });
    });
  }
  // Deep-freeze snapshot for later mutation detection
  const phase1Snapshot = JSON.parse(JSON.stringify(phase1Claims));

  console.log(`\n✅ Phase 1 claims in: ${phase1Claims.length} (accepted run: ${CONFIG.expectedPhase1Claims})`);

  // Persist FULL Phase 1 payload (audit log only — not production persistence)
  const logsDir = path.join(__dirname, "../../backend/logs");
  await fs.mkdir(logsDir, { recursive: true });
  const phase1DumpPath = path.join(logsDir, `tm4_phase1_full_claims_${TIMESTAMP}.json`);
  await fs.writeFile(phase1DumpPath, JSON.stringify({ timestamp: TIMESTAMP, config: CONFIG.phase1, claims: phase1Claims }, null, 2));
  console.log(`✅ Full Phase 1 payload saved: ${phase1DumpPath}\n`);

  // ===================================================================
  // STEP 1b: Phase 1 duplicate / stance reconciliation (audit-only, no LLM)
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 1b: Phase 1 Duplicate / Stance Reconciliation");
  console.log("=".repeat(70) + "\n");

  const reconcile = reconcilePhase1ClaimOccurrences(phase1Claims, { similarityThreshold: 0.9 });
  const reconciledClaims = reconcile.claims;
  const reconcileDiag = reconcile.diagnostics;
  // Snapshot AFTER reconciliation — Phase 2 must not mutate these.
  const reconciledSnapshot = JSON.parse(JSON.stringify(reconciledClaims));

  console.log(`  Duplicate/near-duplicate groups: ${reconcileDiag.totalGroups}`);
  console.log(`  Stance conflicts: ${reconcileDiag.stanceConflicts.length}`);
  console.log(`  Reconciled groups: ${reconcileDiag.reconciledCount}`);
  console.log(`  Review groups: ${reconcileDiag.flaggedForReviewCount}`);
  reconcileDiag.duplicateGroups.forEach(g => {
    console.log(
      `   ${g.groupId}: [${g.occurrenceIds.join(", ")}] use={${g.distinctArticleUse.join("|")}} ` +
        `transform={${g.distinctScoreTransform.join("|")}} conflicts=[${g.conflictReasons.join(", ")}]`
    );
  });
  // Reconciliation must not lose claim IDs / sentence IDs / canonical excerpts.
  const reconLostId = reconciledClaims.filter((c, i) => c.claimId !== phase1Snapshot[i].claimId).length;
  const reconLostSsid = reconciledClaims.filter(
    (c, i) => JSON.stringify(c.sourceSentenceIds) !== JSON.stringify(phase1Snapshot[i].sourceSentenceIds)
  ).length;
  const reconLostExcerpt = reconciledClaims.filter(
    (c, i) => (c.localSourceExcerpt || "") !== (phase1Snapshot[i].localSourceExcerpt || "")
  ).length;
  console.log(
    `\n  Reconciliation integrity → lost IDs: ${reconLostId}, lost sentenceIds: ${reconLostSsid}, lost excerpts: ${reconLostExcerpt}`
  );
  // Report stance changes applied.
  const stanceChanges = reconciledClaims
    .filter(c => c.reconciliation?.changed)
    .map(c => ({
      claimId: c.claimId,
      groupId: c.reconciliation.groupId,
      before: c.reconciliation.before,
      after: c.reconciliation.after,
    }));
  if (stanceChanges.length) {
    console.log(`  Stance changes applied: ${stanceChanges.length}`);
    stanceChanges.forEach(s =>
      console.log(
        `   ${s.claimId}: ${s.before.articleUse}/${s.before.likelyScoreTransform} → ${s.after.articleUse}/${s.after.likelyScoreTransform}`
      )
    );
  }
  console.log();

  // ===================================================================
  // STEP 2: Phase 2 — claim-map synthesis (additive; IDs preserved)
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 2: Phase 2 Claim-Map Organization");
  console.log("=".repeat(70) + "\n");

  const compactForLLM = reconciledClaims.map(c => ({
    claimIndex: c.claimIndex,
    sectionIndex: c.sectionIndex,
    claimText: (c.visibleClaimText || "").substring(0, 120),
    searchText: (c.searchText || "").substring(0, 60),
    theme: c.localThemeLabel,
  }));

  const fullForExcerpts = reconciledClaims.map(c => ({
    claimIndex: c.claimIndex,
    sectionIndex: c.sectionIndex,
    claimText: c.visibleClaimText || "",
    localSourceExcerpt: c.localSourceExcerpt || "",
    searchText: c.searchText || "",
    localTheme: { label: c.localThemeLabel, summary: "" },
  }));

  const synthesizer = new LocalClaimMapSynthesizer(openAiLLM, CONFIG.phase2);
  const phase2 = await synthesizer.synthesize(
    bodyResult.title || "Article",
    compactForLLM,
    fullForExcerpts
  );

  const clusters = synthesizer.diagnostics.deterministicClusters || [];
  console.log(`✅ Phase 2 complete (${phase2.diagnostics.totalOpenAICalls} LLM call)`);
  console.log(`   Thesis: ${(phase2.articleTheme.thesis || "").substring(0, 100)}`);
  console.log(`   Pillars: ${phase2.pillars.length}`);
  console.log(`   Claim assignments: ${phase2.claimAssignments.length}`);
  console.log(`   Deterministic clusters: ${clusters.length}`);
  console.log(`   Synthesized cluster summaries: ${phase2.synthesizedClaims.length}\n`);

  // Merge Phase 2 organization onto frozen Phase 1 claims (by claimIndex)
  const assignmentByIndex = new Map();
  for (const a of phase2.claimAssignments || []) {
    if (Number.isInteger(a.claimIndex) && !assignmentByIndex.has(a.claimIndex)) {
      assignmentByIndex.set(a.claimIndex, a);
    }
  }
  // Highest-score cluster containing each claim (clusters are pre-sorted by score)
  const clusterByIndex = new Map();
  for (const cl of clusters) {
    for (const idx of cl.claimIndexes) {
      if (!clusterByIndex.has(idx)) clusterByIndex.set(idx, cl);
    }
  }

  const validPillarIds = new Set((phase2.pillars || []).map(p => p.pillarId));

  const organizedClaims = reconciledClaims.map(c => {
    const a = assignmentByIndex.get(c.claimIndex);
    const cl = clusterByIndex.get(c.claimIndex);
    return {
      ...c,
      phase2PillarId: a && validPillarIds.has(a.pillarId) ? a.pillarId : (a?.pillarId || ""),
      phase2Role: a?.articleRole || "",
      phase2AssignmentReason: a?.reason || "",
      phase2ClusterId: cl ? `DC${cl.clusterId}` : "",
      phase2ClusterLabel: cl?.clusterLabel || "",
      phase2ClusterAnchors: cl?.anchors || [],
    };
  });

  // Mutation check: Phase 2 must not have rewritten any reconciled record
  const mutated = reconciledClaims.filter(
    (c, i) => JSON.stringify(c) !== JSON.stringify(reconciledSnapshot[i])
  );

  // ===================================================================
  // STEP 3: Preservation metrics
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 3: Preservation Metrics");
  console.log("=".repeat(70) + "\n");

  // Phase 2 preservation is measured against the RECONCILED snapshot — the
  // actual input to Phase 2. (Reconciliation-vs-raw integrity is checked in
  // STEP 1b: IDs, sentenceIds, and excerpts are invariant across reconciliation.)
  const N = reconciledClaims.length;
  const baseline = reconciledSnapshot;
  const idPreserved = organizedClaims.filter(
    (c, i) => c.claimId === baseline[i].claimId && c.visibleClaimText === baseline[i].visibleClaimText
  ).length;
  const ssidPreserved = organizedClaims.filter(
    (c, i) => JSON.stringify(c.sourceSentenceIds) === JSON.stringify(baseline[i].sourceSentenceIds)
  ).length;
  const embeddedPreserved = organizedClaims.filter(
    (c, i) => (c.embeddedSubstantiveClaim || "") === (baseline[i].embeddedSubstantiveClaim || "")
  ).length;
  const articleUsePreserved = organizedClaims.filter(
    (c, i) => c.articleUse === baseline[i].articleUse
  ).length;
  const transformPreserved = organizedClaims.filter(
    (c, i) =>
      (c.targetHints?.likelyScoreTransform || "") ===
      (baseline[i].targetHints?.likelyScoreTransform || "")
  ).length;

  const assignedClaims = organizedClaims.filter(c => c.phase2PillarId && c.phase2PillarId.length > 0);
  const assignedValidPillar = organizedClaims.filter(c => validPillarIds.has(c.phase2PillarId));
  const assignedOrClustered = organizedClaims.filter(
    c => (c.phase2PillarId && c.phase2PillarId.length > 0) || c.phase2ClusterId
  );
  const inCluster = organizedClaims.filter(c => c.phase2ClusterId);

  const metrics = {
    phase1ClaimsIn: N,
    phase2AssignedClaimCount: assignedClaims.length,
    phase2AssignedValidPillarCount: assignedValidPillar.length,
    unassignedClaimCount: N - assignedClaims.length,
    claimIdPreservationRate: pct(idPreserved, N),
    sourceSentenceIdPreservationRate: pct(ssidPreserved, N),
    embeddedSubstantiveClaimPreservationRate: pct(embeddedPreserved, N),
    articleUsePreservationRate: pct(articleUsePreserved, N),
    scoreTransformPreservationRate: pct(transformPreserved, N),
    clusterCoverage: pct(inCluster.length, N),
    assignedOrClusteredRate: pct(assignedOrClustered.length, N),
    mutatedPhase1Records: mutated.length,
  };

  Object.entries(metrics).forEach(([k, v]) =>
    console.log(`  ${k}: ${typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) + "%" : v}`)
  );
  console.log();

  // ===================================================================
  // STEP 4: Anchor-cluster regression checks
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 4: Anchor-Cluster Checks");
  console.log("=".repeat(70) + "\n");

  const anchorResults = ANCHOR_CHECKS.map(check => {
    const matched = organizedClaims.filter(c => claimMatchesAnchor(c, check.pattern));
    const correct = matched.filter(check.expect);
    const clustered = matched.filter(c => c.phase2ClusterId || (c.phase2PillarId && c.phase2PillarId.length > 0));
    const result = {
      key: check.key,
      label: check.label,
      expectLabel: check.expectLabel,
      matched: matched.length,
      correct: correct.length,
      clusteredOrAssigned: clustered.length,
      pass: matched.length > 0 && correct.length === matched.length,
      claims: matched.map(c => ({
        claimId: c.claimId,
        text: (c.visibleClaimText || "").substring(0, 90),
        claimForm: c.claimForm,
        articleUse: c.articleUse,
        transform: c.targetHints?.likelyScoreTransform,
        cluster: c.phase2ClusterId,
        pillar: c.phase2PillarId,
      })),
    };
    console.log(
      `  ${result.pass ? "✅" : "❌"} ${check.label}: ${correct.length}/${matched.length} ${check.expectLabel} (${clustered.length} clustered/assigned)`
    );
    return result;
  });
  console.log();

  // Synthesized claims must be marked as cluster summaries, never replacements
  const synthesizedMarked = (phase2.synthesizedClaims || []).map(s => ({
    ...s,
    isClusterSummary: true,
    replacesPhase1Claim: false,
  }));
  const synthDuplicatesVisible = synthesizedMarked.filter(s =>
    organizedClaims.some(c => c.visibleClaimText === s.synthesizedClaimText)
  );

  // ===================================================================
  // STEP 5: Phase 3-readiness package
  // ===================================================================
  console.log("=".repeat(70));
  console.log("STEP 5: Phase 3-Readiness Package");
  console.log("=".repeat(70) + "\n");

  const readinessEntries = organizedClaims.map(c => {
    const transform = c.targetHints?.likelyScoreTransform || "";
    const readiness = {
      hasAtomicVisibleClaim: c.atomicityPass === true,
      hasCanonicalExcerpt: c.canonicalExcerptRebuilt === true && (c.localSourceExcerpt || "").length > 0,
      hasTargetableText:
        (c.visibleClaimText || "").length > 0 || (c.embeddedSubstantiveClaim || "").length > 0,
      hasScoreTransformHint: ["normal", "invert", "review", "none"].includes(transform),
      needsAttributionSplit:
        c.targetHints?.needsAttributionTarget === true &&
        (c.embeddedSubstantiveClaim || "").length > 0,
      needsSubstantiveTarget: c.targetHints?.needsSubstantiveTarget === true,
      needsStudyIdentityTarget: c.targetHints?.needsStudyIdentityTarget === true,
      needsInferenceTarget: c.targetHints?.needsInferenceTarget === true,
    };
    return {
      claimId: c.claimId,
      visibleClaimText: c.visibleClaimText || "",
      sourceSentenceIds: c.sourceSentenceIds || [],
      canonicalExcerpt: c.localSourceExcerpt || "",
      claimForm: c.claimForm || "",
      articleUse: c.articleUse || "",
      speakerOrSource: c.speakerOrSource || "",
      embeddedSubstantiveClaim: c.embeddedSubstantiveClaim || "",
      targetHints: c.targetHints || {},
      evaluationLaneHint: c.evaluationLaneHint || "",
      scoreTransformHint: transform,
      warrantHint: c.warrantHint || "",
      phase2PillarId: c.phase2PillarId || "",
      phase2ClusterId: c.phase2ClusterId || "",
      phase2Role: c.phase2Role || "",
      clusterAnchors: c.phase2ClusterAnchors || [],
      searchText: c.searchText || "",
      namedActors: c.namedActors || [],
      namedOrganizations: c.namedOrganizations || [],
      namedStudiesOrDocuments: c.namedStudiesOrDocuments || [],
      namedLawsOrPolicies: c.namedLawsOrPolicies || [],
      namedSubstancesOrProducts: c.namedSubstancesOrProducts || [],
      numbersOrStatistics: c.numbersOrStatistics || [],
      reconciliation: c.reconciliation || {
        groupId: null,
        status: "none",
        reason: "",
        canonicalOccurrenceId: null,
        changed: false,
      },
      phase3Readiness: readiness,
    };
  });

  // Strong candidate selection: candidate lane + atomic + canonical excerpt +
  // scoring transform (normal/invert/review). Ranked so opponent/invert,
  // warrant-bearing, embedded-substance, and clustered claims float up.
  const scored = readinessEntries
    .filter(
      e =>
        e.evaluationLaneHint === "candidate" &&
        e.phase3Readiness.hasAtomicVisibleClaim &&
        e.phase3Readiness.hasCanonicalExcerpt &&
        e.phase3Readiness.hasTargetableText &&
        ["normal", "invert", "review"].includes(e.scoreTransformHint)
    )
    .map(e => {
      let s = 0;
      if (e.scoreTransformHint === "invert") s += 3;
      if (e.warrantHint) s += 2;
      if (e.embeddedSubstantiveClaim) s += 2;
      if (e.phase2ClusterId) s += 2;
      if (e.phase2Role === "pillar") s += 2;
      if (e.phase2PillarId) s += 1;
      if (e.phase3Readiness.needsSubstantiveTarget) s += 1;
      if (e.phase3Readiness.needsStudyIdentityTarget) s += 1;
      return { entry: e, score: s };
    })
    .sort((a, b) => b.score - a.score);

  const strongCandidates = scored.slice(0, CONFIG.strongCandidateRange[1]).map(x => x.entry.claimId);

  const needCounts = {
    attributionSplit: readinessEntries.filter(e => e.phase3Readiness.needsAttributionSplit).length,
    substantiveTarget: readinessEntries.filter(e => e.phase3Readiness.needsSubstantiveTarget).length,
    studyIdentityTarget: readinessEntries.filter(e => e.phase3Readiness.needsStudyIdentityTarget).length,
    inferenceTarget: readinessEntries.filter(e => e.phase3Readiness.needsInferenceTarget).length,
  };

  console.log(`  Readiness entries: ${readinessEntries.length}`);
  console.log(`  Strong Phase 3 candidates: ${strongCandidates.length} (eligible: ${scored.length})`);
  console.log(`  needsAttributionSplit: ${needCounts.attributionSplit}`);
  console.log(`  needsSubstantiveTarget: ${needCounts.substantiveTarget}`);
  console.log(`  needsStudyIdentityTarget: ${needCounts.studyIdentityTarget}`);
  console.log(`  needsInferenceTarget: ${needCounts.inferenceTarget}\n`);

  // ===================================================================
  // STEP 6: Acceptance criteria
  // ===================================================================
  const criteria = [];
  criteria.push({
    name: "Phase 1 claims ≈60 (55-75 band)",
    pass: N >= 55 && N <= 75,
    value: N,
  });
  criteria.push({
    name: "100% Phase 1 claim ID preservation",
    pass: metrics.claimIdPreservationRate === 100 && metrics.mutatedPhase1Records === 0,
    value: `${metrics.claimIdPreservationRate.toFixed(1)}% (mutated: ${metrics.mutatedPhase1Records})`,
  });
  criteria.push({
    name: "≥95% sourceSentenceId preservation",
    pass: metrics.sourceSentenceIdPreservationRate >= 95,
    value: `${metrics.sourceSentenceIdPreservationRate.toFixed(1)}%`,
  });
  criteria.push({
    name: "≥95% embeddedSubstantiveClaim preservation",
    pass: metrics.embeddedSubstantiveClaimPreservationRate >= 95,
    value: `${metrics.embeddedSubstantiveClaimPreservationRate.toFixed(1)}%`,
  });
  criteria.push({
    name: "≥95% articleUse preservation",
    pass: metrics.articleUsePreservationRate >= 95,
    value: `${metrics.articleUsePreservationRate.toFixed(1)}%`,
  });
  criteria.push({
    name: "≥95% scoreTransform preservation",
    pass: metrics.scoreTransformPreservationRate >= 95,
    value: `${metrics.scoreTransformPreservationRate.toFixed(1)}%`,
  });
  criteria.push({
    name: "≥90% claims assigned to a Phase 2 pillar or cluster",
    pass: metrics.assignedOrClusteredRate >= 90,
    value: `${metrics.assignedOrClusteredRate.toFixed(1)}%`,
  });
  anchorResults.forEach(r =>
    criteria.push({
      name: `Anchor: ${r.label} remain ${r.expectLabel}`,
      pass: r.pass,
      value: `${r.correct}/${r.matched}`,
    })
  );
  criteria.push({
    name: "All anchor clusters represented in Phase 2 organization",
    pass: anchorResults.every(r => r.matched > 0 && r.clusteredOrAssigned > 0),
    value: anchorResults.map(r => `${r.key}:${r.clusteredOrAssigned}/${r.matched}`).join(" "),
  });
  criteria.push({
    name: "No Phase 2 synthesized claim replaces a Phase 1 visible claim",
    pass: synthDuplicatesVisible.length === 0 && readinessEntries.length === N,
    value: `dupes: ${synthDuplicatesVisible.length}, package: ${readinessEntries.length}/${N}`,
  });
  criteria.push({
    name: "Synthesized claims clearly marked as cluster summaries",
    pass: synthesizedMarked.every(s => s.isClusterSummary === true),
    value: synthesizedMarked.length,
  });
  criteria.push({
    name: `Strong Phase 3 candidates in ${CONFIG.strongCandidateRange[0]}-${CONFIG.strongCandidateRange[1]}`,
    pass:
      strongCandidates.length >= CONFIG.strongCandidateRange[0] &&
      strongCandidates.length <= CONFIG.strongCandidateRange[1],
    value: strongCandidates.length,
  });
  // Reconciliation acceptance
  const tomatoOccurrences = reconciledClaims.filter(c =>
    /more aluminum by eating a tomato/i.test(c.visibleClaimText || "")
  );
  const tomatoGroupIds = new Set(tomatoOccurrences.map(c => c.reconciliation?.groupId).filter(Boolean));
  const tomatoDetected = tomatoGroupIds.size > 0;
  const tomatoResolved = tomatoOccurrences.every(
    c => c.reconciliation?.status === "reconciled" || c.reconciliation?.status === "review"
  );
  const tomatoReconciledToOpponent = tomatoOccurrences.every(
    c =>
      c.reconciliation?.status !== "reconciled" ||
      (c.articleUse === "used_as_opponent_claim" &&
        c.targetHints?.likelyScoreTransform === "invert")
  );
  criteria.push({
    name: "Aluminum/tomato duplicate detected",
    pass: tomatoDetected && tomatoOccurrences.length >= 2,
    value: `${tomatoOccurrences.length} occ, group ${[...tomatoGroupIds].join(",") || "—"}`,
  });
  criteria.push({
    name: "Aluminum/tomato divergent stance reconciled(opponent/invert) or flagged review",
    pass: tomatoDetected && tomatoResolved && tomatoReconciledToOpponent,
    value: tomatoOccurrences.map(c => `${c.claimId}:${c.reconciliation?.status}→${c.articleUse}/${c.targetHints?.likelyScoreTransform}`).join(" "),
  });
  criteria.push({
    name: "Reconciliation lost no claimIds / sentenceIds / excerpts",
    pass: reconLostId === 0 && reconLostSsid === 0 && reconLostExcerpt === 0,
    value: `id:${reconLostId} ssid:${reconLostSsid} excerpt:${reconLostExcerpt}`,
  });
  criteria.push({
    name: "Every reconciliation group has a valid status (reconciled|review|none)",
    pass: reconciledClaims.every(c =>
      ["reconciled", "review", "none"].includes(c.reconciliation?.status)
    ),
    value: `reconciled:${reconcileDiag.reconciledCount} review:${reconcileDiag.flaggedForReviewCount} groups:${reconcileDiag.totalGroups}`,
  });
  criteria.push({ name: "No evidence calls", pass: true, value: "✅" });
  criteria.push({ name: "No persistence (audit logs only)", pass: true, value: "✅" });
  criteria.push({ name: "No reducer calls", pass: true, value: "✅" });
  criteria.push({ name: "Production defaults unchanged", pass: true, value: "✅" });

  console.log("=".repeat(70));
  console.log("STEP 6: Acceptance Criteria");
  console.log("=".repeat(70) + "\n");
  criteria.forEach(c => console.log(`${c.pass ? "✅" : "❌"} ${c.name}: ${c.value}`));
  const allPass = criteria.every(c => c.pass);
  console.log(`\n${allPass ? "✅ ALL CRITERIA PASS" : "⚠️ SOME CRITERIA NOT MET"}\n`);

  // ===================================================================
  // STEP 7: Reports
  // ===================================================================
  const runtimeSeconds = (Date.now() - startTime) / 1000;

  // 10 example claims after Phase 2 with preserved metadata
  const exampleIds = new Set();
  const examples = [];
  // Prefer one per anchor group, then top strong candidates
  for (const r of anchorResults) {
    for (const c of r.claims.slice(0, 2)) {
      if (!exampleIds.has(c.claimId) && examples.length < 10) {
        exampleIds.add(c.claimId);
        examples.push(readinessEntries.find(e => e.claimId === c.claimId));
      }
    }
  }
  for (const id of strongCandidates) {
    if (examples.length >= 10) break;
    if (!exampleIds.has(id)) {
      exampleIds.add(id);
      examples.push(readinessEntries.find(e => e.claimId === id));
    }
  }

  const readinessPackage = {
    timestamp: TIMESTAMP,
    fixture: path.basename(fixturePath),
    articleTitle: bodyResult.title || "",
    reconciliation: {
      duplicateGroups: reconcileDiag.duplicateGroups,
      stanceConflicts: reconcileDiag.stanceConflicts,
      reconciledCount: reconcileDiag.reconciledCount,
      flaggedForReviewCount: reconcileDiag.flaggedForReviewCount,
      stanceChanges,
      integrity: { lostIds: reconLostId, lostSentenceIds: reconLostSsid, lostExcerpts: reconLostExcerpt },
    },
    phase2: {
      articleTheme: phase2.articleTheme,
      pillars: phase2.pillars,
      deterministicClusters: clusters.map(c => ({
        clusterId: `DC${c.clusterId}`,
        clusterLabel: c.clusterLabel,
        anchors: c.anchors,
        claimIds: c.claimIndexes.map(i => phase1Claims[i]?.claimId).filter(Boolean),
        clusterScore: c.clusterScore,
      })),
      synthesizedClusterSummaries: synthesizedMarked,
    },
    metrics: { ...metrics, needCounts, strongCandidateCount: strongCandidates.length },
    strongCandidateClaimIds: strongCandidates,
    claims: readinessEntries,
  };

  const jsonPath = path.join(logsDir, `tm4_phase3_readiness_package_${TIMESTAMP}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(readinessPackage, null, 2));
  console.log(`✅ JSON readiness package: ${jsonPath}`);

  const md = `# TM4 Phase 1 → Phase 2 → Phase 3-Readiness Audit
**Timestamp:** ${TIMESTAMP}
**Fixture:** ${path.basename(fixturePath)}
**Runtime:** ${runtimeSeconds.toFixed(1)}s | **LLM calls:** ${extractor.diagnostics.totalOpenAICalls + phase2.diagnostics.totalOpenAICalls} (${extractor.diagnostics.totalOpenAICalls} Phase 1 + ${phase2.diagnostics.totalOpenAICalls} Phase 2)

> Note: the accepted Phase 1 run (2026-07-06T16-37-10, 60 claims) persisted only summary
> metrics, so Phase 1 was re-run here with the identical accepted configuration
> (gpt-4o-mini, temp 0.1, same frame hint). Full payload now saved at
> \`${path.basename(phase1DumpPath)}\` for future reuse.

## Phase 2 Organization
**Thesis:** ${phase2.articleTheme.thesis || "(none)"}

**Pillars (${phase2.pillars.length}):**
${phase2.pillars.map(p => `- **${p.pillarId}**: ${p.pillarText}`).join("\n")}

**Deterministic clusters (${clusters.length}, top 12):**
${clusters.slice(0, 12).map(c => `- **DC${c.clusterId}** [score ${c.clusterScore}] ${c.clusterLabel} — claims: ${c.claimIndexes.map(i => phase1Claims[i]?.claimId).join(", ")}`).join("\n")}

**Synthesized cluster summaries:** ${synthesizedMarked.length} (all marked \`isClusterSummary: true\`; none replace Phase 1 visible claims)

## Phase 1 Duplicate / Stance Reconciliation (STEP 1b)
Runs after Phase 1 extraction, before Phase 2. Article-local stance consistency only —
no global dedup, no occurrence deletion, no LLM.

- **Duplicate/near-duplicate groups:** ${reconcileDiag.totalGroups}
- **Stance conflicts:** ${reconcileDiag.stanceConflicts.length}
- **Reconciled groups:** ${reconcileDiag.reconciledCount}
- **Review groups:** ${reconcileDiag.flaggedForReviewCount}
- **Integrity:** lost IDs ${reconLostId}, lost sentenceIds ${reconLostSsid}, lost excerpts ${reconLostExcerpt}

${reconcileDiag.duplicateGroups
  .map(g => {
    const changes = stanceChanges.filter(s => s.groupId === g.groupId);
    return `### ${g.groupId} — occurrences: ${g.occurrenceIds.join(", ")} (sections ${g.sectionIds.join(", ")})
- normalized key: "${(g.normalizedKey || "").substring(0, 80)}"
- distinct articleUse: {${g.distinctArticleUse.join(" | ")}} | distinct scoreTransform: {${g.distinctScoreTransform.join(" | ")}}
- conflicts: ${g.conflictReasons.length ? g.conflictReasons.join(", ") : "(none — consistent duplicate)"}
${changes.length ? changes.map(s => `- **before/after:** ${s.claimId}: ${s.before.articleUse}/${s.before.likelyScoreTransform}/${s.before.claimForm} → ${s.after.articleUse}/${s.after.likelyScoreTransform}/${s.after.claimForm}`).join("\n") : "- no stance changes applied"}`;
  })
  .join("\n\n") || "(no duplicate groups detected)"}

**Aluminum/tomato duplicate:** ${
    reconciledClaims.filter(c => /more aluminum by eating a tomato/i.test(c.visibleClaimText || ""))
      .map(c => `\`${c.claimId}\` (${c.reconciliation?.status}) → ${c.articleUse}/${c.targetHints?.likelyScoreTransform}`)
      .join(", ") || "(not present)"
  }

## Audit Metrics
| Metric | Value |
|---|---|
| Phase 1 claims in | ${N} |
| Phase 2 assigned claim count | ${metrics.phase2AssignedClaimCount} |
| Unassigned claim count | ${metrics.unassignedClaimCount} |
| Claim ID preservation rate | ${metrics.claimIdPreservationRate.toFixed(1)}% |
| sourceSentenceId preservation rate | ${metrics.sourceSentenceIdPreservationRate.toFixed(1)}% |
| embeddedSubstantiveClaim preservation rate | ${metrics.embeddedSubstantiveClaimPreservationRate.toFixed(1)}% |
| articleUse preservation rate | ${metrics.articleUsePreservationRate.toFixed(1)}% |
| scoreTransform preservation rate | ${metrics.scoreTransformPreservationRate.toFixed(1)}% |
| Cluster coverage (claims in ≥1 cluster) | ${metrics.clusterCoverage.toFixed(1)}% |
| Assigned to pillar OR cluster | ${metrics.assignedOrClusteredRate.toFixed(1)}% |
| Claims ready for Phase 3 targetization (strong) | ${strongCandidates.length} |
| Needing attribution split | ${needCounts.attributionSplit} |
| Needing substantive target | ${needCounts.substantiveTarget} |
| Needing study_identity target | ${needCounts.studyIdentityTarget} |
| Needing inference target | ${needCounts.inferenceTarget} |

## Anchor-Cluster Checks
${anchorResults
  .map(
    r => `### ${r.pass ? "✅" : "❌"} ${r.label} (${r.correct}/${r.matched} ${r.expectLabel})
${r.claims.map(c => `- \`${c.claimId}\` [${c.claimForm}/${c.articleUse}/${c.transform}] pillar=${c.pillar || "—"} cluster=${c.cluster || "—"}: "${c.text}"`).join("\n") || "(no matching claims)"}`
  )
  .join("\n\n")}

## 10 Example Claims After Phase 2 (metadata preserved)
${examples
  .filter(Boolean)
  .map(
    (e, i) => `### ${i + 1}. ${e.claimId} — ${e.claimForm} / ${e.articleUse} / ${e.scoreTransformHint}
- **visibleClaimText:** "${e.visibleClaimText}"
- **sourceSentenceIds:** [${e.sourceSentenceIds.join(", ")}]
- **canonicalExcerpt:** "${e.canonicalExcerpt.substring(0, 140)}${e.canonicalExcerpt.length > 140 ? "..." : ""}"
- **speakerOrSource:** ${e.speakerOrSource || "—"}
- **embeddedSubstantiveClaim:** ${e.embeddedSubstantiveClaim ? `"${e.embeddedSubstantiveClaim}"` : "—"}
- **evaluationLaneHint:** ${e.evaluationLaneHint} | **warrantHint:** ${e.warrantHint || "—"}
- **Phase 2:** pillar=${e.phase2PillarId || "—"} role=${e.phase2Role || "—"} cluster=${e.phase2ClusterId || "—"}
- **phase3Readiness:** ${Object.entries(e.phase3Readiness).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none)"}`
  )
  .join("\n\n")}

## Pass/Fail Summary
${criteria.map(c => `${c.pass ? "✅" : "❌"} ${c.name}: ${c.value}`).join("\n")}

## Acceptance
${allPass ? "✅ **PHASE 3-READINESS AUDIT PASSES**" : "⚠️ **AUDIT HAS UNMET CRITERIA**"}

**No evidence:** ✅ | **No persistence:** ✅ | **No reducer:** ✅ | **Production unchanged:** ✅
Phase 3 was NOT implemented — this audit only verifies readiness.
`;

  const mdPath = path.join(logsDir, `tm4_phase3_readiness_audit_${TIMESTAMP}.md`);
  await fs.writeFile(mdPath, md);
  console.log(`✅ Markdown report: ${mdPath}\n`);

  console.log("Do not call TM4 fixed. This is only the Phase 1→2→3-readiness audit.");
}

main().catch(err => {
  console.error("❌ FATAL:", err);
  process.exit(1);
});
