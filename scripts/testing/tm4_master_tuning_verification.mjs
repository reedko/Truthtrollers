#!/usr/bin/env node

/**
 * TM4 MASTER TUNING VERIFICATION — orchestrated, disposable, self-cleaning.
 *
 * Runs the complete verification loop with the real scripts (no duplicated
 * logic): fresh materialization → selector/anchor/declarativeness audits →
 * raw LLM capture verification (+ prompt/response dump) → capped evidence run
 * → stance/budget verification against the recorded 17162 baseline →
 * fetch-layer failure report → persistence checks → cleanup.
 *
 * Produces the Obsidian-friendly master report:
 *   artifacts/tm4_master_tuning_verification_<timestamp>.{md,json}
 *
 * Usage:
 *   node scripts/testing/tm4_master_tuning_verification.mjs            # full loop, cleans up
 *   node scripts/testing/tm4_master_tuning_verification.mjs --keep     # keep the preview task
 *   node scripts/testing/tm4_master_tuning_verification.mjs --limit 3  # evidence claim cap (default 3)
 *
 * No production evidence; the preview task is deleted at the end unless --keep.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const RUNS_DIR = path.join(BACKEND, "logs/tm4_preview_runs");
const ARTIFACTS = path.join(ROOT, "artifacts");
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

dotenv.config({ path: path.join(BACKEND, ".env") });

const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || 3;

// Recorded baseline BEFORE the budget/stance fixes (run tm4prev-2026-07-08T14-11-16,
// content 17162, measured 2026-07-09 from live DB before that run's data aged):
const BASELINE_17162 = {
  runId: "tm4prev-2026-07-08T14-11-16",
  contentId: 17162,
  legacyLinks: { total: 22, insufficient: 15, insufficientShare: "68%", note: "all 15 insufficient links were snippet_only failed-scrape stubs with support_level 0" },
  targetLinks: { total: 18, decisive: 17, avgBearing: 0.93 },
};

const run = (cmd, cmdArgs, label) => {
  console.log(`\n▶ ${label}: node ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync("node", [cmd, ...cmdArgs], { encoding: "utf-8", cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status}):\n${(r.stderr || r.stdout).slice(-2000)}`);
  return r.stdout;
};

const HIGH_VALUE_RE = /thompson|hooker|whistleblower|manipulat|destroy|fraudulent|re-?work|verstraeten|simpsonwood|thimerosal|alumin|tomato|blood.brain|\b1986\b|liabilit|\bVAERS\b|\bMMR\b/i;

async function main() {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  const report = { timestamp: TS, baseline: BASELINE_17162, sections: {} };
  const { probeTagsFor, anchorFamiliesFor } = await import("./lib/tm4AnchorTaxonomy.mjs");
  const { auditDeclarativeness } = await import("./lib/tm4Declarativeness.mjs");

  // ── 1. Fix inventory ──────────────────────────────────────────────────────
  const gitStatus = spawnSync("git", ["status", "--short"], { encoding: "utf-8", cwd: ROOT }).stdout.trim();
  report.sections.fixInventory = {
    gitStatus,
    fixes: [
      { file: "backend/src/core/tm4Phase2bSelector.js", change: "Phase 2b selection gate; dissimilar cluster siblings admitted (Jaccard gate 0.28, ≤2/cluster) so broad clusters cannot suppress distinct allegations", preExisted: true, verify: "node scripts/testing/tm4_master_tuning_verification.mjs (section 2)" },
      { file: "scripts/dev/tm4_run_preview_evidence.mjs", change: "stub-tiered evidence budget: full-scrape refs first; stubs ≤1/claim, ≤5 global, 0.2 quality floor; failedCandidates now recorded in sidecar", preExisted: "budget yes; failedCandidates recording added this run", verify: "section 6/7 of this report" },
      { file: "backend/src/core/atomicVisibleClaimsExtractor.js", change: "captureRaw hook — now records model/temperature/system+user prompts/parse status/accepted+rejected counts (prompt fields added this run)", preExisted: "hook yes; prompt+outcome enrichment added this run", verify: "section 5 of this report" },
      { file: "backend/src/core/localClaimMapSynthesizer.js", change: "captureRaw hook with same enrichment", preExisted: "hook yes; enrichment added this run", verify: "section 5" },
      { file: "backend/src/utils/logger.js", change: "clearLogFile rotates the previous evidence log aside instead of truncating", preExisted: true, verify: "ls backend/logs/evidence-*.old.log after a backend restart" },
      { file: "scripts/dev/tm4_materialize_preview.mjs", change: "raw-capture writer → <runId>.rawllm.jsonl (rows now flattened with prompt fields)", preExisted: "writer yes; flattening added this run", verify: "section 5" },
      { file: "scripts/testing/lib/tm4AnchorTaxonomy.mjs", change: "NEW: auditProbeTags (loose) separated from claimBearingAnchorFamilies (topic+predicate)", preExisted: false, verify: "section 3" },
      { file: "scripts/testing/lib/tm4Declarativeness.mjs", change: "NEW: softening/predicate/entity/number preservation audit with declarative score", preExisted: false, verify: "section 4" },
    ],
  };

  // ── 2. Fresh materialization + selector verification ─────────────────────
  const matOut = run("scripts/dev/tm4_materialize_preview.mjs", [], "materialize (fresh pipeline)");
  const runId = matOut.match(/run (tm4prev-[\dT-]+)/)?.[1];
  const contentId = Number(matOut.match(/Task content_id: (\d+)/)?.[1]);
  if (!runId || !contentId) throw new Error("could not parse runId/contentId from materializer output");
  const sidecar = JSON.parse(await fs.readFile(path.join(RUNS_DIR, `${runId}.json`), "utf-8"));
  const selected = sidecar.tm4.selectedEvaluationClaims;
  const nonSelected = sidecar.tm4.nonSelectedClaims;

  const thompson = selected.filter((c) => /thompson|destroy(ed)? (all )?(the )?evidence|fraudulent|manipulat/i.test(`${c.visibleClaimText} ${c.embeddedSubstantiveClaim || ""}`));
  const selectedClusters = new Set(selected.map((c) => c.phase2ClusterId).filter(Boolean));
  const suspiciousOmitted = nonSelected.filter((c) =>
    HIGH_VALUE_RE.test(`${c.visibleClaimText} ${c.embeddedSubstantiveClaim || ""}`) &&
    !(c.phase2ClusterId && selectedClusters.has(c.phase2ClusterId)));

  report.sections.selectorVerification = {
    runId, contentId,
    selectionSummary: sidecar.selectionSummary,
    selected: selected.map((c) => ({
      rank: c.selectionRank, sourceClaimId: c.claimId, cluster: c.phase2ClusterId, pillar: c.phase2PillarId,
      score: c.selectionScore, text: c.visibleClaimText, rationale: c.selectionRationale,
      dissimilarSiblingAdmission: /dissimilar cluster sibling admitted/.test(c.selectionRationale || ""),
    })),
    thompsonSelected: thompson.map((c) => ({ rank: c.selectionRank, sourceClaimId: c.claimId, cluster: c.phase2ClusterId, text: c.visibleClaimText, rationale: c.selectionRationale })),
    thompsonPass: thompson.length > 0,
    suspiciousOmittedHighValue: suspiciousOmitted.map((c) => ({ sourceClaimId: c.claimId, cluster: c.phase2ClusterId, reason: c.suppressionReason, text: c.visibleClaimText })),
  };

  // ── 3. Anchor/probe separation audit ─────────────────────────────────────
  report.sections.anchorProbeAudit = {
    taxonomyModule: "scripts/testing/lib/tm4AnchorTaxonomy.mjs",
    selectedClaims: selected.map((c) => {
      const hay = `${c.visibleClaimText} ${c.embeddedSubstantiveClaim || ""}`;
      const fams = anchorFamiliesFor(hay);
      return {
        rank: c.selectionRank, sourceClaimId: c.claimId,
        auditProbeTags: probeTagsFor(hay),
        claimBearingFamilies: fams.filter((f) => f.pass).map((f) => f.family),
        topicOnlyWarnings: fams.filter((f) => f.topicOnly).map((f) => f.family),
      };
    }),
  };

  // ── 4. Declarativeness audit ──────────────────────────────────────────────
  const rawById = new Map(sidecar.tm4.rawClaims.map((c) => [c.claimId, c]));
  const targetsByOcc = new Map();
  for (const t of sidecar.tm4.targets) {
    if (!targetsByOcc.has(t.sourceClaimId)) targetsByOcc.set(t.sourceClaimId, []);
    targetsByOcc.get(t.sourceClaimId).push(t);
  }
  report.sections.declarativenessAudit = selected.map((c) => {
    const raw = rawById.get(c.claimId) || {};
    const audit = auditDeclarativeness({ selectedText: c.visibleClaimText, rawText: raw.visibleClaimText || "", embeddedSubstantiveClaim: c.embeddedSubstantiveClaim || "" });
    return {
      rank: c.selectionRank, sourceClaimId: c.claimId,
      rawVisibleClaimText: raw.visibleClaimText || "",
      embeddedSubstantiveClaim: c.embeddedSubstantiveClaim || "",
      selectedClaimText: c.visibleClaimText,
      targetTexts: (targetsByOcc.get(c.claimId) || []).map((t) => `[${t.targetType}] ${t.targetText}`),
      sourceSentenceIds: c.sourceSentenceIds,
      canonicalExcerpt: (c.canonicalExcerpt || "").slice(0, 400),
      ...audit,
    };
  });

  // ── 5. Raw LLM capture verification + dump ────────────────────────────────
  const rawllmFile = path.join(RUNS_DIR, `${runId}.rawllm.jsonl`);
  const rawRows = (await fs.readFile(rawllmFile, "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
  const need = ["phase", "model", "temperature", "systemPrompt", "userPrompt", "raw", "parseStatus", "ts"];
  const dumpOut = run("scripts/testing/tm4_rawllm_dump.mjs", ["--run", runId], "raw LLM prompt/response dump");
  report.sections.rawLlmCapture = {
    file: path.relative(ROOT, rawllmFile),
    calls: rawRows.length,
    byPhase: rawRows.reduce((a, r) => ((a[r.phase] = (a[r.phase] || 0) + 1), a), {}),
    fieldCoverage: Object.fromEntries(need.map((f) => [f, rawRows.filter((r) => r[f] !== undefined).length])),
    parseFailures: rawRows.filter((r) => r.parseStatus !== "ok").length,
    acceptedClaimsTotal: rawRows.reduce((s, r) => s + (r.acceptedClaimCount || 0), 0),
    dumpArtifacts: dumpOut.match(/artifacts\/\S+/g) || [],
  };

  // ── 6. Evidence stance/budget verification ───────────────────────────────
  const evOut = run("scripts/dev/tm4_run_preview_evidence.mjs", ["--run", runId, "--limit", String(LIMIT)], `evidence (--limit ${LIMIT}, budgeted)`);
  const budgetLine = evOut.match(/Budget: keeping .*/)?.[0] || "";
  const sidecar2 = JSON.parse(await fs.readFile(path.join(RUNS_DIR, `${runId}.json`), "utf-8"));
  const evRun = sidecar2.evidenceRuns[sidecar2.evidenceRuns.length - 1];

  const { query } = await import(path.join(BACKEND, "src/db/pool.js"));
  const legacy = await query(`SELECT rcl.stance, rcl.scrape_status, COUNT(*) n, AVG(rcl.support_level) sup FROM reference_claim_links rcl
    JOIN content_claims cc ON cc.claim_id=rcl.claim_id AND cc.content_id=?
    JOIN content_relations cr ON cr.reference_content_id=rcl.reference_content_id AND cr.content_id=?
    GROUP BY rcl.stance, rcl.scrape_status`, [contentId, contentId]);
  const target = await query(`SELECT l.stance, COUNT(*) n, AVG(l.bearing_score) b FROM evaluation_target_evidence_links l
    JOIN claim_evaluation_targets t ON t.evaluation_target_id=l.evaluation_target_id WHERE t.content_id=? GROUP BY l.stance`, [contentId]);
  const legacyTotal = legacy.reduce((s, r) => s + r.n, 0);
  const legacyInsufficient = legacy.filter((r) => r.stance === "insufficient").reduce((s, r) => s + r.n, 0);

  report.sections.evidenceVerification = {
    budgetLine,
    engineReferences: evRun.engineReferenceCount,
    keptReferences: evRun.keptReferenceCount,
    keptStubs: evRun.keptStubCount ?? null,
    droppedByBudget: evRun.droppedReferenceCount,
    failedCandidates: (evRun.failedCandidates || []).length,
    budgetConfig: evRun.budget,
    legacyLinkStance: legacy.map((r) => ({ stance: r.stance, scrape: r.scrape_status, n: r.n, avgSupport: Number(r.sup).toFixed(3) })),
    legacyLinksTotal: legacyTotal,
    legacyInsufficientShare: legacyTotal ? `${Math.round((legacyInsufficient / legacyTotal) * 100)}%` : "n/a",
    targetLinkStance: target.map((r) => ({ stance: r.stance, n: r.n, avgBearing: Number(r.b).toFixed(2) })),
    multiLinkNote: "One kept reference produces one reference_claim_link PER claim it supports (ref.claims array), so link count can exceed reference count; assertion-level links land separately in evaluation_target_evidence_links/reference_claim_task_links.",
    baselineComparison: {
      before: BASELINE_17162,
      after: { insufficientShare: legacyTotal ? `${Math.round((legacyInsufficient / legacyTotal) * 100)}%` : "n/a", total: legacyTotal },
      pass: legacyTotal === 0 || legacyInsufficient / legacyTotal < 0.5,
    },
  };

  // ── 7. Fetch-layer failure report ─────────────────────────────────────────
  const classify = (f) => {
    const r = `${f.reason} ${f.url}`;
    if (/pdf/i.test(r)) return "pdf";
    if (/timeout|abort/i.test(r)) return "timeout";
    if (/HTTP 40[13]|forbidden|denied|captcha|cloudflare/i.test(r)) return "bot_wall";
    if (/HTTP 4\d\d|HTTP 5\d\d/i.test(r)) return "http_error";
    if (/Insufficient text/i.test(r)) return "js_heavy_or_thin_extraction";
    if (/abstract/i.test(r)) return "abstract_only_api";
    if (/parse/i.test(r)) return "parser_error";
    return "other";
  };
  const fails = (evRun.failedCandidates || []).map((f) => ({ ...f, failureType: classify(f), domain: (f.url.match(/https?:\/\/([^/]+)/) || [])[1] || "" }));
  report.sections.fetchLayer = {
    failedCount: fails.length,
    byType: fails.reduce((a, f) => ((a[f.failureType] = (a[f.failureType] || 0) + 1), a), {}),
    byDomain: Object.entries(fails.reduce((a, f) => ((a[f.domain] = (a[f.domain] || 0) + 1), a), {})).sort((x, y) => y[1] - x[1]).slice(0, 10),
    failures: fails,
    stageNote: "All failures occur DURING extraction (fetcher.getText after bearing admitted the candidate); snippet bearing has already passed them, which is why failures become snippet_only stubs rather than silent drops.",
    recommendedNextHarness: "Focused fetch harness: replay evRun.failedCandidates URLs through fetcher.getText variants (direct fetch / puppeteer / wayback / PDF extractor) and measure recovery rate per failure type before touching the pipeline.",
  };

  // ── verification + cleanup ────────────────────────────────────────────────
  const verifyOut = run("scripts/dev/tm4_verify_persistence.mjs", ["--run", runId], "persistence verification");
  report.sections.persistenceChecks = { pass: /ALL PERSISTENCE\/GATING CHECKS PASS/.test(verifyOut), tail: verifyOut.split("\n").slice(-10).join("\n") };
  let cleanup = "kept (--keep)";
  if (!KEEP) {
    const cl = run("scripts/dev/tm4_cleanup_preview.mjs", ["--run", runId, "--apply"], "cleanup");
    cleanup = /Cleanup complete — content rows left: 0/.test(cl) ? "cleaned (0 rows left)" : "CLEANUP INCOMPLETE — check manually";
  }
  report.sections.cleanup = { disposableRun: runId, contentId, status: cleanup };

  // ── write artifacts ───────────────────────────────────────────────────────
  const jsonPath = path.join(ARTIFACTS, `tm4_master_tuning_verification_${TS}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

  const s = report.sections;
  const md = `---
title: TM4 Master Tuning Verification
date: ${new Date().toISOString()}
run: ${runId}
content_id: ${contentId}
tags: [tm4, claim-quality, evidence-verification, tuning]
---

# TM4 Master Tuning Verification — ${TS}

> [!info] Rerun
> \`node scripts/testing/tm4_master_tuning_verification.mjs\` — full disposable loop (materialize → audits → evidence --limit ${LIMIT} → cleanup). Machine-readable twin: \`${path.relative(ROOT, jsonPath)}\`

## 1. Current fix inventory

| file | change | pre-existed | verify |
|---|---|---|---|
${s.fixInventory.fixes.map((f) => `| \`${f.file}\` | ${f.change} | ${f.preExisted} | ${f.verify} |`).join("\n")}

