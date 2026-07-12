#!/usr/bin/env node

/**
 * TM4 DEV PREVIEW EVIDENCE RUNNER — dev-only, never wired into production routes.
 *
 * Runs the EXISTING evidence engine (runEvidenceEngine) against the evaluation
 * claims of a TM4 preview task created by tm4_materialize_preview.mjs, then
 * persists results exactly like /api/submit-text does:
 *   - runEvidenceEngine        → creates reference content + content_relations,
 *                                consumes persisted claim_evaluation_targets
 *   - persistAIResults         → reference_claim_links (Workspace evidence links)
 *   - persistDirectEvidenceAssertions → reference claims + task/target links
 *
 * The final reducer is NOT run — Workspace reads reference_claim_links /
 * claims-and-linked-references directly and does not require it.
 *
 * EVIDENCE BUDGET (product requirement): evidence runs only on the Phase 2b
 * selected claims; after the engine returns, references are ranked by quality
 * and capped (~3 strong references per claim, ~27 global, URL-deduped).
 * Surplus references the engine created are unlinked and, when exclusive to
 * this preview, deleted.
 *
 * Usage:
 *   node scripts/dev/tm4_run_preview_evidence.mjs --run <previewRunId|latest> [--limit N]
 *     --limit N        dev cap: only the first N selected claims (default: all)
 *     --per-claim N    max references kept per claim (default from selection summary, 3)
 *     --max-refs N     max references kept globally (default from selection summary, 27)
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const RUNS_DIR = path.join(BACKEND, "logs/tm4_preview_runs");

dotenv.config({ path: path.join(BACKEND, ".env") });

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const RUN = getArg("--run") || "latest";
const LIMIT = Number(getArg("--limit")) || 0;

async function loadSidecar() {
  let file;
  if (RUN === "latest") {
    const files = (await fs.readdir(RUNS_DIR).catch(() => []))
      .filter((f) => /^tm4prev-.*\.json$/.test(f) && !f.includes(".cleaned"))
      .sort();
    if (!files.length) throw new Error(`No preview runs found in ${RUNS_DIR}`);
    file = path.join(RUNS_DIR, files[files.length - 1]);
  } else {
    file = path.join(RUNS_DIR, `${RUN}.json`);
  }
  return { sidecar: JSON.parse(await fs.readFile(file, "utf-8")), sidecarPath: file };
}

async function main() {
  const { sidecar, sidecarPath } = await loadSidecar();
  console.log(`🧪 TM4 Preview Evidence Runner — run ${sidecar.previewRunId} (content_id ${sidecar.contentId})\n`);

  const { query } = await import(path.join(BACKEND, "src/db/pool.js"));

  // Safety: confirm the content row is still the marked TM4 preview task.
  const rows = await query(
    `SELECT content_id FROM content WHERE content_id = ? AND topic = 'tm4-preview' AND media_source = 'TM4 Preview'`,
    [sidecar.contentId]
  );
  if (!rows.length) throw new Error(`content_id ${sidecar.contentId} is not a marked TM4 preview task; refusing to run`);

  const budget = sidecar.selectionSummary?.evidenceBudget || {};
  const PER_CLAIM_CAP = Number(getArg("--per-claim")) || budget.perClaimReferenceCap || 3;
  const GLOBAL_CAP = Number(getArg("--max-refs")) || budget.globalReferenceCap || 27;

  // EVIDENCE GATING: candidates come from the DB, not the sidecar — the join
  // tm4_selected_evaluation_claims (is_evidence_eligible=1) →
  // claim_evaluation_targets (search_eligible=1). Raw occurrences and
  // non-selected claims cannot appear in this query.
  const { loadTm4EvidenceCandidates } = await import(path.join(BACKEND, "src/storage/tm4ClaimPackageStore.js"));
  const candidates = await loadTm4EvidenceCandidates(query, sidecar.contentId);
  const byClaim = new Map();
  for (const row of candidates) {
    if (!byClaim.has(row.claim_id)) byClaim.set(row.claim_id, { rank: row.selection_rank, targets: [] });
    if (row.evaluation_target_id) byClaim.get(row.claim_id).targets.push(row);
  }
  let evalClaims = sidecar.claimMap
    .filter((c) => byClaim.has(c.dbClaimId))
    .sort((a, b) => byClaim.get(a.dbClaimId).rank - byClaim.get(b.dbClaimId).rank);
  if (LIMIT > 0) evalClaims = evalClaims.slice(0, LIMIT);
  const claimIds = evalClaims.map((c) => c.dbClaimId);
  const searchTargetCount = evalClaims.reduce((s, c) => s + byClaim.get(c.dbClaimId).targets.length, 0);
  console.log(`— Evidence candidates (DB-gated): ${evalClaims.length} selected claims${LIMIT ? ` (dev cap --limit ${LIMIT})` : ""}, ${searchTargetCount} search-eligible targets`);
  console.log(`— Evidence budget: ≤${PER_CLAIM_CAP} refs/claim, ≤${GLOBAL_CAP} total, URL-deduped`);

  // Claim metadata for the engine. Persisted claim_evaluation_targets carry the
  // TM4 target text/type/transform; primary_query_text (from the DB) rides in
  // as searchText, entity/study hints feed the engine's query lanes.
  const tm4ByOcc = new Map(
    (sidecar.tm4?.selectedEvaluationClaims || sidecar.tm4?.rawClaims || sidecar.tm4?.claims || []).map((c) => [c.claimId, c])
  );
  const claimMetadata = evalClaims.map((c) => {
    const occ = tm4ByOcc.get(c.tm4Occurrences?.[0]) || {};
    const dbTargets = byClaim.get(c.dbClaimId)?.targets || [];
    return {
      id: c.dbClaimId,
      role: "evidence",
      searchText: dbTargets.find((t) => t.primary_query_text)?.primary_query_text || c.primaryQueryText || occ.searchText || "",
      objectClaim: occ.embeddedSubstantiveClaim || "",
      isAttribution: ["quoted_claim", "attributed_assertion"].includes(occ.claimForm) || !!occ.speakerOrSource,
      speakerEntity: occ.speakerOrSource || "",
      articleStance: occ.articleUse === "endorsed_by_article" ? "endorses" : occ.articleUse === "used_as_opponent_claim" ? "opposes" : "unclear",
      scoreTransform: occ.scoreTransformHint || "",
      argumentFunction: occ.claimForm || "",
      namedEntities: [...(occ.namedActors || []), ...(occ.namedOrganizations || [])],
      studiesOrDocuments: occ.namedStudiesOrDocuments || [],
      dates: [],
    };
  });

  const readableText = await fs.readFile(path.join(BACKEND, sidecar.documentPath), "utf-8");

  const { runEvidenceEngine } = await import(path.join(BACKEND, "src/core/runEvidenceEngine.js"));
  const { persistAIResults } = await import(path.join(BACKEND, "src/storage/persistAIResults.js"));
  const { persistDirectEvidenceAssertions } = await import(path.join(BACKEND, "src/core/evidenceAssertionPersistence.js"));

  console.log("— Running evidence engine (this makes live search + LLM calls)…\n");
  const startedAt = new Date().toISOString();
  const { aiReferences, failedCandidates, claimConfidenceMap, queryPlan } = await runEvidenceEngine({
    query,
    taskContentId: sidecar.contentId,
    claimIds,
    claims: claimMetadata,
    readableText,
  });

  console.log(`\n✅ Evidence engine: ${aiReferences?.length || 0} references, ${failedCandidates?.length || 0} failed candidates`);

  // Persist the structured QUERY_PLAN trace for evidence debugging (JSONL).
  let queryPlanPath = null;
  if (Array.isArray(queryPlan) && queryPlan.length) {
    queryPlanPath = path.join(RUNS_DIR, `${sidecar.previewRunId}.queryplan.jsonl`);
    await fs.writeFile(queryPlanPath, queryPlan.map((e) => JSON.stringify(e)).join("\n") + "\n");
    console.log(`🧭 Query plan trace: ${path.relative(ROOT, queryPlanPath)} (${queryPlan.length} target entries)`);
  }

  // ---- Evidence budget: rank by scrape tier then quality, cap per claim +
  // globally, dedupe URLs. Failed-scrape stubs (stance 'insufficient',
  // snippet_only) may not displace real evidence: max 1 stub per claim, only
  // for claims short on full references, global stub cap, quality floor.
  // (Diagnosed 2026-07-09: 15/21 kept refs on 17162 were stubs, drowning the
  // 7 stance-decisive links.)
  const MAX_STUBS_PER_CLAIM = 1;
  const GLOBAL_STUB_CAP = 5;
  const STUB_QUALITY_FLOOR = 0.2;
  const isStub = (ref) => ref.documentOnly === true || (ref.scrapeStatus && ref.scrapeStatus !== "full");
  const keptRefs = [];
  const droppedRefs = [];
  {
    const sorted = [...(aiReferences || [])].sort((a, b) =>
      (Number(isStub(a)) - Number(isStub(b))) || ((b.quality || 0) - (a.quality || 0)));
    const seenUrls = new Set();
    const keptPerClaim = new Map(); // claim index → { full, stub }
    let stubsKept = 0;
    const tally = (idx) => keptPerClaim.get(idx) || { full: 0, stub: 0 };
    for (const ref of sorted) {
      const urlKey = String(ref.url || "").replace(/\/+$/, "").toLowerCase();
      const claimIdxs = Array.isArray(ref.claims) ? ref.claims : [];
      const stub = isStub(ref);
      const allowedIdxs = claimIdxs.filter((idx) => {
        const t = tally(idx);
        if (t.full + t.stub >= PER_CLAIM_CAP) return false;
        if (stub) return t.stub < MAX_STUBS_PER_CLAIM && t.full < PER_CLAIM_CAP - 1;
        return true;
      });
      const overStubBudget = stub && (stubsKept >= GLOBAL_STUB_CAP || (ref.quality || 0) < STUB_QUALITY_FLOOR);
      if (keptRefs.length >= GLOBAL_CAP || seenUrls.has(urlKey) || !allowedIdxs.length || overStubBudget) {
        droppedRefs.push(ref);
        continue;
      }
      seenUrls.add(urlKey);
      for (const idx of allowedIdxs) {
        const t = tally(idx);
        if (stub) t.stub++; else t.full++;
        keptPerClaim.set(idx, t);
      }
      if (stub) stubsKept++;
      keptRefs.push({ ...ref, claims: allowedIdxs });
    }
    console.log(`— Budget: keeping ${keptRefs.length} references (${keptRefs.length - stubsKept} full, ${stubsKept} snippet stubs), dropping ${droppedRefs.length} (per-claim ≤${PER_CLAIM_CAP}, global ≤${GLOBAL_CAP}, stubs ≤${MAX_STUBS_PER_CLAIM}/claim ≤${GLOBAL_STUB_CAP} total, URL-deduped)`);
  }

  // Unlink dropped references; delete the ones this run created exclusively.
  for (const ref of droppedRefs) {
    const refId = ref.referenceContentId;
    if (!refId) continue;
    await query(`DELETE FROM content_relations WHERE content_id = ? AND reference_content_id = ?`, [sidecar.contentId, refId]);
    const other = await query(`SELECT COUNT(*) n FROM content_relations WHERE reference_content_id = ?`, [refId]);
    if (other[0].n === 0 && refId > sidecar.contentId) {
      await query(`CALL delete_content_cascade(?)`, [refId]);
      await fs.rm(path.join(BACKEND, `assets/images/content/content_id_${refId}.png`), { force: true }).catch(() => {});
    }
  }

  let persisted = [];
  if (keptRefs.length) {
    persisted = await persistAIResults(query, {
      contentId: sidecar.contentId,
      evidenceRefs: keptRefs,
      claimIds,
      claimConfidenceMap,
    });
    await persistDirectEvidenceAssertions({ query, taskContentId: sidecar.contentId, aiReferences: keptRefs });
    console.log(`✅ Persisted ${persisted.length} budgeted references with reference_claim_links + direct assertions`);
  } else {
    console.log("⚠️ No references survived the budget — nothing persisted");
  }

  sidecar.evidenceRuns.push({
    startedAt,
    finishedAt: new Date().toISOString(),
    claimIds,
    limit: LIMIT || null,
    budget: { perClaimCap: PER_CLAIM_CAP, globalCap: GLOBAL_CAP },
    engineReferenceCount: aiReferences?.length || 0,
    keptReferenceCount: keptRefs.length,
    keptStubCount: keptRefs.filter((r) => isStub(r)).length,
    droppedReferenceCount: droppedRefs.length,
    queryPlanFile: queryPlanPath ? path.basename(queryPlanPath) : null,
    queryPlanEntryCount: Array.isArray(queryPlan) ? queryPlan.length : 0,
    referenceContentIds: keptRefs.map((r) => r.referenceContentId),
    // Fetch-layer diagnostics: what the engine could not scrape/extract.
    failedCandidates: (failedCandidates || []).slice(0, 60).map((f) => ({
      url: String(f.url || "").slice(0, 300),
      title: String(f.title || "").slice(0, 120),
      reason: String(f.reason || "").slice(0, 200),
      scrapeStatus: f.scrapeStatus || null,
    })),
  });
  await fs.writeFile(sidecarPath, JSON.stringify(sidecar, null, 2));

  console.log("=".repeat(70));
  console.log(`✅ Evidence run complete for ${sidecar.previewRunId}`);
  console.log(`   Open in Workspace:  ${sidecar.workspaceUrl}`);
  console.log("=".repeat(70));
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ FATAL:", e);
  process.exit(1);
});
