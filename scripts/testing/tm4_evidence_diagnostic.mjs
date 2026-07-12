#!/usr/bin/env node
//
// tm4_evidence_diagnostic.mjs — READ-ONLY evidence-run diagnostics for Codex.
//
// Does NOT run the evidence engine and does NOT modify the engine, fetchers,
// budget, or persistence. It reads:
//   • the preview-run sidecar (Phase 3 targets + evidenceRuns[] + queryExpansion)
//   • the engine stdout log (optional --engine-log) to see the ACTUAL queries
//     the engine planned ([QUERY_PLAN] lines)
//   • the DB link tables (reference_claim_links, evaluation_target_evidence_links)
// …and emits three artifacts:
//   artifacts/tm4_target_query_trace_<ts>.csv     (per Phase 3 target: TM4 fields
//                                                  vs what the engine queried)
//   artifacts/tm4_fetch_failure_report_<ts>.{md,json}
//   artifacts/tm4_evidence_run_<ts>.{md,json}
//
// Usage:
//   node scripts/testing/tm4_evidence_diagnostic.mjs --run <previewRunId|latest> \
//     [--engine-log <path to captured evidence stdout>]

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const RUNS_DIR = path.join(BACKEND, "logs/tm4_preview_runs");
const ARTIFACTS = path.join(ROOT, "artifacts");
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
dotenv.config({ path: path.join(BACKEND, ".env") });

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const RUN = getArg("--run") || "latest";
const ENGINE_LOG = getArg("--engine-log");

const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const domainOf = (u) => (String(u || "").match(/https?:\/\/([^/]+)/) || [])[1] || "";

// Fetch-failure classifier (same taxonomy the master verification uses).
function classifyFailure(f) {
  const r = `${f.reason || ""} ${f.url || ""} ${f.scrapeStatus || ""}`;
  if (/pdf/i.test(r)) return "pdf_extraction_failure";
  if (/timeout|abort|etimedout/i.test(r)) return "timeout";
  if (/HTTP 40[13]|forbidden|denied|captcha|cloudflare|403|401|blocked/i.test(r)) return "bot_wall";
  if (/HTTP 4\d\d|HTTP 5\d\d|\b4\d\d\b|\b5\d\d\b/i.test(r)) return "http_error";
  if (/insufficient text|thin|too short|empty/i.test(r)) return "js_heavy_or_thin_extraction";
  if (/abstract/i.test(r)) return "abstract_only_api";
  if (/parse|selector/i.test(r)) return "parser_error";
  return "other";
}

// Parse [QUERY_PLAN] {json} lines from a captured engine stdout log.
function parseEnginePlans(logText) {
  const plans = [];
  for (const line of String(logText || "").split("\n")) {
    const m = line.match(/\[QUERY_PLAN\]\s+(\{.*\})\s*$/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[1]);
      if (j.evaluation_target_id) plans.push(j);
    } catch { /* skip non-JSON QUERY_PLAN header lines */ }
  }
  return plans;
}

