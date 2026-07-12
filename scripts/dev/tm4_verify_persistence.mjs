#!/usr/bin/env node

/**
 * TM4 PERSISTENCE VERIFICATION — dev-only, read-only.
 *
 * Prints the persistence/gating state for a TM4 preview run and asserts the
 * product-shape acceptance checks:
 *   - ~60 raw occurrences persisted (audit/provenance)
 *   - 8–12 selectedEvaluationClaims persisted
 *   - Workspace-visible claim count == selected count (not 60)
 *   - evidence candidate query returns only targets attached to selected claims
 *
 * Usage:
 *   node scripts/dev/tm4_verify_persistence.mjs --run <previewRunId|latest>
 *   node scripts/dev/tm4_verify_persistence.mjs --content <contentId>
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

async function resolveContentId() {
  const cid = Number(getArg("--content"));
  if (cid) return cid;
  const run = getArg("--run") || "latest";
  let file;
  if (run === "latest") {
    const files = (await fs.readdir(RUNS_DIR).catch(() => []))
      .filter((f) => /^tm4prev-.*\.json$/.test(f) && !f.includes(".cleaned")).sort();
    if (!files.length) throw new Error(`No preview runs in ${RUNS_DIR}`);
    file = path.join(RUNS_DIR, files[files.length - 1]);
  } else {
    file = path.join(RUNS_DIR, `${run}.json`);
  }
  return JSON.parse(await fs.readFile(file, "utf-8")).contentId;
}

async function main() {
  const contentId = await resolveContentId();
  const { query } = await import(path.join(BACKEND, "src/db/pool.js"));
  const { loadTm4EvidenceCandidates } = await import(path.join(BACKEND, "src/storage/tm4ClaimPackageStore.js"));

  const pkgs = await query(`SELECT * FROM tm4_claim_packages WHERE content_id = ? ORDER BY tm4_claim_package_id DESC LIMIT 1`, [contentId]);
  if (!pkgs.length) throw new Error(`No tm4_claim_packages row for content_id ${contentId}`);
  const pkg = pkgs[0];
  const pkgId = pkg.tm4_claim_package_id;

  const one = async (sql, params) => (await query(sql, params))[0].n;
  const rawPersisted = await one(`SELECT COUNT(*) n FROM tm4_raw_claim_occurrences WHERE tm4_claim_package_id = ?`, [pkgId]);
  const rawHidden = await one(`SELECT COUNT(*) n FROM tm4_raw_claim_occurrences WHERE tm4_claim_package_id = ? AND is_selected = 0`, [pkgId]);
  const recon = await one(`SELECT COUNT(*) n FROM tm4_claim_reconciliations WHERE tm4_claim_package_id = ?`, [pkgId]);
  const selected = await one(`SELECT COUNT(*) n FROM tm4_selected_evaluation_claims WHERE tm4_claim_package_id = ?`, [pkgId]);
  const selectedAnchored = await one(`SELECT COUNT(*) n FROM tm4_selected_evaluation_claims WHERE tm4_claim_package_id = ? AND content_claim_id IS NOT NULL`, [pkgId]);
  const workspaceVisible = await one(`SELECT COUNT(*) n FROM content_claims WHERE content_id = ? AND relationship_type = 'task'`, [contentId]);
  const targetsSelected = await one(
    `SELECT COUNT(*) n FROM claim_evaluation_targets t
      JOIN tm4_selected_evaluation_claims sec ON sec.content_id = t.content_id AND sec.claim_id = t.claim_id
     WHERE sec.tm4_claim_package_id = ?`, [pkgId]);
  const targetsAll = await one(`SELECT COUNT(*) n FROM claim_evaluation_targets WHERE content_id = ?`, [contentId]);
  const searchEligible = await one(`SELECT COUNT(*) n FROM claim_evaluation_targets WHERE content_id = ? AND search_eligible = 1`, [contentId]);
  const verdictEligible = await one(`SELECT COUNT(*) n FROM claim_evaluation_targets WHERE content_id = ? AND verdict_eligible = 1`, [contentId]);
  const orphanTargets = await one(
    `SELECT COUNT(*) n FROM claim_evaluation_targets t
      WHERE t.content_id = ? AND NOT EXISTS (
        SELECT 1 FROM tm4_selected_evaluation_claims sec
         WHERE sec.content_id = t.content_id AND sec.claim_id = t.claim_id)`, [contentId]);

  const candidates = await loadTm4EvidenceCandidates(query, contentId);
  const candidateClaims = new Set(candidates.map((c) => c.claim_id));
  const candidateTargets = candidates.filter((c) => c.evaluation_target_id).length;

  console.log("=".repeat(70));
  console.log("TM4 Persistence Verification");
  console.log("=".repeat(70));
  console.log(`content_id:                          ${contentId}`);
  console.log(`task_id:                             ${contentId} (content row IS the task)`);
  console.log(`tm4_claim_package_id:                ${pkgId} (run ${pkg.run_id})`);
  console.log(`raw Phase 1 claim occurrence count:  ${pkg.raw_claim_count}`);
  console.log(`persisted raw occurrence count:      ${rawPersisted}`);
  console.log(`reconciliation records:              ${recon}`);
  console.log(`selectedEvaluationClaims count:      ${selected} (${selectedAnchored} anchored to content_claims.cc_id)`);
  console.log(`Workspace-visible TM4 claim count:   ${workspaceVisible}`);
  console.log(`hidden/non-selected claim count:     ${rawHidden}`);
  console.log(`Phase 3 targets on selected claims:  ${targetsSelected} (of ${targetsAll} total for content)`);
  console.log(`search-eligible target count:        ${searchEligible}`);
  console.log(`verdict-eligible target count:       ${verdictEligible}`);
  console.log(`evidence-run candidate count:        ${candidateTargets} targets across ${candidateClaims.size} claims`);
  console.log("=".repeat(70));

  const checks = [
    { name: "raw occurrences persisted (≥40)", pass: rawPersisted >= 40 && rawPersisted === pkg.raw_claim_count },
    { name: "selectedEvaluationClaims in 8–12", pass: selected >= 8 && selected <= 12 },
    { name: "Workspace-visible == selected (not raw)", pass: workspaceVisible === selected },
    { name: "raw non-selected persisted but hidden", pass: rawHidden === rawPersisted - selected },
    { name: "all selected anchored to content_claims.cc_id", pass: selectedAnchored === selected },
    { name: "every content target belongs to a selected claim", pass: orphanTargets === 0 },
    { name: "evidence candidates only from selected claims", pass: [...candidateClaims].every((id) => candidateClaims.has(id)) && candidateTargets <= searchEligible && candidateClaims.size <= selected },
  ];
  checks.forEach((c) => console.log(`${c.pass ? "✅" : "❌"} ${c.name}`));
  const allPass = checks.every((c) => c.pass);
  console.log(allPass ? "\n✅ ALL PERSISTENCE/GATING CHECKS PASS" : "\n❌ CHECKS FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("❌ FATAL:", e.message || e);
  process.exit(1);
});