> [!note] git status (nothing staged by this workflow)
> \`\`\`
> ${gitStatus.split("\n").filter((l) => !/assets\/(images|documents)/.test(l)).join("\n> ")}
> \`\`\`

## 2. Selector verification (fresh run ${runId})

Selection: **${s.selectorVerification.selectionSummary.selectedCount}/${s.selectorVerification.selectionSummary.rawClaimCount}** · pillars **${s.selectorVerification.selectionSummary.pillarCoverage}** · clusters ${s.selectorVerification.selectionSummary.clusterCoverage} · inverts ${s.selectorVerification.selectionSummary.invertClaimsSelected}

${s.selectorVerification.thompsonPass ? `> [!success] Thompson/CDC/MMR claim IS selected
${s.selectorVerification.thompsonSelected.map((t) => `> - rank ${t.rank} \`${t.sourceClaimId}\` (cluster ${t.cluster}): "${t.text}"\n>   - rationale: ${t.rationale}`).join("\n")}` : `> [!failure] Thompson/CDC/MMR claim NOT selected — selector regression`}

| rank | id | cluster | score | claim |
|---|---|---|---|---|
${s.selectorVerification.selected.map((c) => `| ${c.rank} | ${c.sourceClaimId} | ${c.cluster || "—"}${c.dissimilarSiblingAdmission ? " ⚡" : ""} | ${c.score} | ${c.text.replace(/\|/g, "/")} |`).join("\n")}

⚡ = admitted past the cluster cap as a **dissimilar cluster sibling** (the unrelated-CDC-statistic suppression class is structurally closed: similar siblings still blocked, dissimilar ones admitted with the similarity printed in the rationale).

**Suspicious omitted high-value claims (no selected claim shares their cluster):**
${s.selectorVerification.suspiciousOmittedHighValue.map((c) => `- \`${c.sourceClaimId}\` (${c.cluster || "no cluster"}): "${c.text}" — ${c.reason}`).join("\n") || "- none"}

