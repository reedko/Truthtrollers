#!/usr/bin/env node

/**
 * TM4 DEV PREVIEW CLEANUP — dev-only.
 *
 * Deletes exactly one TM4 preview run created by tm4_materialize_preview.mjs.
 * Refuses to touch any content row that is not marked as a TM4 preview
 * (topic='tm4-preview' AND media_source='TM4 Preview').
 *
 * Deletion strategy:
 *   1. claim_evaluation_targets for the preview task
 *      (evaluation_target_evidence_links cascade via FK)
 *   2. references linked ONLY to the preview task AND created after it
 *      (reference_content_id > task content_id) → CALL delete_content_cascade
 *      Shared or pre-existing references are only UNLINKED, never deleted.
 *   3. CALL delete_content_cascade(task) — existing stored procedure; removes
 *      content_claims, orphaned claims, claim_links, content_users, content row
 *      (reference_claim_links cascade via FK on claims/content)
 *   4. the saved task document file; sidecar renamed to *.cleaned.json
 *
 * Usage:
 *   node scripts/dev/tm4_cleanup_preview.mjs --run <previewRunId|latest>          # DRY RUN (default)
 *   node scripts/dev/tm4_cleanup_preview.mjs --run <previewRunId|latest> --apply  # actually delete
 *   node scripts/dev/tm4_cleanup_preview.mjs --content <contentId> [--apply]      # by content id
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
const APPLY = args.includes("--apply");
const RUN = getArg("--run");
const CONTENT_ID = Number(getArg("--content")) || null;

async function resolveTarget() {
  if (CONTENT_ID) return { contentId: CONTENT_ID, sidecarPath: null, sidecar: null };
  const run = RUN || "latest";
  let file;
  if (run === "latest") {
    const files = (await fs.readdir(RUNS_DIR).catch(() => []))
      .filter((f) => /^tm4prev-.*\.json$/.test(f) && !f.includes(".cleaned"))
      .sort();
    if (!files.length) throw new Error(`No preview runs found in ${RUNS_DIR}`);
    file = path.join(RUNS_DIR, files[files.length - 1]);
  } else {
    file = path.join(RUNS_DIR, `${run}.json`);
  }
  const sidecar = JSON.parse(await fs.readFile(file, "utf-8"));
  return { contentId: sidecar.contentId, sidecarPath: file, sidecar };
}

async function main() {
  const { contentId, sidecarPath, sidecar } = await resolveTarget();
  console.log(`🧹 TM4 Preview Cleanup — content_id ${contentId} ${APPLY ? "(APPLY)" : "(DRY RUN — pass --apply to delete)"}\n`);

  const { query } = await import(path.join(BACKEND, "src/db/pool.js"));

  // HARD GUARD: only marked TM4 preview tasks may be cleaned up.
  const rows = await query(
    `SELECT content_id, content_name, url, details FROM content
      WHERE content_id = ? AND topic = 'tm4-preview' AND media_source = 'TM4 Preview' AND content_type = 'task'`,
    [contentId]
  );
  if (!rows.length) {
    throw new Error(`content_id ${contentId} is not a marked TM4 preview task (topic='tm4-preview', media_source='TM4 Preview'); refusing`);
  }
  const task = rows[0];
  console.log(`   Task: "${task.content_name}"`);
  console.log(`   URL:  ${task.url}\n`);

  // Gather the run's rows.
  const taskClaims = await query(`SELECT claim_id FROM content_claims WHERE content_id = ?`, [contentId]);
  const taskClaimIds = taskClaims.map((r) => r.claim_id);
  const targetRows = await query(`SELECT COUNT(*) n FROM claim_evaluation_targets WHERE content_id = ?`, [contentId]);
  const targetLinkRows = await query(
    `SELECT COUNT(*) n FROM evaluation_target_evidence_links l
      JOIN claim_evaluation_targets t ON l.evaluation_target_id = t.evaluation_target_id
     WHERE t.content_id = ?`,
    [contentId]
  );
  const refClaimLinkRows = taskClaimIds.length
    ? await query(`SELECT COUNT(*) n FROM reference_claim_links WHERE claim_id IN (?)`, [taskClaimIds])
    : [{ n: 0 }];
  // TM4 package tables (may not exist before the migration runs)
  let tm4Counts = { packages: 0, raw: 0, selected: 0 };
  try {
    const [p, r, s] = await Promise.all([
      query(`SELECT COUNT(*) n FROM tm4_claim_packages WHERE content_id = ?`, [contentId]),
      query(`SELECT COUNT(*) n FROM tm4_raw_claim_occurrences WHERE content_id = ?`, [contentId]),
      query(`SELECT COUNT(*) n FROM tm4_selected_evaluation_claims WHERE content_id = ?`, [contentId]),
    ]);
    tm4Counts = { packages: p[0].n, raw: r[0].n, selected: s[0].n };
  } catch (err) {
    if (err?.code !== "ER_NO_SUCH_TABLE") throw err;
  }

  const refs = await query(
    `SELECT cr.reference_content_id refId,
            (SELECT COUNT(*) FROM content_relations cr2
              WHERE cr2.reference_content_id = cr.reference_content_id AND cr2.content_id <> ?) otherLinks
       FROM content_relations cr WHERE cr.content_id = ?`,
    [contentId, contentId]
  );
  // Delete only references that are exclusive to this preview AND were created
  // after the preview task (auto-increment id ordering) — anything else is
  // pre-existing/shared user data and is only unlinked.
  const exclusiveRefs = refs.filter((r) => r.otherLinks === 0 && r.refId > contentId).map((r) => r.refId);
  const sharedRefs = refs.filter((r) => !(r.otherLinks === 0 && r.refId > contentId)).map((r) => r.refId);

  console.log("Will remove:");
  console.log(`   content_claims / claims (orphans only): ${taskClaimIds.length} claim links`);
  console.log(`   claim_evaluation_targets: ${targetRows[0].n} (+ ${targetLinkRows[0].n} evidence links via FK cascade)`);
  console.log(`   reference_claim_links from task claims: ${refClaimLinkRows[0].n}`);
  console.log(`   references (exclusive to this preview, created by it): ${exclusiveRefs.length} → full cascade delete`);
  console.log(`   references (shared/pre-existing): ${sharedRefs.length} → unlink only`);
  console.log(`   tm4 package rows: ${tm4Counts.packages} package(s), ${tm4Counts.raw} raw occurrences, ${tm4Counts.selected} selected claims (FK cascade)`);
  console.log(`   content row ${contentId}, content_users, content_relations, document file\n`);

  if (!APPLY) {
    console.log("DRY RUN — nothing deleted. Re-run with --apply.");
    process.exit(0);
  }

  console.log("— Deleting claim_evaluation_targets (evidence links cascade)…");
  await query(`DELETE FROM claim_evaluation_targets WHERE content_id = ?`, [contentId]);

  // TM4 package rows cascade off the content FK when the content row goes,
  // but delete explicitly so the count is visible and the run is idempotent.
  try {
    await query(`DELETE FROM tm4_claim_packages WHERE content_id = ?`, [contentId]);
    console.log("— Deleted tm4_claim_packages (raw/reconciliation/selected cascade via FK)…");
  } catch (err) {
    if (err?.code !== "ER_NO_SUCH_TABLE") throw err;
  }

  // content_topics has no FK to content; remove junction rows explicitly
  // (the shared 'tm4-preview' topics row itself is kept for reuse).
  const topicCleanupIds = [contentId, ...exclusiveRefs];
  await query(`DELETE FROM content_topics WHERE content_id IN (?)`, [topicCleanupIds]);

  for (const refId of exclusiveRefs) {
    console.log(`— Cascade-deleting preview reference content ${refId}…`);
    await query(`CALL delete_content_cascade(?)`, [refId]);
    await fs.rm(path.join(BACKEND, `assets/images/content/content_id_${refId}.png`), { force: true });
  }
  for (const refId of sharedRefs) {
    console.log(`— Unlinking shared/pre-existing reference ${refId} (row kept)…`);
    await query(`DELETE FROM content_relations WHERE content_id = ? AND reference_content_id = ?`, [contentId, refId]);
    if (taskClaimIds.length) {
      await query(`DELETE FROM reference_claim_links WHERE reference_content_id = ? AND claim_id IN (?)`, [refId, taskClaimIds]);
    }
  }

  console.log(`— Cascade-deleting preview task ${contentId}…`);
  await query(`CALL delete_content_cascade(?)`, [contentId]);

  // Document file
  const docPath = path.join(BACKEND, `assets/documents/tasks/content_id_${contentId}.txt`);
  await fs.rm(docPath, { force: true });

  if (sidecarPath) {
    await fs.rename(sidecarPath, sidecarPath.replace(/\.json$/, ".cleaned.json"));
  }

  // Verify
  const left = await query(`SELECT COUNT(*) n FROM content WHERE content_id = ?`, [contentId]);
  const leftTargets = await query(`SELECT COUNT(*) n FROM claim_evaluation_targets WHERE content_id = ?`, [contentId]);
  console.log(`\n✅ Cleanup complete — content rows left: ${left[0].n}, targets left: ${leftTargets[0].n}`);
  if (sidecar?.previewRunId) console.log(`   Run ${sidecar.previewRunId} sidecar marked .cleaned`);
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ FATAL:", e);
  process.exit(1);
});
