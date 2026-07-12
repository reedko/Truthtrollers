#!/usr/bin/env node

/**
 * TM4 DEV PREVIEW MATERIALIZER — dev-only, never wired into production routes.
 *
 * Runs the committed TM4 pipeline on the vaccine regression fixture, applies
 * the Phase 2b product selection gate (tm4Phase2bSelector — reuses the
 * original selectedEvaluationClaims reducer), and materializes ONLY the
 * selected 8–12 evaluation claims into the platform objects the Workspace UI
 * reads (content, claims, content_claims, claim_evaluation_targets). The full
 * raw claim inventory stays in the sidecar manifest for provenance/debug.
 *
 * Persistence mirrors /api/submit-text + the scrape flow, substituting TM4
 * for processTaskClaims/mapArgumentFunctions.
 *
 * Every inserted row is marked as a TM4 preview:
 *   content.topic        = 'tm4-preview'
 *   content.media_source = 'TM4 Preview'
 *   content.details      = JSON with tm4PreviewRunId
 *   content_claims.argument_mapping_rationale        = 'tm4:{...}' JSON metadata
 *   claim_evaluation_targets.mapping_rationale       = 'tm4:{...}' JSON metadata
 *
 * Usage:
 *   node scripts/dev/tm4_materialize_preview.mjs                  # fresh full pipeline (LLM)
 *   node scripts/dev/tm4_materialize_preview.mjs --reuse-latest   # reuse latest readiness package (no Phase 1/2 LLM)
 *   node scripts/dev/tm4_materialize_preview.mjs --package <path> # explicit readiness package
 *   node scripts/dev/tm4_materialize_preview.mjs --user <id>      # owner user_id (default 1)
 *
 * Does NOT run evidence (see tm4_run_preview_evidence.mjs).
 * Does NOT run the reducer. Does NOT touch production routes.
 * Cleanup: scripts/dev/tm4_cleanup_preview.mjs
 */

import fs from "fs/promises";
import { appendFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const LOGS_DIR = path.join(BACKEND, "logs");
const RUNS_DIR = path.join(LOGS_DIR, "tm4_preview_runs");
const FIXTURE = path.join(BACKEND, "tm4_vaccine_regression_public_health_truth_about_vaccines_part_1.html");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
const PREVIEW_RUN_ID = `tm4prev-${TIMESTAMP}`;
const PREVIEW_TOPIC = "tm4-preview";
const PREVIEW_MEDIA_SOURCE = "TM4 Preview";
const PREVIEW_TITLE = "TM4 Preview — Public Health’s “Truth” About Vaccines PART 1";

// Load backend env BEFORE importing any module that reads process.env at import time.
dotenv.config({ path: path.join(BACKEND, ".env") });

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const REUSE_LATEST = args.includes("--reuse-latest");
const PACKAGE_PATH = getArg("--package");
const USER_ID = Number(getArg("--user")) || 1;

// Same accepted Phase 1/2 configuration as the readiness audit
// (scripts/audit/tm4_phase1_phase2_phase3_readiness_audit.mjs).
const CONFIG = {
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
  phase2: { model: "gpt-4o-mini", temperature: 0.2, timeoutMs: 90000, maxRetries: 1 },
};

// Raw LLM response capture: every Phase 1/2 model response is appended as
// JSONL BEFORE parsing, so parse/validation failures are reconstructable.
const RAWLLM_PATH = path.join(RUNS_DIR, `${PREVIEW_RUN_ID}.rawllm.jsonl`);
function captureRaw(phase, meta, raw) {
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    appendFileSync(RAWLLM_PATH, JSON.stringify({
      ts: new Date().toISOString(), phase, ...meta,
      raw: typeof raw === "string" ? raw : JSON.stringify(raw),
    }) + "\n");
  } catch { /* capture is best-effort */ }
}

// ---- TM4 pipeline ----------------------------------------------------------

async function extractBodyText() {
  const { ArticleBodyExtractor } = await import(path.join(BACKEND, "src/core/articleBodyExtractor.js"));
  const html = await fs.readFile(FIXTURE, "utf-8");
  const bodyExtractor = new ArticleBodyExtractor();
  return bodyExtractor.extract(html);
}