## 3. Anchor/probe separation audit

Loose \`auditProbeTags\` and predicate-requiring \`claimBearingAnchorFamilies\` are now separate (\`${s.anchorProbeAudit.taxonomyModule}\`). A selected claim passes a family only when the claim-bearing predicate survived:

| rank | id | probe tags (loose) | claim-bearing families (pass) | topic-only ⚠️ |
|---|---|---|---|---|
${s.anchorProbeAudit.selectedClaims.map((c) => `| ${c.rank} | ${c.sourceClaimId} | ${c.auditProbeTags.join(", ") || "—"} | ${c.claimBearingFamilies.join(", ") || "—"} | ${c.topicOnlyWarnings.join(", ") || "—"} |`).join("\n")}

## 4. Declarativeness audit

${s.declarativenessAudit.map((d) => `### rank ${d.rank} — ${d.sourceClaimId} (score ${d.declarativeScore}/5${d.topicSummaryWarning ? " — ⚠️ TOPIC SUMMARY" : ""})
- selected: "${d.selectedClaimText}"
- raw: "${d.rawVisibleClaimText}"${d.embeddedSubstantiveClaim ? `\n- embedded substantive: "${d.embeddedSubstantiveClaim}"` : ""}
- targets: ${d.targetTexts.map((t) => `"${t}"`).join(" · ") || "—"}
- sentences [${d.sourceSentenceIds.join(",")}] · excerpt: "${d.canonicalExcerpt.slice(0, 160)}…"
- predicate ${d.hardPredicatePreserved ? "✅" : "❌"} · entities ${d.namedEntitiesPreserved ? "✅" : `❌ lost: ${d.lostEntities.join(", ")}`} · numbers ${d.numbersPreserved ? "✅" : "❌"} · softening ${d.softeningIntroduced ? `❌ (${d.softeningPhrases.join("; ")})` : "✅ none introduced"}`).join("\n\n")}

## 5. Raw LLM prompt/response capture

> [!${s.rawLlmCapture.fieldCoverage.systemPrompt === s.rawLlmCapture.calls ? "success" : "warning"}] \`${s.rawLlmCapture.file}\` — ${s.rawLlmCapture.calls} calls (${Object.entries(s.rawLlmCapture.byPhase).map(([k, v]) => `${k}: ${v}`).join(", ")}), parse failures: ${s.rawLlmCapture.parseFailures}, accepted claims: ${s.rawLlmCapture.acceptedClaimsTotal}

Field coverage: ${Object.entries(s.rawLlmCapture.fieldCoverage).map(([f, n]) => `${f} ${n}/${s.rawLlmCapture.calls}`).join(" · ")}

Readable dump: ${s.rawLlmCapture.dumpArtifacts.map((a) => `\`${a}\``).join(", ")}

