#!/usr/bin/env node

/**
 * TM4 SELECTOR TRACE — read-only replay of the Phase 2b selector (v2).
 *
 * Replays the PRODUCTION selector (backend/src/core/tm4Phase2bSelector.js) on
 * a frozen preview-run sidecar's raw claims, then emits:
 *
 *   artifacts/tm4_selector_algorithm_trace_<ts>.md    human-readable trace
 *   artifacts/tm4_selector_algorithm_trace_<ts>.json  machine-readable twin
 *   artifacts/tm4_selector_score_matrix_<ts>.csv      per-claim score matrix
 *   artifacts/tm4_v2_replay_package_<ts>.json         derived package (new
 *       selected set + re-run Phase 3 targets) for tm4_claim_quality_eval.mjs
 *
 * No DB writes. No LLM calls (Phase 3 targetizer is deterministic). Gold CSV,
 * if supplied, is used for REPORTING only — it is never fed to the selector.
 *
 * Usage:
 *   node scripts/testing/tm4_selector_trace.mjs \
 *     [--sidecar backend/logs/tm4_preview_runs/<runId>.json]  (default: latest)
 *     [--gold artifacts/tm4_claim_correction_DEMO_EDITED.csv]
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const ARTIFACTS = path.join(ROOT, "artifacts");
const RUNS_DIR = path.join(ROOT, "backend/logs/tm4_preview_runs");
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

// Same minimal CSV parser dialect as tm4_claim_quality_eval.mjs
function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') q = false; else field += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(field); field = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Reconstruct phase2Context from the recorded sidecar (thesis from the
 * selection summary; pillars from recorded per-claim assignments; clusters
 * from recorded per-claim clusterId/anchors with the deterministic
 * cluster-score formula from deterministicClaimClustering.scoreAndRankClusters).
 */
function reconstructPhase2Context(sidecar) {
  const raw = sidecar.tm4.rawClaims || [];
  const thesis = sidecar.selectionSummary?.articleThesis || sidecar.tm4.selectionSummary?.articleThesis || "";
  const pillars = [...new Set(raw.map((c) => c.phase2PillarId).filter(Boolean))]
    .sort()
    .map((pillarId) => ({ pillarId, pillarText: "" }));
  const byCluster = new Map();
  for (const c of raw) {
    if (!c.phase2ClusterId) continue;
    if (!byCluster.has(c.phase2ClusterId)) byCluster.set(c.phase2ClusterId, { anchors: new Set(), sections: new Set(), n: 0 });
    const b = byCluster.get(c.phase2ClusterId);
    for (const a of c.clusterAnchors || []) b.anchors.add(a);
    const sec = Number((String(c.claimId).match(/^S(\d+)/) || [])[1]);
    if (Number.isFinite(sec)) b.sections.add(sec);
    b.n++;
  }
  const clusters = [...byCluster.entries()].map(([clusterId, b]) => {
    let score = b.n * 2 + Math.max(0, 10 - b.sections.size * 2);
    for (const anchor of b.anchors) {
      if (anchor.length > 10) score += 3;
      if (/[A-Z]{2,}/.test(anchor)) score += 2;
      if (/Act\b/.test(anchor)) score += 3;
      if (/\d{4}/.test(anchor)) score += 2;
    }
    return { clusterId, anchors: [...b.anchors], clusterScore: score };
  });
  return { thesis, pillars, clusters };
}