async function runFreshPipeline(bodyResult) {
  const { ArticleSectioning } = await import(path.join(BACKEND, "src/core/articleSectioning.js"));
  const { AtomicVisibleClaimsExtractor } = await import(path.join(BACKEND, "src/core/atomicVisibleClaimsExtractor.js"));
  const { reconcilePhase1ClaimOccurrences } = await import(path.join(BACKEND, "src/core/phase1ClaimReconciler.js"));
  const { LocalClaimMapSynthesizer } = await import(path.join(BACKEND, "src/core/localClaimMapSynthesizer.js"));
  const { openAiLLM } = await import(path.join(BACKEND, "src/core/openAiLLM.js"));

  console.log("— Phase 1: sectioning + atomic visible claim extraction (LLM)…");
  const sectioner = new ArticleSectioning();
  const sectionResult = await sectioner.section(bodyResult.bodyHtml);
  console.log(`  Sections: ${sectionResult.sections.length}`);

  const extractor = new AtomicVisibleClaimsExtractor(openAiLLM, {
    model: CONFIG.phase1.llmModel,
    temperature: CONFIG.phase1.llmTemperature,
    timeoutMs: CONFIG.phase1.llmTimeoutMs,
    maxRetries: CONFIG.phase1.llmMaxRetries,
    maxClaims: CONFIG.phase1.maxClaimsPerSection,
    articleTitle: bodyResult.title || "",
    articleFrameHint: CONFIG.phase1.articleFrameHint,
    captureRaw,
  });

  const sections = sectionResult.sections;
  const sectionResults = new Array(sections.length);
  let nextSectionIdx = 0;
  async function sectionWorker() {
    while (nextSectionIdx < sections.length) {
      const idx = nextSectionIdx++;
      const section = sections[idx];
      sectionResults[idx] = await extractor.extractFromSection(
        section.sectionIndex,
        section.fullText,
        section.heading || section.inferredLabel
      );
      console.log(`  Section ${section.sectionIndex + 1}/${sections.length}: ${sectionResults[idx].visibleClaims.length} claims`);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONFIG.phase1.sectionConcurrency, sections.length) }, sectionWorker)
  );

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
  console.log(`  Phase 1 claims: ${phase1Claims.length}`);

  console.log("— Phase 1b: duplicate/stance reconciliation (deterministic)…");
  const reconcile = reconcilePhase1ClaimOccurrences(phase1Claims, { similarityThreshold: 0.9 });
  const reconciledClaims = reconcile.claims;
  console.log(`  Groups: ${reconcile.diagnostics.totalGroups}, stance conflicts: ${reconcile.diagnostics.stanceConflicts.length}`);

  console.log("— Phase 2: claim-map organization/clustering (LLM)…");
  const compactForLLM = reconciledClaims.map((c) => ({
    claimIndex: c.claimIndex,
    sectionIndex: c.sectionIndex,
    claimText: (c.visibleClaimText || "").substring(0, 120),
    searchText: (c.searchText || "").substring(0, 60),
    theme: c.localThemeLabel,
  }));
  const fullForExcerpts = reconciledClaims.map((c) => ({
    claimIndex: c.claimIndex,
    sectionIndex: c.sectionIndex,
    claimText: c.visibleClaimText || "",
    localSourceExcerpt: c.localSourceExcerpt || "",
    searchText: c.searchText || "",
    localTheme: { label: c.localThemeLabel, summary: "" },
  }));
  const synthesizer = new LocalClaimMapSynthesizer(openAiLLM, { ...CONFIG.phase2, captureRaw });
  const phase2 = await synthesizer.synthesize(bodyResult.title || "Article", compactForLLM, fullForExcerpts);
  const clusters = synthesizer.diagnostics.deterministicClusters || [];
  console.log(`  Pillars: ${phase2.pillars.length}, clusters: ${clusters.length}`);

  const assignmentByIndex = new Map();
  for (const a of phase2.claimAssignments || []) {
    if (Number.isInteger(a.claimIndex) && !assignmentByIndex.has(a.claimIndex)) assignmentByIndex.set(a.claimIndex, a);
  }
  const clusterByIndex = new Map();
  for (const cl of clusters) {
    for (const idx of cl.claimIndexes) if (!clusterByIndex.has(idx)) clusterByIndex.set(idx, cl);
  }
  const validPillarIds = new Set((phase2.pillars || []).map((p) => p.pillarId));

  const phase2Context = {
    thesis: phase2.articleTheme?.thesis || "",
    pillars: (phase2.pillars || []).map((p) => ({ pillarId: p.pillarId, pillarText: p.pillarText || "" })),
    clusters: clusters.map((cl) => ({ clusterId: `DC${cl.clusterId}`, anchors: cl.anchors || [], clusterScore: cl.clusterScore || 0 })),
  };

  const organizedClaims = reconciledClaims.map((c) => {
    const a = assignmentByIndex.get(c.claimIndex);
    const cl = clusterByIndex.get(c.claimIndex);
    return {
      ...c,
      phase2PillarId: a && validPillarIds.has(a.pillarId) ? a.pillarId : a?.pillarId || "",
      phase2Role: a?.articleRole || "",
      phase2ClusterId: cl ? `DC${cl.clusterId}` : "",
      phase2ClusterLabel: cl?.clusterLabel || "",
      phase2ClusterAnchors: cl?.anchors || [],
    };
  });

  // Same readiness-entry shape the targetizer consumes
  // (scripts/audit/tm4_phase1_phase2_phase3_readiness_audit.mjs STEP 5).
  const readinessEntries = organizedClaims.map((c) => ({
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
    scoreTransformHint: c.targetHints?.likelyScoreTransform || "",
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
    reconciliation: c.reconciliation || { groupId: null, status: "none", reason: "", canonicalOccurrenceId: null, changed: false },
  }));
  return { claims: readinessEntries, phase2Context };
}