async function main() {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  let sidecarPath;
  if (RUN === "latest") {
    const files = (await fs.readdir(RUNS_DIR)).filter((f) => /^tm4prev-.*\.json$/.test(f) && !f.includes(".rawllm") && !f.includes(".cleaned")).sort();
    sidecarPath = path.join(RUNS_DIR, files[files.length - 1]);
  } else {
    sidecarPath = path.join(RUNS_DIR, `${RUN}.json`);
  }
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf-8"));
  const contentId = sidecar.contentId;
  const selected = sidecar.tm4.selectedEvaluationClaims || [];
  const targets = sidecar.tm4.targets || [];
  const queryExpansion = sidecar.tm4.queryExpansion || [];
  const evRun = (sidecar.evidenceRuns || [])[sidecar.evidenceRuns.length - 1] || null;
  const expByClaim = new Map(queryExpansion.map((q) => [q.selectedClaimId, q]));
  const selById = new Map(selected.map((c) => [c.claimId, c]));

  // Engine plan (what the engine ACTUALLY queried), if a log was captured.
  let plans = [];
  if (ENGINE_LOG) {
    plans = parseEnginePlans(await fs.readFile(ENGINE_LOG, "utf-8").catch(() => ""));
  }
  // Plans key by target text (DB target ids differ from sidecar S-ids), so we
  // join on normalized target text.
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const planByText = new Map();
  for (const p of plans) planByText.set(norm(p.target_text), p);

  // ---- DB: evidence results (read-only) ------------------------------------
  const { query } = await import(path.join(BACKEND, "src/db/pool.js"));
  const isPreview = await query(
    `SELECT content_id FROM content WHERE content_id = ? AND topic = 'tm4-preview'`, [contentId]
  ).catch(() => []);
  let legacyLinks = [], targetLinks = [], keptRefs = [];
  if (isPreview.length) {
    legacyLinks = await query(
      `SELECT rcl.claim_id, rcl.reference_content_id, rcl.stance, rcl.scrape_status,
              rcl.support_level, rcl.score, rcl.confidence, c.url, c.content_name
         FROM reference_claim_links rcl
         JOIN content_claims cc ON cc.claim_id = rcl.claim_id AND cc.content_id = ?
         JOIN content_relations cr ON cr.reference_content_id = rcl.reference_content_id AND cr.content_id = ?
    LEFT JOIN content c ON c.content_id = rcl.reference_content_id
        ORDER BY rcl.support_level DESC`, [contentId, contentId]).catch(() => []);
    targetLinks = await query(
      `SELECT l.evaluation_target_id, l.reference_content_id, l.stance, l.bearing_score,
              l.confidence, t.target_type, t.target_text, t.claim_id, c.url, c.content_name
         FROM evaluation_target_evidence_links l
         JOIN claim_evaluation_targets t ON t.evaluation_target_id = l.evaluation_target_id
    LEFT JOIN content c ON c.content_id = l.reference_content_id
        WHERE t.content_id = ?
        ORDER BY l.bearing_score DESC`, [contentId]).catch(() => []);
    keptRefs = await query(
      `SELECT cr.reference_content_id, c.url, c.content_name
         FROM content_relations cr JOIN content c ON c.content_id = cr.reference_content_id
        WHERE cr.content_id = ?`, [contentId]).catch(() => []);
  }
  const targetLinkByDbId = new Map();
  for (const l of targetLinks) {
    if (!targetLinkByDbId.has(l.evaluation_target_id)) targetLinkByDbId.set(l.evaluation_target_id, []);
    targetLinkByDbId.get(l.evaluation_target_id).push(l);
  }
  // Join sidecar target → DB target by normalized target text.
  const dbTargetByText = new Map();
  for (const l of targetLinks) dbTargetByText.set(norm(l.target_text), l.evaluation_target_id);

  // ---- Artifact 1: target query trace CSV ----------------------------------
  const COLS = [
    "selectedClaimId", "selectedVisibleClaimText", "targetId", "targetType", "targetText",
    "scoreTransform", "searchEligible", "verdictEligible",
    "primaryQueryText", "queryHints_expansionTerms", "queryHints_documentAffordanceHints",
    "queryExpansionSourceClaimIds", "siblingEvidenceHints",
    "bearingCriteria_mustMatch", "bearingCriteria_shouldMatch", "bearingCriteria_rejectIfOnly", "bearingCriteria_weak",
    "ENGINE_actualQueries", "ENGINE_usedEnrichedPrimaryQuery", "ENGINE_usedDistinctiveExpansion",
    "targetLevelStance", "targetLevelBearing", "legacyStances",
  ];
  const rows = [];
  for (const t of targets) {
    const sel = selById.get(t.sourceClaimId) || {};
    const exp = expByClaim.get(t.sourceClaimId);
    const qh = t.queryHints || {};
    const bc = t.bearingCriteria || {};
    const plan = planByText.get(norm(t.targetText));
    const engineQueries = plan ? plan.queries : [];
    const pqt = qh.primaryQueryText || "";
    // "used the enriched query" = the engine issued the FULL enriched
    // primaryQueryText (not just the targetText prefix it shares).
    const usedPqt = pqt && engineQueries.some((q) => norm(q).includes(norm(pqt)));
    // DISTINCTIVE expansion terms = expansion terms whose words are NOT already
    // in the claim's own text/targetText. Matching only these avoids the
    // false-positive where an expansion term (e.g. "CDC") coincides with the
    // claim's own vocabulary.
    // Generic document-class words (study/report/…) are NOT distinctive: they
    // also appear in the sibling-sourced disambiguation target's own text, so a
    // match on them would falsely imply the enriched query was used.
    const GENERIC_DOC = new Set(["study", "studies", "report", "document", "record", "records", "dataset", "database", "article", "paper", "review", "analysis", "reference", "referenced", "identify", "underlying", "related", "disambiguation"]);
    const baseVocab = new Set([...norm(`${t.targetText} ${sel.visibleClaimText || ""}`).split(" "), ...GENERIC_DOC]);
    const expTerms = (qh.expansionTerms || []);
    const distinctiveExp = expTerms.filter((term) => norm(term).split(" ").some((w) => w.length > 2 && !baseVocab.has(w)));
    const usedExp = distinctiveExp.length && engineQueries.some((q) => {
      const qn = norm(q);
      return distinctiveExp.some((term) => norm(term).split(" ").filter((w) => w.length > 2 && !baseVocab.has(w)).some((w) => qn.includes(w)));
    });
    const dbTid = dbTargetByText.get(norm(t.targetText));
    const tl = dbTid ? (targetLinkByDbId.get(dbTid) || []) : [];
    rows.push({
      selectedClaimId: t.sourceClaimId,
      selectedVisibleClaimText: sel.visibleClaimText || "",
      targetId: t.targetId, targetType: t.targetType, targetText: t.targetText,
      scoreTransform: t.scoreTransform, searchEligible: t.searchEligible !== false ? "yes" : "no",
      verdictEligible: t.verdictEligible ? "yes" : "no",
      primaryQueryText: pqt,
      queryHints_expansionTerms: (qh.expansionTerms || []).join("|"),
      queryHints_documentAffordanceHints: (qh.documentAffordanceHints || t.documentAffordanceHints || []).join("|"),
      queryExpansionSourceClaimIds: (t.queryExpansionSourceClaimIds || qh.queryExpansionSourceClaimIds || []).join("|"),
      siblingEvidenceHints: (qh.siblingEvidenceHints || []).join(" ⏸ "),
      bearingCriteria_mustMatch: (bc.mustMatch || []).join("|"),
      bearingCriteria_shouldMatch: (bc.shouldMatch || []).join("|"),
      bearingCriteria_rejectIfOnly: (bc.rejectIfOnly || []).join("|"),
      bearingCriteria_weak: bc.weak ? "yes" : "",
      ENGINE_actualQueries: engineQueries.join(" ⏸ "),
      ENGINE_usedEnrichedPrimaryQuery: plan ? (usedPqt ? "yes" : "NO") : "(no engine log)",
      ENGINE_usedDistinctiveExpansion: plan ? (distinctiveExp.length ? (usedExp ? "yes" : "NO") : "n/a") : "(no engine log)",
      targetLevelStance: tl.map((l) => l.stance).join("|"),
      targetLevelBearing: tl.map((l) => Number(l.bearing_score).toFixed(2)).join("|"),
      legacyStances: "",
    });
  }
  const csvPath = path.join(ARTIFACTS, `tm4_target_query_trace_${TS}.csv`);
  await fs.writeFile(csvPath, "﻿" + [COLS.join(","), ...rows.map((r) => COLS.map((c) => csvCell(r[c])).join(","))].join("\r\n"));

  // ---- Artifact 2: fetch failure report ------------------------------------
  const failed = (evRun?.failedCandidates || []).map((f) => ({ ...f, failureType: classifyFailure(f), domain: domainOf(f.url) }));
  const failByType = failed.reduce((a, f) => ((a[f.failureType] = (a[f.failureType] || 0) + 1), a), {});
  const failByDomain = Object.entries(failed.reduce((a, f) => ((a[f.domain] = (a[f.domain] || 0) + 1), a), {})).sort((x, y) => y[1] - x[1]).slice(0, 15);
  const fetchReport = {
    timestamp: TS, run: sidecar.previewRunId, contentId,
    engineReferenceCount: evRun?.engineReferenceCount ?? null,
    keptReferenceCount: evRun?.keptReferenceCount ?? null,
    keptStubCount: evRun?.keptStubCount ?? null,
    droppedReferenceCount: evRun?.droppedReferenceCount ?? null,
    failedCandidateCount: failed.length,
    failuresByType: failByType,
    topFailingDomains: failByDomain,
    failures: failed,
    note: "Failures occur DURING extraction (fetcher.getText) after snippet bearing already admitted the candidate; that is why they become snippet_only stubs rather than silent drops.",
  };
  await fs.writeFile(path.join(ARTIFACTS, `tm4_fetch_failure_report_${TS}.json`), JSON.stringify(fetchReport, null, 2));
  const fetchMd = `# TM4 Fetch-Failure Report — ${TS}

Run \`${sidecar.previewRunId}\` · content ${contentId}

- engine references: **${fetchReport.engineReferenceCount}** · kept: **${fetchReport.keptReferenceCount}** (stubs ${fetchReport.keptStubCount}) · dropped by budget: ${fetchReport.droppedReferenceCount} · **failed candidates: ${fetchReport.failedCandidateCount}**

## Failures by type
| type | n |
|---|---|
${Object.entries(failByType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `| ${t} | ${n} |`).join("\n") || "| (none) | 0 |"}

## Top failing domains
${failByDomain.map(([d, n]) => `- ${d || "(no domain)"} (${n})`).join("\n") || "- none"}

## All failed candidates
${failed.map((f) => `- [${f.failureType}] ${f.domain} — ${f.url}\n  - reason: ${f.reason}${f.scrapeStatus ? ` · scrapeStatus: ${f.scrapeStatus}` : ""}`).join("\n") || "- none"}

> ${fetchReport.note}
`;
  await fs.writeFile(path.join(ARTIFACTS, `tm4_fetch_failure_report_${TS}.md`), fetchMd);

  // ---- Artifact 3: evidence run diagnostic ---------------------------------
  const legacyByStance = legacyLinks.reduce((a, l) => ((a[l.stance] = (a[l.stance] || 0) + 1), a), {});
  const legacyByScrape = legacyLinks.reduce((a, l) => ((a[l.scrape_status] = (a[l.scrape_status] || 0) + 1), a), {});
  const targetByStance = targetLinks.reduce((a, l) => ((a[l.stance] = (a[l.stance] || 0) + 1), a), {});
  const legacyTotal = legacyLinks.length;
  const legacyInsufficient = legacyLinks.filter((l) => l.stance === "insufficient").length;
  const claimsWithEvidence = new Set(legacyLinks.map((l) => l.claim_id));
  const goodLinks = legacyLinks.filter((l) => l.stance !== "insufficient" && l.scrape_status === "full").slice(0, 8);
  const stubLinks = legacyLinks.filter((l) => l.scrape_status === "snippet_only").slice(0, 8);

  const hadEngineLog = plans.length > 0;
  // Restrict the consumption verdict to ENRICHED targets that the engine
  // actually planned. (For un-enriched targets primaryQueryText == targetText,
  // so a match there is trivial and would be misleading.)
  const enrichedPlannedRows = rows.filter((r) =>
    (r.queryExpansionSourceClaimIds || "").length && r.ENGINE_actualQueries);
  const enrichedUsedEnrichedQuery = enrichedPlannedRows.filter((r) => r.ENGINE_usedEnrichedPrimaryQuery === "yes").length;
  const enrichedUsedDistinctiveExp = enrichedPlannedRows.filter((r) => r.ENGINE_usedDistinctiveExpansion === "yes").length;

  const diag = {
    timestamp: TS, run: sidecar.previewRunId, contentId,
    selectedClaimCount: selected.length,
    targetCount: targets.length,
    searchEligibleTargetCount: targets.filter((t) => t.searchEligible !== false).length,
    verdictEligibleTargetCount: targets.filter((t) => t.verdictEligible).length,
    targetsByType: targets.reduce((a, t) => ((a[t.targetType] = (a[t.targetType] || 0) + 1), a), {}),
    scoreTransformByType: targets.reduce((a, t) => ((a[t.scoreTransform] = (a[t.scoreTransform] || 0) + 1), a), {}),
    claimsWithQueryExpansion: queryExpansion.filter((q) => (q.queryExpansionSourceClaimIds || []).length).length,
    evidence: {
      engineReferenceCount: evRun?.engineReferenceCount ?? null,
      keptReferenceCount: evRun?.keptReferenceCount ?? null,
      keptStubCount: evRun?.keptStubCount ?? null,
      keptFullCount: evRun ? (evRun.keptReferenceCount - (evRun.keptStubCount || 0)) : null,
      droppedReferenceCount: evRun?.droppedReferenceCount ?? null,
      failedCandidateCount: failed.length,
    },
    legacyLinks: { total: legacyTotal, insufficient: legacyInsufficient, insufficientShare: legacyTotal ? `${Math.round(legacyInsufficient / legacyTotal * 100)}%` : "n/a", byStance: legacyByStance, byScrapeStatus: legacyByScrape },
    targetLevelLinks: { total: targetLinks.length, byStance: targetByStance },
    claimsWithEvidence: [...claimsWithEvidence],
    consumption: {
      hadEngineLog,
      enrichedTargetsPlanned: enrichedPlannedRows.length,
      enrichedTargets_engineUsedEnrichedQuery: hadEngineLog ? enrichedUsedEnrichedQuery : null,
      enrichedTargets_engineUsedDistinctiveExpansion: hadEngineLog ? enrichedUsedDistinctiveExp : null,
      note: "Of the ENRICHED targets the engine planned, how many issued queries actually containing the enriched primaryQueryText / the DISTINCTIVE sibling-expansion terms (terms not already in the claim's own text). See per-target columns ENGINE_usedEnrichedPrimaryQuery / ENGINE_usedDistinctiveExpansion.",
    },
  };
  await fs.writeFile(path.join(ARTIFACTS, `tm4_evidence_run_${TS}.json`), JSON.stringify(diag, null, 2));

  const md = `# TM4 Evidence-Run Diagnostic — ${TS}

Run \`${sidecar.previewRunId}\` · content **${contentId}** · ${selected.length} selected claims · ${targets.length} Phase 3 targets (${diag.searchEligibleTargetCount} search-eligible, ${diag.verdictEligibleTargetCount} verdict-eligible)

## Critical question — does the engine consume TM4 Phase 3 targets + query hints?
- Engine consumes **target TEXT + target TYPE**: **yes** — query lanes are built from \`targetText\` (attribution/substantive/study_identity) plus the engine's OWN entity/study resolution.
- Engine consumes the **enriched \`primary_query_text\`** (the expansion tail appended by TM4): **NO** — of ${enrichedPlannedRows.length} enriched targets the engine planned, **${enrichedUsedEnrichedQuery}** issued the enriched query and **${enrichedUsedDistinctiveExp}** issued the DISTINCTIVE expansion terms (terms not already in the claim's own text). The engine rebuilds \`searchText\` from the substantive \`targetText\`, discarding the appended expansion.
- Engine consumes **\`queryHints\` / \`bearingCriteria\` / \`queryExpansionSourceClaimIds\`**: **NO** — \`loadTm4EvidenceCandidates\` does not even SELECT \`query_hints_json\`/\`bearing_criteria_json\`, and grep shows the engine never references those fields.
- **Partial exception (the one path that DID reach evidence):** the sibling-sourced **study_identity disambiguation target's targetText** (e.g. "Identify the underlying document/record … CDC MMR vaccine study/document referenced by the article") is a real search-eligible target, so its text becomes a query lane. That is how sibling document-affordance leaks into evidence today — via the disambiguation target's text, NOT via the expansion query terms (which carry the specific leads like "reworked study", "1986 Act", "industry capture").
- **Conclusion:** for a plain substantive target (targetText == visible claim text for endorsed claims), the engine effectively falls back to **visible-claim behavior**; the TM4 query-hint / bearing-criteria / sidecar-sibling-expansion layer is **not wired into the engine's query builder**.

## Target/type + polarity
- targets by type: ${JSON.stringify(diag.targetsByType)}
- scoreTransform by type: ${JSON.stringify(diag.scoreTransformByType)}
- claims with sidecar query expansion available: ${diag.claimsWithQueryExpansion}

## Evidence outcome
- engine references: **${diag.evidence.engineReferenceCount}** · kept: **${diag.evidence.keptReferenceCount}** (full ${diag.evidence.keptFullCount}, stubs ${diag.evidence.keptStubCount}) · dropped by budget: ${diag.evidence.droppedReferenceCount} · failed candidates: **${diag.evidence.failedCandidateCount}**
- legacy \`reference_claim_links\`: **${legacyTotal}** total, **${diag.legacyLinks.insufficientShare} insufficient** · byStance ${JSON.stringify(legacyByStance)} · byScrape ${JSON.stringify(legacyByScrape)}
- target-level \`evaluation_target_evidence_links\`: **${targetLinks.length}** · byStance ${JSON.stringify(targetByStance)}
- selected claims that got ≥1 evidence link: **${claimsWithEvidence.size}/${selected.length}**

## Good evidence links (full text, stance-decisive)
${goodLinks.map((l) => `- [${l.stance}] support ${Number(l.support_level).toFixed(2)} · ${domainOf(l.url)} — ${l.url}`).join("\n") || "- none"}

## Snippet stubs kept (scrape failed, snippet retained)
${stubLinks.map((l) => `- [${l.stance}] ${domainOf(l.url)} — ${l.url}`).join("\n") || "- none"}

## Artifacts
- target query trace: \`artifacts/tm4_target_query_trace_${TS}.csv\`
- fetch failure report: \`artifacts/tm4_fetch_failure_report_${TS}.{md,json}\`
- this diagnostic: \`artifacts/tm4_evidence_run_${TS}.{md,json}\`
`;
  await fs.writeFile(path.join(ARTIFACTS, `tm4_evidence_run_${TS}.md`), md);

  console.log(`✅ Evidence diagnostics written (run ${sidecar.previewRunId}, content ${contentId}):`);
  console.log(`   artifacts/tm4_target_query_trace_${TS}.csv`);
  console.log(`   artifacts/tm4_fetch_failure_report_${TS}.{md,json}`);
  console.log(`   artifacts/tm4_evidence_run_${TS}.{md,json}`);
  console.log(`   engine-log parsed: ${hadEngineLog ? plans.length + " QUERY_PLAN entries" : "NONE (pass --engine-log to observe actual queries)"}`);
  console.log(`   legacy links ${legacyTotal} (${diag.legacyLinks.insufficientShare} insufficient) · target links ${targetLinks.length} · failed ${failed.length}`);
  process.exit(0);
}

main().catch((e) => { console.error("❌ FATAL:", e.stack || e); process.exit(1); });