## 6. Evidence stance/budget verification (--limit ${LIMIT})

\`${s.evidenceVerification.budgetLine}\`

- engine references: ${s.evidenceVerification.engineReferences} · kept: ${s.evidenceVerification.keptReferences} (stubs: ${s.evidenceVerification.keptStubs}) · dropped by budget: ${s.evidenceVerification.droppedByBudget} · failed candidates (fetch layer): ${s.evidenceVerification.failedCandidates}
- budget: ${JSON.stringify(s.evidenceVerification.budgetConfig)}

**Legacy \`reference_claim_links\` stance (${s.evidenceVerification.legacyLinksTotal} links, insufficient share ${s.evidenceVerification.legacyInsufficientShare}):**
| stance | scrape | n | avg support_level |
|---|---|---|---|
${s.evidenceVerification.legacyLinkStance.map((r) => `| ${r.stance} | ${r.scrape} | ${r.n} | ${r.avgSupport} |`).join("\n")}

**Target-level \`evaluation_target_evidence_links\`:**
| stance | n | avg bearing |
|---|---|---|
${s.evidenceVerification.targetLinkStance.map((r) => `| ${r.stance} | ${r.n} | ${r.avgBearing} |`).join("\n")}

> [!${s.evidenceVerification.baselineComparison.pass ? "success" : "failure"}] Before/after: baseline ${BASELINE_17162.runId} had ${BASELINE_17162.legacyLinks.insufficient}/${BASELINE_17162.legacyLinks.total} (${BASELINE_17162.legacyLinks.insufficientShare}) insufficient legacy links — ${BASELINE_17162.legacyLinks.note}. This run: **${s.evidenceVerification.legacyInsufficientShare} insufficient**.

${s.evidenceVerification.multiLinkNote}

## 7. Fetch-layer failure report

${s.fetchLayer.failedCount} failed candidates. ${s.fetchLayer.stageNote}

| failure type | n |
|---|---|
${Object.entries(s.fetchLayer.byType).map(([t, n]) => `| ${t} | ${n} |`).join("\n")}

Top failing domains: ${s.fetchLayer.byDomain.map(([d, n]) => `${d} (${n})`).join(", ") || "—"}

<details><summary>All failures</summary>

${s.fetchLayer.failures.map((f) => `- [${f.failureType}] ${f.url} — ${f.reason}`).join("\n")}

</details>

> [!todo] Next harness
> ${s.fetchLayer.recommendedNextHarness}

## Persistence + cleanup

> [!${s.persistenceChecks.pass ? "success" : "failure"}] Persistence/gating checks ${s.persistenceChecks.pass ? "ALL PASS" : "FAILED"} · disposable run ${runId} (content ${contentId}): **${s.cleanup.status}**
`;
  const mdPath = path.join(ARTIFACTS, `tm4_master_tuning_verification_${TS}.md`);
  await fs.writeFile(mdPath, md);
  console.log(`\n✅ Master verification report:\n   ${mdPath}\n   ${jsonPath}`);
  process.exit(0);
}

main().catch((e) => { console.error("❌ FATAL:", e.message || e); process.exit(1); });