async function loadReadinessClaims() {
  let pkgPath = PACKAGE_PATH;
  if (!pkgPath) {
    const files = await fs.readdir(LOGS_DIR);
    const matches = files.filter((f) => /^tm4_phase3_readiness_package_.*\.json$/.test(f)).sort();
    if (!matches.length) throw new Error("No readiness package in backend/logs; run without --reuse-latest");
    pkgPath = path.join(LOGS_DIR, matches[matches.length - 1]);
  }
  console.log(`— Reusing readiness package: ${path.basename(pkgPath)}`);
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
  const phase2Context = {
    thesis: pkg.phase2?.articleTheme?.thesis || "",
    pillars: (pkg.phase2?.pillars || []).map((p) => ({ pillarId: p.pillarId, pillarText: p.pillarText || "" })),
    clusters: (pkg.phase2?.deterministicClusters || []).map((cl) => ({
      clusterId: String(cl.clusterId).startsWith("DC") ? cl.clusterId : `DC${cl.clusterId}`,
      anchors: cl.anchors || [],
      clusterScore: cl.clusterScore || 0,
    })),
  };
  return { claims: pkg.claims || [], phase2Context };
}

// ---- mapping helpers ------------------------------------------------------

const ARTICLE_STANCE = {
  endorsed_by_article: "endorses",
  used_as_opponent_claim: "opposes",
  reported_neutrally: "neutral",
};