async function main() {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  let sidecarPath = getArg("--sidecar");
  if (!sidecarPath) {
    const files = (await fs.readdir(RUNS_DIR)).filter((f) => /^tm4prev-.*\.json$/.test(f) && !f.includes(".rawllm")).sort();
    sidecarPath = path.join(RUNS_DIR, files[files.length - 1]);
  }
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf-8"));
  const rawClaims = sidecar.tm4.rawClaims || [];
  const beforeSelected = sidecar.tm4.selectedEvaluationClaims || [];
  const phase2Context = reconstructPhase2Context(sidecar);

  console.log(`▶ Replaying selector v2 on ${path.basename(sidecarPath)} (${rawClaims.length} raw claims)`);

  const { selectTm4EvaluationClaims } = await import(path.join(BACKEND, "src/core/tm4Phase2bSelector.js"));
  const { anchorFamiliesFor, probeTagsFor } = await import("./lib/tm4AnchorTaxonomy.mjs");
  const { auditDeclarativeness } = await import("./lib/tm4Declarativeness.mjs");

  const result = selectTm4EvaluationClaims(rawClaims, phase2Context);
  const { selectedEvaluationClaims, nonSelectedClaims, selectionSummary, selectionDiagnostics } = result;

  // Generic sidecar evidence-affordance query expansion: selected claims
  // inherit search hints from stronger-affordance unselected siblings.
  const { computeEvidenceAffordanceExpansion } = await import(path.join(BACKEND, "src/core/tm4EvidenceAffordanceExpansion.js"));
  const nonSelectedReasons = new Map(nonSelectedClaims.map((c) => [c.claimId, c.suppressionReason]));
  const rebuttalFrame = selectionSummary.rebuttalFrame === true;
  const { expansionByClaimId, diagnostics: queryExpansionDiagnostics } = computeEvidenceAffordanceExpansion(
    selectedEvaluationClaims, rawClaims, { ...phase2Context, rebuttalFrame }, { nonSelectedReasons }
  );

  // Phase 3 (deterministic) on the NEW selected set → derived package for the eval.
  const { targetizeClaimOccurrences } = await import(path.join(BACKEND, "src/core/phase3Targetizer.js"));
  const { targets, diagnostics: targetDiagnostics } = targetizeClaimOccurrences(selectedEvaluationClaims, { expansionByClaimId });

  // Gold reporting (never fed into the selector).
  const goldPath = getArg("--gold");
  let goldReport = null;
  if (goldPath) {
    const gold = parseCsv(await fs.readFile(goldPath, "utf-8"));
    const hp = gold.filter((r) => r.shouldBeSelected === "yes" && Number(r.selectionPriority) >= 4);
    const norm = (t) => String(t || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const jac = (a, b) => {
      const wa = new Set(norm(a).split(" ").filter(Boolean)), wb = new Set(norm(b).split(" ").filter(Boolean));
      if (!wa.size || !wb.size) return 0;
      let sh = 0; for (const w of wa) if (wb.has(w)) sh++;
      return sh / (wa.size + wb.size - sh);
    };
    goldReport = hp.map((g) => {
      const goldText = g.correctedSelectedClaimText || g.visibleClaimText;
      const best = selectedEvaluationClaims
        .map((c) => ({ id: c.claimId, sim: jac(goldText, c.visibleClaimText) }))
        .sort((a, b) => b.sim - a.sim)[0];
      return { rowId: g.rowId, priority: g.selectionPriority, goldText: goldText.slice(0, 140), bestSelected: best?.id, bestSim: Number((best?.sim ?? 0).toFixed(3)), covered: (best?.sim ?? 0) >= 0.3 };
    });
  }

  // ---- score matrix CSV ------------------------------------------------------
  const rawById = new Map(rawClaims.map((c) => [c.claimId, c]));
  const STRUCT_COLS = ["cluster", "pillar", "phase2Role", "claimForm", "articleUse", "scoreTransformHint", "speakerOrSource", "reconciliationGroup"];
  const DIAG_COLS = ["diag_anchorFamiliesPassing", "diag_probeTags", "diag_declarativeScore", "diag_topicSummaryWarning"];
  const rows = selectionDiagnostics.rows.map((d) => {
    const c = rawById.get(d.sourceClaimId) || {};
    const hay = `${c.visibleClaimText || ""} ${c.embeddedSubstantiveClaim || ""}`;
    const audit = auditDeclarativeness({ selectedText: c.visibleClaimText || "", rawText: c.visibleClaimText || "", embeddedSubstantiveClaim: c.embeddedSubstantiveClaim || "" });
    return {
      ...d,
      embeddedSubstantiveClaim: c.embeddedSubstantiveClaim || "",
      cluster: c.phase2ClusterId || "",
      pillar: c.phase2PillarId || "",
      phase2Role: c.phase2Role || "",
      claimForm: c.claimForm || "",
      articleUse: c.articleUse || "",
      scoreTransformHint: c.scoreTransformHint || "",
      speakerOrSource: c.speakerOrSource || "",
      reconciliationGroup: c.reconciliation?.groupId || "",
      diag_anchorFamiliesPassing: anchorFamiliesFor(hay).filter((f) => f.pass).map((f) => f.family).join("|"),
      diag_probeTags: probeTagsFor(hay).join("|"),
      diag_declarativeScore: audit.declarativeScore,
      diag_topicSummaryWarning: audit.topicSummaryWarning ? "YES" : "",
    };
  });
  const DIAG_ROW_COLS = Object.keys(selectionDiagnostics.rows[0]);
  const COLS = [
    ...DIAG_ROW_COLS.slice(0, 2), "embeddedSubstantiveClaim", ...DIAG_ROW_COLS.slice(2),
    ...STRUCT_COLS, ...DIAG_COLS,
  ];
  const columnClasses = {
    ...selectionDiagnostics.columnClasses,
    meritRank: "diagnostic_only",
    embeddedSubstantiveClaim: "diagnostic_only",
    ...Object.fromEntries(STRUCT_COLS.map((c) => [c, "diagnostic_only"])),
    ...Object.fromEntries(DIAG_COLS.map((c) => [c, c.includes("anchorFamilies") || c.includes("probeTags") ? "gold_eval_only" : "diagnostic_only"])),
  };
  const csv = [COLS.join(","), ...rows.map((r) => COLS.map((c) => csvCell(r[c])).join(","))].join("\r\n");
  const csvPath = path.join(ARTIFACTS, `tm4_selector_score_matrix_${TS}.csv`);
  await fs.writeFile(csvPath, "﻿" + csv);

  // ---- derived package for the quality eval ---------------------------------
  const derived = JSON.parse(JSON.stringify(sidecar));
  derived.derivedFrom = { sidecar: path.relative(ROOT, sidecarPath), replayTimestamp: TS, note: "selector v2 replay — NOT a live materialization; selected set + targets recomputed, raw claims unchanged" };
  derived.tm4.selectedEvaluationClaims = selectedEvaluationClaims;
  derived.tm4.nonSelectedClaims = nonSelectedClaims;
  derived.tm4.targets = targets;
  derived.tm4.diagnostics = targetDiagnostics;
  derived.tm4.queryExpansion = queryExpansionDiagnostics;
  derived.tm4.selectionSummary = selectionSummary;
  derived.selectionSummary = selectionSummary;
  derived.counts = { ...(derived.counts || {}), workspaceClaims: selectedEvaluationClaims.length, selectedClaims: selectedEvaluationClaims.length, targets: targets.length };
  const derivedPath = path.join(ARTIFACTS, `tm4_v2_replay_package_${TS}.json`);
  await fs.writeFile(derivedPath, JSON.stringify(derived, null, 2));

  // ---- before/after ----------------------------------------------------------
  const beforeIds = beforeSelected.map((c) => c.claimId);
  const afterIds = selectedEvaluationClaims.map((c) => c.claimId);
  const added = afterIds.filter((id) => !beforeIds.includes(id));
  const removed = beforeIds.filter((id) => !afterIds.includes(id));

  const dimSpread = (key) => {
    const vals = rows.filter((r) => r[key] !== "").map((r) => Number(r[key]));
    const distinct = [...new Set(vals.map((v) => v.toFixed(2)))];
    return { min: Math.min(...vals), max: Math.max(...vals), distinctValues: distinct.length };
  };
  const spreads = Object.fromEntries(
    ["articleCentrality", "verificationWorthiness", "specificity", "intrinsicScore"].map((k) => [k, dimSpread(k)])
  );

  const report = {
    timestamp: TS,
    sidecar: path.relative(ROOT, sidecarPath),
    selectorVersion: 2,
    phase2Context: { thesis: phase2Context.thesis, pillars: phase2Context.pillars.map((p) => p.pillarId), clusters: phase2Context.clusters.length },
    orderIndependence: selectionSummary.orderIndependence,
    dimensionSpreads: spreads,
    before: { count: beforeIds.length, ids: beforeIds },
    after: { count: afterIds.length, ids: afterIds },
    added, removed,
    repairs: selectionSummary.repairs,
    evaluator: selectionSummary.evaluator,
    goldReport,
    columnClasses,
    selected: selectedEvaluationClaims.map((c) => ({
      rank: c.selectionRank, id: c.claimId, score: c.selectionScore,
      family: c.selectionBreakdown.claimBearingFamily, moves: c.selectionBreakdown.reasoningMoves,
      centrality: c.selectionBreakdown.articleCentrality, worthiness: c.selectionBreakdown.verificationWorthiness,
      pillar: c.phase2PillarId, cluster: c.phase2ClusterId, text: c.visibleClaimText,
      rationale: c.selectionRationale,
    })),
    targetDiagnostics,
  };
  const jsonPath = path.join(ARTIFACTS, `tm4_selector_algorithm_trace_${TS}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

  const md = `# TM4 Selector v2 — Algorithm Trace ${TS}

**Sidecar replayed:** \`${report.sidecar}\` (${rawClaims.length} raw claims) · **selector:** staged portfolio v2 (\`backend/src/core/tm4Phase2bSelector.js\`)

Stages: 1 dedup → 2 order-independent intrinsic scoring → 3 reasoning-move classification → 4 thesis-spine coverage → 5 predicate-aware portfolio pruning → 6 evaluator/repair (≤2 iter) → 7 persist (pass or acknowledged).

## Validation
- **Order independence:** ${report.orderIndependence.pass ? "✅ PASS (forward and reversed scoring identical)" : `❌ FAIL — ${report.orderIndependence.mismatches} mismatches`}
- **Dimension spreads** (degeneracy check — previous selector had centrality/pillar/worthiness flat):
${Object.entries(spreads).map(([k, s]) => `  - ${k}: ${s.min.toFixed(2)}–${s.max.toFixed(2)} across ${s.distinctValues} distinct values`).join("\n")}
- **Evaluator:** ${report.evaluator.status}${report.evaluator.failures.length ? ` — ${report.evaluator.failures.map((f) => f.type).join(", ")}` : ""}
- **Repairs applied:** ${report.repairs.length ? report.repairs.map((r) => `iter${r.iteration} ${r.action} ${r.addId || ""}${r.removeId ? `↔${r.removeId}` : ""} (${r.failureType})`).join("; ") : "none needed"}

## Before → After
- before (recorded run): ${beforeIds.join(", ")}
- after (v2 replay): ${afterIds.join(", ")}
- **added:** ${added.join(", ") || "—"} · **removed:** ${removed.join(", ") || "—"}

${goldReport ? `## Gold high-priority coverage (reporting only — gold never fed to the selector)
${goldReport.map((g) => `- ${g.covered ? "✅" : "❌"} [prio ${g.priority}] "${g.goldText}…" → best selected ${g.bestSelected} (sim ${g.bestSim})`).join("\n")}
` : ""}
## Selected set (v2)
| rank | id | intrinsic | centrality | worthiness | family | pillar | claim |
|---|---|---|---|---|---|---|---|
${report.selected.map((c) => `| ${c.rank} | ${c.id} | ${c.score} | ${c.centrality} | ${c.worthiness} | ${c.family} | ${c.pillar || "—"} | ${String(c.text).replace(/\|/g, "/").slice(0, 110)} |`).join("\n")}

## Column provenance (score matrix \`${path.basename(csvPath)}\`)
${Object.entries(columnClasses).map(([c, cls]) => `- \`${c}\`: ${cls}`).join("\n")}

Companion files: \`${path.relative(ROOT, jsonPath)}\` · \`${path.relative(ROOT, csvPath)}\` · derived eval package \`${path.relative(ROOT, derivedPath)}\`
`;
  const mdPath = path.join(ARTIFACTS, `tm4_selector_algorithm_trace_${TS}.md`);
  await fs.writeFile(mdPath, md);

  console.log(`✅ Selected ${afterIds.length}/${rawClaims.length} — added ${added.join(",") || "—"} removed ${removed.join(",") || "—"}`);
  console.log(`   evaluator: ${report.evaluator.status} · order-independent: ${report.orderIndependence.pass}`);
  console.log(`   ${mdPath}\n   ${jsonPath}\n   ${csvPath}\n   ${derivedPath}`);
}

main().catch((e) => { console.error("❌ FATAL:", e.stack || e); process.exit(1); });
