#!/usr/bin/env node

/**
 * TM4 CLAIM QUALITY EVAL — correction-aware acceptance gates. Read-only.
 *
 * Compares a TM4 package (preview-run sidecar) against the manually corrected
 * gold CSV (and/or generated tuning rules) and enforces the acceptance gates:
 *
 *   G1  no selected claim is a pure topic summary
 *   G2  hard predicates from gold-corrected claims do not disappear
 *   G3  named entities from gold-corrected claims do not disappear without reason
 *   G4  Thompson-style allegations preserve BOTH attribution and substantive targets
 *   G5  selected claims are declarative/falsifiable unless typed
 *       evidence_landscape/study_identity/inference
 *   G6  gold high-priority claims (shouldBeSelected=yes, selectionPriority>=4)
 *       are selected unless explicitly rejected with a reason
 *   G7  raw claims persisted, Workspace/evidence uses selected only
 *
 * Usage:
 *   node scripts/testing/tm4_claim_quality_eval.mjs \
 *     [--package backend/logs/tm4_preview_runs/<runId>.json]   (default: latest)
 *     [--gold artifacts/tm4_claim_correction_<ts>.csv]         (edited gold CSV)
 *
 * Output: artifacts/tm4_claim_quality_eval_<timestamp>.{md,json}; exit 1 on gate failure.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { anchorFamiliesFor } from "./lib/tm4AnchorTaxonomy.mjs";
import { auditDeclarativeness } from "./lib/tm4Declarativeness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const RUNS_DIR = path.join(ROOT, "backend/logs/tm4_preview_runs");
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const norm = (t) => String(t || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
const jaccard = (a, b) => {
  const wa = new Set(norm(a).split(" ").filter(Boolean)), wb = new Set(norm(b).split(" ").filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let sh = 0; for (const w of wa) if (wb.has(w)) sh++;
  return sh / (wa.size + wb.size - sh);
};
const ENTITY_RE = /\b([A-Z][a-z]+ [A-Z][a-z]+|\bCDC\b|\bFDA\b|\bWHO\b|thimerosal|aluminum|formaldehyde|MMR|DTaP|VAERS)\b/g;

// Minimal CSV parser (same dialect the generator writes)
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

async function main() {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  let pkgPath = getArg("--package");
  if (!pkgPath) {
    const files = (await fs.readdir(RUNS_DIR)).filter((f) => /^tm4prev-.*\.json$/.test(f) && !f.includes(".rawllm")).sort();
    pkgPath = path.join(RUNS_DIR, files[files.length - 1]);
  }
  const sidecar = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
  const selected = sidecar.tm4.selectedEvaluationClaims || [];
  const raw = sidecar.tm4.rawClaims || [];
  const targets = sidecar.tm4.targets || [];
  const rawById = new Map(raw.map((c) => [c.claimId, c]));

  const goldPath = getArg("--gold");
  const gold = goldPath ? parseCsv(await fs.readFile(goldPath, "utf-8")) : [];
  const goldCorrected = gold.filter((r) => (r.correctedSelectedClaimText || r.correctedSubstantiveClaim || "").trim());
  const goldHighPriority = gold.filter((r) => r.shouldBeSelected === "yes" && Number(r.selectionPriority) >= 4);

  const findings = { tooSoft: [], topicSummaries: [], lostEntities: [], lostPredicates: [], anchorFamilyPass: [], vagueSelected: [], targetTypeMismatches: [], missedHighPriority: [], softQueryHints: [] };
  const gates = [];

  // G1/G5: declarativeness of every selected claim
  for (const c of selected) {
    const rawC = rawById.get(c.claimId) || {};
    const typedException = (targets.filter((t) => t.sourceClaimId === c.claimId) || [])
      .every((t) => ["evidence_landscape", "study_identity", "inference"].includes(t.targetType)) &&
      targets.some((t) => t.sourceClaimId === c.claimId);
    // Opponent/invert claims are public-health slogans the article rebuts. The
    // visible text is intentionally a slogan; its falsifiable proposition is
    // the embedded substantive claim (which is what gets targetized). So a
    // slogan with an embedded proposition is NOT a topic-summary/vague failure.
    const opponentEmbedded =
      (c.articleUse === "used_as_opponent_claim" || rawC.articleUse === "used_as_opponent_claim" ||
        c.scoreTransformHint === "invert" || rawC.scoreTransformHint === "invert") &&
      Boolean((c.embeddedSubstantiveClaim || rawC.embeddedSubstantiveClaim || "").trim());
    const exempt = typedException || opponentEmbedded;
    const audit = auditDeclarativeness({ selectedText: c.visibleClaimText, rawText: rawC.visibleClaimText || "", embeddedSubstantiveClaim: c.embeddedSubstantiveClaim || "" });
    if (audit.topicSummaryWarning && !exempt) findings.topicSummaries.push({ id: c.claimId, rank: c.selectionRank, text: c.visibleClaimText });
    if (audit.softeningIntroduced) findings.tooSoft.push({ id: c.claimId, phrases: audit.softeningPhrases, text: c.visibleClaimText });
    if (!audit.namedEntitiesPreserved) findings.lostEntities.push({ id: c.claimId, lost: audit.lostEntities, text: c.visibleClaimText });
    if (!audit.hardPredicatePreserved) findings.lostPredicates.push({ id: c.claimId, text: c.visibleClaimText });
    if (audit.declarativeScore < 2.5 && !exempt) findings.vagueSelected.push({ id: c.claimId, score: audit.declarativeScore, text: c.visibleClaimText });
    findings.anchorFamilyPass.push({ id: c.claimId, rank: c.selectionRank, families: anchorFamiliesFor(`${c.visibleClaimText} ${c.embeddedSubstantiveClaim || ""}`).filter((f) => f.pass).map((f) => f.family) });
  }
  gates.push({ gate: "G1 no selected claim is a pure topic summary", pass: findings.topicSummaries.length === 0, detail: findings.topicSummaries });
  gates.push({ gate: "G5 selected claims declarative/falsifiable (unless typed exception)", pass: findings.vagueSelected.length === 0, detail: findings.vagueSelected });

  // G2/G3: gold predicates + entities survive somewhere in the selected set
  for (const g of goldCorrected) {
    const goldText = g.correctedSelectedClaimText || g.correctedSubstantiveClaim;
    const best = selected.map((c) => ({ c, sim: jaccard(goldText, `${c.visibleClaimText} ${c.embeddedSubstantiveClaim || ""}`) })).sort((a, b) => b.sim - a.sim)[0];
    if (!best || best.sim < 0.25) {
      findings.lostPredicates.push({ id: g.rowId, gold: goldText, bestMatchSim: best?.sim ?? 0, note: "gold-corrected proposition has no close selected counterpart" });
      continue;
    }
    const goldEntities = new Set((goldText.match(ENTITY_RE) || []).map((e) => e.toLowerCase()));
    const selEntities = new Set((`${best.c.visibleClaimText} ${best.c.embeddedSubstantiveClaim || ""}`.match(ENTITY_RE) || []).map((e) => e.toLowerCase()));
    const lost = [...goldEntities].filter((e) => !selEntities.has(e));
    if (lost.length) findings.lostEntities.push({ id: g.rowId, gold: goldText, matched: best.c.claimId, lost });
  }
  gates.push({ gate: "G2 gold hard predicates do not disappear", pass: !goldCorrected.length || !findings.lostPredicates.some((f) => f.gold), detail: findings.lostPredicates.filter((f) => f.gold), skipped: !goldCorrected.length });
  gates.push({ gate: "G3 gold named entities do not disappear", pass: !goldCorrected.length || !findings.lostEntities.some((f) => f.gold), detail: findings.lostEntities.filter((f) => f.gold), skipped: !goldCorrected.length });

  // G4: Thompson-style allegations carry attribution + substantive targets
  const thompsonClaims = selected.filter((c) => anchorFamiliesFor(`${c.visibleClaimText} ${c.embeddedSubstantiveClaim || ""}`).some((f) => f.pass && /thompson|destruction/.test(f.family)));
  const g4Detail = thompsonClaims.map((c) => {
    const tt = targets.filter((t) => t.sourceClaimId === c.claimId).map((t) => t.targetType);
    return { id: c.claimId, targetTypes: tt, pass: tt.includes("attribution") && tt.includes("substantive") };
  });
  gates.push({ gate: "G4 Thompson-style allegations keep attribution AND substantive targets", pass: g4Detail.every((d) => d.pass), detail: g4Detail, skipped: !thompsonClaims.length });

  // G6: gold high-priority claims selected
  for (const g of goldHighPriority) {
    const goldText = g.correctedSelectedClaimText || g.visibleClaimText;
    const best = selected.map((c) => ({ c, sim: jaccard(goldText, c.visibleClaimText) })).sort((a, b) => b.sim - a.sim)[0];
    if (!best || best.sim < 0.3) findings.missedHighPriority.push({ id: g.rowId, priority: g.selectionPriority, gold: goldText, bestSim: best?.sim ?? 0 });
  }
  gates.push({ gate: "G6 gold high-priority claims are selected", pass: findings.missedHighPriority.length === 0, detail: findings.missedHighPriority, skipped: !goldHighPriority.length });

  // Target-type + query-hint regressions vs gold
  for (const g of gold.filter((r) => r.desiredTargetType && r.targetId)) {
    const t = targets.find((x) => x.targetId === g.targetId);
    if (t && t.targetType !== g.desiredTargetType) findings.targetTypeMismatches.push({ targetId: g.targetId, is: t.targetType, desired: g.desiredTargetType });
  }
  for (const g of gold.filter((r) => r.correctedPrimaryQueryText && r.targetId)) {
    const t = targets.find((x) => x.targetId === g.targetId);
    if (t && jaccard(t.queryHints?.primaryQueryText || "", g.correctedPrimaryQueryText) < 0.4) {
      findings.softQueryHints.push({ targetId: g.targetId, is: t.queryHints?.primaryQueryText, desired: g.correctedPrimaryQueryText });
    }
  }

  // G7: persistence shape
  gates.push({
    gate: "G7 raw persisted, Workspace/evidence selected-only",
    pass: raw.length >= 40 && selected.length >= 8 && selected.length <= 12 && (sidecar.counts?.workspaceClaims ?? selected.length) === selected.length,
    detail: { raw: raw.length, selected: selected.length, workspaceClaims: sidecar.counts?.workspaceClaims },
  });

  const allPass = gates.every((g) => g.pass);
  const out = { timestamp: TS, package: path.relative(ROOT, pkgPath), gold: goldPath ? path.relative(ROOT, goldPath) : null, goldEditedRows: goldCorrected.length, gates, findings };
  const jsonPath = path.join(ARTIFACTS, `tm4_claim_quality_eval_${TS}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(out, null, 2));
  const mdPath = path.join(ARTIFACTS, `tm4_claim_quality_eval_${TS}.md`);
  await fs.writeFile(mdPath, `# TM4 Claim Quality Eval — ${TS}

Package: \`${out.package}\` · Gold: ${out.gold ? `\`${out.gold}\` (${out.goldEditedRows} corrected rows)` : "_none supplied — gold gates skipped_"}

| gate | result |
|---|---|
${gates.map((g) => `| ${g.gate} | ${g.skipped ? "⏭ skipped (no data)" : g.pass ? "✅ PASS" : "❌ FAIL"} |`).join("\n")}

## Anchor-family coverage of selected claims
${findings.anchorFamilyPass.map((f) => `- rank ${f.rank} \`${f.id}\`: ${f.families.join(", ") || "(no claim-bearing family)"}`).join("\n")}

## Findings
${Object.entries(findings).filter(([k]) => k !== "anchorFamilyPass").map(([k, v]) => `### ${k} (${v.length})\n${v.map((x) => `- ${JSON.stringify(x)}`).join("\n") || "- none"}`).join("\n\n")}

${allPass ? "✅ **ALL GATES PASS**" : "❌ **GATE FAILURES — see findings**"}
`);
  console.log(`${allPass ? "✅ ALL GATES PASS" : "❌ GATE FAILURES"} — ${gates.filter((g) => g.pass).length}/${gates.length}`);
  console.log(`   ${mdPath}\n   ${jsonPath}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error("❌ FATAL:", e.message || e); process.exit(1); });