function mapTargetForStore(target, claim) {
  const original = target.targetType;
  const storeType = ["attribution", "substantive", "inference", "study_identity"].includes(original)
    ? original
    : "substantive"; // evidence_landscape → substantive (original kept in rationale JSON)
  const studies = target.queryHints?.studiesOrDocuments || [];
  return {
    targetType: storeType,
    targetText: target.targetText || "",
    objectText: target.targetText || "",
    subjectEntity: claim.speakerOrSource || "",
    sourceExcerpt: (target.canonicalExcerpt || claim.canonicalExcerpt || "").slice(0, 2000),
    articleStance: ARTICLE_STANCE[claim.articleUse] || "unclear",
    scoreTransform: target.scoreTransform || "review",
    searchEligible: target.searchEligible !== false,
    verdictEligible: target.verdictEligible !== false,
    resolutionStatus: "mapped",
    studyTitle: storeType === "study_identity" ? studies[0] || "" : "",
    mappingConfidence: Number(target.mappingConfidence) || 0,
    mappingRationale: "tm4:" + JSON.stringify({
      previewRunId: PREVIEW_RUN_ID,
      tm4TargetId: target.targetId,
      originalTargetType: original,
      sourceClaimId: target.sourceClaimId,
      sourceSentenceIds: target.sourceSentenceIds || [],
      queryHints: target.queryHints || {},
      bearingCriteria: target.bearingCriteria || {},
      mappingReason: target.mappingReason || "",
    }),
  };
}

// ---- main -----------------------------------------------------------------

