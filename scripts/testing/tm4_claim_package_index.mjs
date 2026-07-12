#!/usr/bin/env node

/**
 * TM4 CLAIM PACKAGE INDEX — read-only scanner.
 *
 * Scans existing TM4 artifacts (readiness packages, preview-run sidecars,
 * Phase 1 full-claims dumps, Phase 3 targets files) and produces an index we
 * can use as a menu for prompt/reducer tuning:
 *
 *   artifacts/tm4_claim_package_index_<timestamp>.md
 *   artifacts/tm4_claim_package_index_<timestamp>.json
 *
 * Usage: node scripts/testing/tm4_claim_package_index.mjs
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const LOGS = path.join(ROOT, "backend/logs");
const RUNS = path.join(LOGS, "tm4_preview_runs");
const ARTIFACTS = path.join(ROOT, "artifacts");
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const ANCHORS = {
  Thompson: /thompson/i,
  Hooker: /hooker/i,
  MMR: /\bMMR\b/i,
  autism: /autism/i,
  CDC: /\bCDC\b/,
  thimerosal: /thimerosal/i,
  Simpsonwood: /simpsonwood/i,
  Verstraeten: /verstraeten/i,
  aluminum: /aluminum/i,
  tomato: /tomato/i,
  "blood-brain barrier": /blood.brain barrier/i,
  "1986 Act": /\b1986\b/,
  liability: /liabilit/i,
};

function anchorCoverage(texts) {
  const joined = texts.join("\n");
  return Object.fromEntries(Object.entries(ANCHORS).map(([k, re]) => [k, re.test(joined)]));
}

const claimTexts = (claims) => (claims || []).map((c) => [c.visibleClaimText, c.embeddedSubstantiveClaim, c.searchText].filter(Boolean).join(" "));

async function scanReadinessPackages() {
  const files = (await fs.readdir(LOGS).catch(() => [])).filter((f) => /^tm4_phase3_readiness_package_.*\.json$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(LOGS, f), "utf-8"));
      const claims = pkg.claims || [];
      out.push({
        kind: "readiness_package",
        path: `backend/logs/${f}`,
        timestamp: pkg.timestamp || f.match(/(\d{4}-\d{2}-\d{2}T[\d-]+)/)?.[1] || null,
        title: pkg.articleTitle || null,
        fixture: pkg.fixture || null,
        contentId: null,
        rawPhase1ClaimCount: claims.length,
        reconciledCount: pkg.reconciliation ? claims.length : null,
        reconciliationGroups: pkg.reconciliation?.totalGroups ?? pkg.reconciliation?.duplicateGroups?.length ?? null,
        phase2PillarCount: pkg.phase2?.pillars?.length ?? null,
        phase2ClusterCount: pkg.phase2?.deterministicClusters?.length ?? null,
        strongCandidateCount: pkg.strongCandidateClaimIds?.length ?? pkg.metrics?.strongCandidateCount ?? null,
        selectedEvaluationClaimCount: null,
        phase3TargetCount: null,
        anchorCoverage: anchorCoverage(claimTexts(claims)),
        rawLlmResponsePath: null,
        notes: ["pre-Phase 2b package (no selection stage)", "raw LLM responses not captured"],
      });
    } catch (e) { out.push({ kind: "readiness_package", path: `backend/logs/${f}`, error: e.message }); }
  }
  return out;
}

async function scanSidecars() {
  const files = (await fs.readdir(RUNS).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
  const out = [];
  for (const f of files) {
    try {
      const s = JSON.parse(await fs.readFile(path.join(RUNS, f), "utf-8"));
      const raw = s.tm4?.rawClaims || s.tm4?.claims || [];
      const selected = s.tm4?.selectedEvaluationClaims || [];
      const targets = s.tm4?.targets || [];
      out.push({
        kind: "preview_run_sidecar",
        path: `backend/logs/tm4_preview_runs/${f}`,
        cleaned: f.includes(".cleaned"),
        timestamp: s.createdAt || null,
        title: "TM4 Preview — Public Health’s “Truth” About Vaccines PART 1",
        fixture: s.fixture || null,
        contentId: s.contentId ?? null,
        tm4ClaimPackageId: s.tm4ClaimPackageId ?? null,
        rawPhase1ClaimCount: raw.length || s.counts?.rawClaimOccurrences || s.counts?.claimOccurrences || null,
        reconciledCount: raw.length || null,
        phase2PillarCount: null,
        selectedEvaluationClaimCount: selected.length || s.counts?.selectedClaims || s.counts?.workspaceClaims || null,
        phase3TargetCount: targets.length || s.counts?.tm4Targets || null,
        evidenceEligibleTargetCount: targets.filter((t) => t.searchEligible).length || null,
        verdictEligibleTargetCount: targets.filter((t) => t.verdictEligible).length || null,
        evidenceRuns: (s.evidenceRuns || []).length,
        anchorCoverage: anchorCoverage(claimTexts(raw.length ? raw : selected)),
        rawLlmResponsePath: null,
        notes: [
          ...(selected.length ? [] : ["pre-Phase 2b sidecar (all claims materialized)"]),
          ...(f.includes(".cleaned") ? ["run cleaned up — DB rows deleted"] : []),
          "raw LLM responses not captured",
        ],
      });
    } catch (e) { out.push({ kind: "preview_run_sidecar", path: `backend/logs/tm4_preview_runs/${f}`, error: e.message }); }
  }
  return out;
}

async function scanPhase1Dumps() {
  const files = (await fs.readdir(LOGS).catch(() => [])).filter((f) => /^tm4_phase1_full_claims_.*\.json$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    try {
      const d = JSON.parse(await fs.readFile(path.join(LOGS, f), "utf-8"));
      const claims = d.claims || [];
      out.push({
        kind: "phase1_full_claims_dump",
        path: `backend/logs/${f}`,
        timestamp: d.timestamp || null,
        rawPhase1ClaimCount: claims.length,
        anchorCoverage: anchorCoverage(claimTexts(claims)),
        notes: ["Phase 1 only (parsed claims; no raw LLM text)"],
      });
    } catch (e) { out.push({ kind: "phase1_full_claims_dump", path: `backend/logs/${f}`, error: e.message }); }
  }
  return out;
}

async function scanTargetFiles() {
  const files = (await fs.readdir(LOGS).catch(() => [])).filter((f) => /^tm4_phase3_targets_.*\.json$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    try {
      const d = JSON.parse(await fs.readFile(path.join(LOGS, f), "utf-8"));
      const targets = d.targets || [];
      out.push({
        kind: "phase3_targets",
        path: `backend/logs/${f}`,
        timestamp: d.timestamp || null,
        sourcePackage: d.sourcePackage || null,
        phase3TargetCount: targets.length,
        evidenceEligibleTargetCount: targets.filter((t) => t.searchEligible).length,
        verdictEligibleTargetCount: targets.filter((t) => t.verdictEligible).length,
        targetsByType: d.diagnostics?.targetsByType || null,
        anchorCoverage: anchorCoverage(targets.map((t) => `${t.targetText} ${t.visibleClaimText || ""}`)),
        notes: [],
      });
    } catch (e) { out.push({ kind: "phase3_targets", path: `backend/logs/${f}`, error: e.message }); }
  }
  return out;
}

function coverageStr(cov) {
  if (!cov) return "—";
  const hit = Object.entries(cov).filter(([, v]) => v).map(([k]) => k);
  return `${hit.length}/${Object.keys(cov).length}: ${hit.join(", ") || "none"}`;
}

async function main() {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  const entries = [
    ...(await scanReadinessPackages()),
    ...(await scanSidecars()),
    ...(await scanPhase1Dumps()),
    ...(await scanTargetFiles()),
  ];

  const jsonPath = path.join(ARTIFACTS, `tm4_claim_package_index_${TS}.json`);
  await fs.writeFile(jsonPath, JSON.stringify({ timestamp: TS, count: entries.length, entries }, null, 2));

  const md = `# TM4 Claim Package Index — ${TS}

${entries.length} artifacts scanned. Raw LLM responses are NOT captured by any current stage (see notes).

${entries.map((e) => e.error
    ? `## ⚠️ ${e.path}\n- error: ${e.error}`
    : `## ${e.kind} — \`${e.path}\`
- timestamp: ${e.timestamp || "—"}${e.title ? `\n- title: ${e.title}` : ""}${e.fixture ? `\n- fixture: ${e.fixture}` : ""}${e.contentId != null ? `\n- content_id: ${e.contentId}${e.cleaned ? " (cleaned)" : ""}` : ""}${e.tm4ClaimPackageId != null ? `\n- tm4_claim_package_id: ${e.tm4ClaimPackageId}` : ""}
- raw Phase 1 claims: ${e.rawPhase1ClaimCount ?? "—"} · reconciled: ${e.reconciledCount ?? "—"} · pillars: ${e.phase2PillarCount ?? "—"} · strong candidates: ${e.strongCandidateCount ?? "—"}
- selected: ${e.selectedEvaluationClaimCount ?? "—"} · targets: ${e.phase3TargetCount ?? "—"} · search-eligible: ${e.evidenceEligibleTargetCount ?? "—"} · verdict-eligible: ${e.verdictEligibleTargetCount ?? "—"}
- anchors: ${coverageStr(e.anchorCoverage)}
${(e.notes || []).map((n) => `- note: ${n}`).join("\n")}`).join("\n\n")}
`;
  const mdPath = path.join(ARTIFACTS, `tm4_claim_package_index_${TS}.md`);
  await fs.writeFile(mdPath, md);

  console.log(`✅ Indexed ${entries.length} artifacts`);
  console.log(`   ${jsonPath}\n   ${mdPath}`);
}

main().catch((e) => { console.error("❌ FATAL:", e); process.exit(1); });