async function main() {
  console.log(`🧪 TM4 Preview Materializer — run ${PREVIEW_RUN_ID}\n`);

  if (process.env.ENABLE_MULTI_TARGET_EVIDENCE !== "true") {
    throw new Error("ENABLE_MULTI_TARGET_EVIDENCE must be 'true' in backend/.env (it already is in this repo's dev env)");
  }

  const bodyResult = await extractBodyText();
  console.log(`✅ Fixture body: ${bodyResult.bodyText.length} chars — "${bodyResult.title || "(no title)"}"\n`);

  const { claims, phase2Context } = REUSE_LATEST || PACKAGE_PATH ? await loadReadinessClaims() : await runFreshPipeline(bodyResult);
  console.log(`✅ Claim occurrences in: ${claims.length}\n`);

  // Phase 2b — product selection gate: distill to the 8–12 claims most worth
  // evaluating. Raw claims stay in the sidecar; Workspace gets selected only.
  const { selectTm4EvaluationClaims } = await import(path.join(BACKEND, "src/core/tm4Phase2bSelector.js"));
  const { selectedEvaluationClaims, nonSelectedClaims, selectionSummary } = selectTm4EvaluationClaims(claims, phase2Context);
  console.log(`✅ Phase 2b selection: ${selectionSummary.selectedCount}/${selectionSummary.rawClaimCount} claims — pillars ${selectionSummary.pillarCoverage}, clusters ${selectionSummary.clusterCoverage}\n`);

  // Generic sidecar evidence-affordance query expansion: selected claims
  // inherit evidence-search hints from stronger-affordance UNSELECTED sibling
  // claims (never promoted to Workspace). Provenance kept for the sidecar.
  const { computeEvidenceAffordanceExpansion } = await import(path.join(BACKEND, "src/core/tm4EvidenceAffordanceExpansion.js"));
  const nonSelectedReasons = new Map(nonSelectedClaims.map((c) => [c.claimId, c.suppressionReason]));
  const { expansionByClaimId, diagnostics: queryExpansionDiagnostics } = computeEvidenceAffordanceExpansion(
    selectedEvaluationClaims, claims, { ...phase2Context, rebuttalFrame: selectionSummary.rebuttalFrame === true }, { nonSelectedReasons }
  );
  console.log(`✅ Evidence-affordance expansion: ${Object.keys(expansionByClaimId).length}/${selectedEvaluationClaims.length} selected claims enriched from siblings\n`);

  // Phase 3 targetization (deterministic) — selected claims only by default.
  const { targetizeClaimOccurrences } = await import(path.join(BACKEND, "src/core/phase3Targetizer.js"));
  const { targets, diagnostics } = targetizeClaimOccurrences(selectedEvaluationClaims, { expansionByClaimId });
  console.log(`✅ Phase 3 targets (selected claims only): ${diagnostics.targetCount} (${JSON.stringify(diagnostics.targetsByType)})`);

  // Phase 3 target quality check (existing audit script, child process)
  const targetsPath = path.join(LOGS_DIR, `tm4_phase3_targets_${TIMESTAMP}.json`);
  await fs.writeFile(targetsPath, JSON.stringify({ timestamp: TIMESTAMP, sourcePackage: "tm4_materialize_preview", diagnostics, targets }, null, 2));
  const qa = spawnSync("node", [path.join(ROOT, "scripts/audit/tm4_phase3_target_quality_audit.mjs"), targetsPath], { encoding: "utf-8" });
  const qaSummary = (qa.stdout.match(/Reviewed \d+ · passing \d+ · flagged \d+ · flags \d+/) || [""])[0];
  console.log(`✅ Quality audit: ${qaSummary || "(no summary line)"}`);
  const flagCount = Number((qaSummary.match(/flags (\d+)/) || [])[1] ?? NaN);
  if (qa.status !== 0 || !qaSummary || flagCount > 0) {
    console.error(qa.stdout, qa.stderr);
    throw new Error(`Target quality audit did not pass cleanly (flags=${flagCount}); aborting before any DB write.`);
  }
  console.log();

  // ---- persistence (same building blocks as /api/submit-text) --------------
  const { query } = await import(path.join(BACKEND, "src/db/pool.js"));
  const { createContentInternal } = await import(path.join(BACKEND, "src/storage/createContentInternal.js"));
  const { persistClaims } = await import(path.join(BACKEND, "src/storage/persistClaims.js"));
  const { replaceClaimEvaluationTargets } = await import(path.join(BACKEND, "src/core/evaluationTargetStore.js"));
  const { persistTm4ClaimPackage } = await import(path.join(BACKEND, "src/storage/tm4ClaimPackageStore.js"));

  // Schema-first: verify TM4 persistence tables exist BEFORE any DB write.
  try {
    await query("SELECT 1 FROM tm4_claim_packages LIMIT 1");
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") {
      throw new Error("TM4 persistence tables missing — run backend/migrations/tm4_claim_package_persistence.sql first (nothing was written).");
    }
    throw err;
  }

  console.log("— Creating preview task content row…");
  const contentId = await createContentInternal(query, {
    content_name: PREVIEW_TITLE,
    url: `tm4-preview://${PREVIEW_RUN_ID}`,
    media_source: PREVIEW_MEDIA_SOURCE,
    topic: PREVIEW_TOPIC,
    subtopics: [],
    content_type: "task",
    thumbnail: null,
    details: JSON.stringify({ tm4PreviewRunId: PREVIEW_RUN_ID, fixture: path.basename(FIXTURE), createdAt: TIMESTAMP }),
  });
  console.log(`✅ Preview task content_id = ${contentId}`);

  // Save article text like /api/submit-text does, so text-based UI panes work.
  const docFilename = `content_id_${contentId}.txt`;
  const docDir = path.join(BACKEND, "assets/documents/tasks");
  await fs.mkdir(docDir, { recursive: true });
  await fs.writeFile(path.join(docDir, docFilename), bodyResult.bodyText, "utf-8");
  const documentPath = `assets/documents/tasks/${docFilename}`;
  // InsertContentAndTopics routes topic through the topics junction and leaves
  // content.topic NULL — set the column directly; it is the cleanup guard key.
  await query(`UPDATE content SET url = ?, content_text = ?, topic = ? WHERE content_id = ?`, [
    documentPath,
    bodyResult.bodyText.slice(0, 60000),
    PREVIEW_TOPIC,
    contentId,
  ]);
  await query(`INSERT INTO content_users (content_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id`, [contentId, USER_ID]);
  console.log(`✅ Document saved (${documentPath}), assigned to user ${USER_ID}\n`);

  // Persist ONLY the Phase 2b-selected claims. Each selected claim is a
  // canonical occurrence (duplicate groups already collapsed by the selector).
  const targetsByOccurrence = new Map();
  for (const t of targets) {
    if (!targetsByOccurrence.has(t.sourceClaimId)) targetsByOccurrence.set(t.sourceClaimId, []);
    targetsByOccurrence.get(t.sourceClaimId).push(t);
  }

  const entries = selectedEvaluationClaims.map((claim) => {
    const occTargets = targetsByOccurrence.get(claim.claimId) || [];
    const substantive = occTargets.find((t) => t.targetType === "substantive");
    return {
      text: claim.visibleClaimText.trim(),
      id: claim.claimId,
      role: "evidence",
      type: "evaluation",
      objectClaim: claim.embeddedSubstantiveClaim || substantive?.targetText || claim.searchText || null,
      isAttribution: ["quoted_claim", "attributed_assertion"].includes(claim.claimForm) || !!claim.speakerOrSource,
      speakerEntity: claim.speakerOrSource || null,
      claimOrder: claim.selectionRank - 1,
      _tm4: { claim, occurrences: [claim], occTargets, lane: "evaluation" },
    };
  });

  console.log(`— Persisting ${entries.length} selected Workspace claims (raw inventory of ${claims.length} stays in sidecar)…`);
  const claimIds = await persistClaims(query, contentId, entries, "task", "task");
  if (claimIds.length !== entries.length) {
    throw new Error(`persistClaims returned ${claimIds.length} ids for ${entries.length} entries`);
  }

  console.log("— Writing TM4 argument metadata onto content_claims…");
  const claimMap = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const dbClaimId = claimIds[i];
    const c = e._tm4.claim;
    const meta = {
      previewRunId: PREVIEW_RUN_ID,
      lane: e._tm4.lane,
      selectionRank: c.selectionRank,
      selectionScore: c.selectionScore,
      selectionRationale: c.selectionRationale,
      sourceRawClaimIds: c.sourceRawClaimIds,
      occurrences: e._tm4.occurrences.map((o) => ({
        sourceClaimId: o.claimId,
        sourceSentenceIds: o.sourceSentenceIds || [],
        canonicalExcerpt: (o.canonicalExcerpt || "").slice(0, 500),
      })),
      claimForm: c.claimForm,
      articleUse: c.articleUse,
      evaluationLaneHint: c.evaluationLaneHint,
      speakerOrSource: c.speakerOrSource,
      embeddedSubstantiveClaim: c.embeddedSubstantiveClaim,
      pillar: c.phase2PillarId,
      cluster: c.phase2ClusterId,
      phase2Role: c.phase2Role,
      scoreTransformHint: c.scoreTransformHint,
    };
    const bestConfidence = Math.max(0, ...e._tm4.occTargets.map((t) => Number(t.mappingConfidence) || 0));
    await query(
      `UPDATE content_claims
          SET article_stance = ?, argument_function = ?, score_transform = ?,
              argument_mapping_confidence = ?, argument_mapping_rationale = ?
        WHERE content_id = ? AND claim_id = ? AND relationship_type = 'task'`,
      [
        ARTICLE_STANCE[c.articleUse] || "unclear",
        (c.claimForm || "tm4").slice(0, 64),
        (c.scoreTransformHint || "review").slice(0, 16),
        bestConfidence,
        ("tm4:" + JSON.stringify(meta)).slice(0, 60000),
        contentId,
        dbClaimId,
      ]
    );
    claimMap.push({
      dbClaimId,
      text: e.text,
      lane: e._tm4.lane,
      selectionRank: c.selectionRank,
      selectionScore: c.selectionScore,
      selectionRationale: c.selectionRationale,
      tm4Occurrences: e._tm4.occurrences.map((o) => o.claimId),
      tm4TargetIds: e._tm4.occTargets.map((t) => t.targetId),
    });
  }

  console.log("— Persisting Phase 3 targets into claim_evaluation_targets…");
  let persistedTargetCount = 0;
  const targetTm4Fields = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e._tm4.occTargets.length) continue;
    const seen = new Set();
    const storeTargets = [];
    const keptTm4Targets = [];
    for (const t of e._tm4.occTargets) {
      const key = `${t.targetType}|${t.targetText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      storeTargets.push(mapTargetForStore(t, e._tm4.claim));
      keptTm4Targets.push(t);
    }
    const inserted = await replaceClaimEvaluationTargets(query, contentId, claimIds[i], storeTargets);
    persistedTargetCount += inserted.length;
    for (let k = 0; k < inserted.length; k++) {
      if (inserted[k].evaluationTargetId) {
        targetTm4Fields.push({ evaluationTargetId: inserted[k].evaluationTargetId, tm4Target: keptTm4Targets[k] });
      }
    }
    claimMap[i].evaluationTargetIds = inserted.map((t) => t.evaluationTargetId);
    claimMap[i].primaryQueryText = e._tm4.occTargets.find((t) => t.searchEligible)?.queryHints?.primaryQueryText || "";
  }
  console.log(`✅ Persisted ${persistedTargetCount} evaluation targets\n`);

  // ---- schema-first TM4 package persistence ---------------------------------
  // Raw occurrences (~all), reconciliation, selected claims, target metadata.
  // Persisted ≠ Workspace-visible: only the selected claims above went into
  // content_claims; the raw inventory lands in tm4_* tables only.
  console.log("— Persisting TM4 claim package (raw occurrences, reconciliation, selection, target metadata)…");
  const dbClaimIdBySourceId = new Map(entries.map((e, i) => [e.id, claimIds[i]]));
  const pkgCounts = await persistTm4ClaimPackage(query, {
    contentId,
    runId: PREVIEW_RUN_ID,
    pipelineVersion: "tm4-preview-1",
    sourcePackagePath: `backend/logs/tm4_preview_runs/${PREVIEW_RUN_ID}.json`,
    fixtureName: path.basename(FIXTURE),
    articleThesis: selectionSummary.articleThesis,
    selectionSummary,
    diagnostics,
    rawClaims: claims,
    selectedClaims: selectedEvaluationClaims,
    nonSelectedClaims,
    dbClaimIdBySourceId,
    targetTm4Fields,
  });
  console.log(`✅ TM4 package ${pkgCounts.packageId}: ${pkgCounts.rawOccurrences} raw occurrences, ${pkgCounts.reconciliations} reconciliations, ${pkgCounts.selectedClaims} selected, ${pkgCounts.stampedTargets} targets stamped\n`);

  // Sidecar manifest: full TM4 payload + cleanup keys.
  await fs.mkdir(RUNS_DIR, { recursive: true });
  const sidecarPath = path.join(RUNS_DIR, `${PREVIEW_RUN_ID}.json`);
  const workspaceUrl = `https://localhost:5173/workspace/${contentId}`;
  await fs.writeFile(sidecarPath, JSON.stringify({
    previewRunId: PREVIEW_RUN_ID,
    createdAt: TIMESTAMP,
    contentId,
    tm4ClaimPackageId: pkgCounts.packageId,
    userId: USER_ID,
    documentPath,
    fixture: path.basename(FIXTURE),
    workspaceUrl,
    targetsPackage: path.basename(targetsPath),
    qualityAudit: qaSummary,
    counts: {
      rawClaimOccurrences: claims.length,
      selectedClaims: entries.length,
      workspaceClaims: entries.length,
      evaluationClaims: entries.length,
      tm4Targets: targets.length,
      persistedEvaluationTargets: persistedTargetCount,
    },
    selectionSummary,
    claimMap,
    tm4: {
      selectionSummary,
      selectedEvaluationClaims,
      nonSelectedClaims,
      rawClaims: claims,
      targets,
      diagnostics,
      queryExpansion: queryExpansionDiagnostics,
    },
    evidenceRuns: [],
  }, null, 2));

  console.log("=".repeat(70));
  console.log(`✅ TM4 preview materialized — run ${PREVIEW_RUN_ID}`);
  console.log(`   Task content_id: ${contentId}`);
  console.log(`   Sidecar: ${sidecarPath}`);
  console.log(`   Open in Workspace:  ${workspaceUrl}`);
  console.log(`   (backend on https://localhost:5001, dashboard via 'npm run dev' in dashboard/)`);
  console.log(`   Next: node scripts/dev/tm4_run_preview_evidence.mjs --run ${PREVIEW_RUN_ID} [--limit 5]`);
  console.log(`   Cleanup: node scripts/dev/tm4_cleanup_preview.mjs --run ${PREVIEW_RUN_ID} --apply`);
  console.log("=".repeat(70));
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ FATAL:", e);
  process.exit(1);
});
