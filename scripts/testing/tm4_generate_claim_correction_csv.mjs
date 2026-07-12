#!/usr/bin/env node

/**
 * TM4 CLAIM CORRECTION CSV GENERATOR — read-only.
 *
 * Turns claim detail dumps and/or preview-run sidecars into a spreadsheet-
 * editable correction sheet with ACTUAL claim text and manual correction
 * columns on the far right.
 *
 * Usage:
 *   node scripts/testing/tm4_generate_claim_correction_csv.mjs \
 *     [--dump artifacts/tm4_claim_detail_dump_<ts>.json] \
 *     [--sidecar backend/logs/tm4_preview_runs/<runId>.json] ...
 *   (defaults: latest claim detail dump artifact + latest sidecar)
 *
 * Output:
 *   artifacts/tm4_claim_correction_<timestamp>.csv
 *   artifacts/tm4_claim_correction_<timestamp>.json
 *   artifacts/tm4_claim_correction_readme_<timestamp>.md
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { probeTagsFor, anchorFamiliesFor, bestAnchorFamilyGuess } from "./lib/tm4AnchorTaxonomy.mjs";
import { auditDeclarativeness } from "./lib/tm4Declarativeness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const RUNS_DIR = path.join(ROOT, "backend/logs/tm4_preview_runs");
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const args = process.argv.slice(2);
const collectArgs = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));

const SYSTEM_COLUMNS = [
  "rowId", "rowType", "packagePath", "packageTimestamp", "contentId", "taskId", "tm4ClaimPackageId", "runId",
  "sourceStage", "sourceClaimId", "claimId", "contentClaimId", "selectedEvaluationClaimId", "evaluationTargetId", "targetId",
  "selectedStatus", "selectionRank", "omissionReason", "suspiciousOmission",
  "visibleClaimText", "embeddedSubstantiveClaim", "selectedClaimText", "representativeClaimText",
  "targetText", "primaryQueryText", "queryHints", "bearingCriteria",
  "canonicalExcerpt", "sourceSentenceIds", "claimForm", "articleUse", "scoreTransform", "speakerSource",
  "pillar", "cluster", "selectionReason", "targetType", "searchEligible", "verdictEligible",
  "evidenceEntered", "evidenceExclusionReason",
  "auditProbeTags", "claimBearingAnchorFamily", "anchorFamilyGuess",
  "softeningWarning", "predicatePreserved", "namedEntitiesPreserved", "declarativeScore",
  // Selected-row roll-up of Phase 3 target + evidence-search behavior, so a
  // human can filter by `selected` without losing sight of query/target logic.
  // (The authoritative per-target detail still lives on phase3_target rows.)
  "targetCount", "searchEligibleTargetCount", "verdictEligibleTargetCount",
  "targetTypesSummary", "scoreTransformsSummary",
  "primarySubstantiveTargetText", "primarySubstantiveQueryText", "primaryBearingCriteriaSummary",
  "queryExpansionSourceClaimIds", "siblingEvidenceHints", "documentAffordanceHints",
  "hasAttributionTarget", "hasSubstantiveTarget", "hasStudyIdentityTarget", "hasEvidenceLandscapeTarget",
];
const MANUAL_COLUMNS = [
  "manualAction", "correctedSelectedClaimText", "correctedSubstantiveClaim", "correctedAttributionText",
  "correctedTargetText", "correctedPrimaryQueryText", "correctedBearingCriteria", "correctedQueryHints",
  "correctedAnchorFamily", "shouldBeSelected", "selectionPriority", "falsifiabilityScore",
  "articleCentralityScore", "evidenceSearchabilityScore", "desiredTargetType", "desiredScoreTransform",
  "correctionLabels", "manualNotes",
];
export const ALL_COLUMNS = [...SYSTEM_COLUMNS, ...MANUAL_COLUMNS];

const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  s = s.replace(/\r?\n/g, "\n"); // keep newlines; quote below
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function baseRow() {
  const r = {};
  for (const c of ALL_COLUMNS) r[c] = "";
  return r;
}

function enrich(row, textForAudit, rawText, embedded) {
  const hay = `${textForAudit} ${embedded || ""}`;
  row.auditProbeTags = probeTagsFor(hay).join("|");
  const fams = anchorFamiliesFor(hay);
  row.claimBearingAnchorFamily = fams.filter((f) => f.pass).map((f) => f.family).join("|");
  row.anchorFamilyGuess = bestAnchorFamilyGuess(hay);
  const audit = auditDeclarativeness({ selectedText: textForAudit, rawText: rawText || textForAudit, embeddedSubstantiveClaim: embedded || "" });
  row.softeningWarning = audit.softeningIntroduced || audit.topicSummaryWarning ? "YES" : "";
  row.predicatePreserved = audit.hardPredicatePreserved ? "yes" : "NO";
  row.namedEntitiesPreserved = audit.namedEntitiesPreserved ? "yes" : "NO";
  row.declarativeScore = audit.declarativeScore;
  return row;
}

// ---------------------------------------------------------------------------
// Sources → rows
// ---------------------------------------------------------------------------
function rowsFromDetailDump(dump, dumpPath) {
  const rows = [];
  const meta = {
    packagePath: path.relative(ROOT, dumpPath),
    packageTimestamp: dump.timestamp,
    contentId: 17162, taskId: 17162, tm4ClaimPackageId: 1, runId: "tm4prev-2026-07-08T14-11-16",
  };
  const s = dump.sections;
  const selectedByOcc = new Map((s.selectedClaims || []).map((c) => [c.sourceClaimId, c]));
  const enteringIds = new Set((s.evidenceEntering?.entered || []).map((c) => c.sourceClaimId));
  const excludedById = new Map((s.evidenceEntering?.excluded || []).map((c) => [c.sourceClaimId, c.exclusionReason]));
  const suspiciousById = new Map((s.omittedHighValue || []).map((c) => [c.sourceClaimId, c]));

  for (const c of s.rawClaims?.persistedRun || []) {
    const row = { ...baseRow(), ...meta, rowType: "raw_phase1", sourceStage: "phase1_raw",
      rowId: `dump1|raw|${c.sourceClaimId}`, sourceClaimId: c.sourceClaimId,
      selectedStatus: c.selected ? "selected" : "not_selected", selectionRank: c.selectionRank ?? "",
      omissionReason: c.omissionReason || "", suspiciousOmission: suspiciousById.get(c.sourceClaimId)?.suspicious ? "YES" : "",
      visibleClaimText: c.visibleClaimText, embeddedSubstantiveClaim: c.embeddedSubstantiveClaim,
      canonicalExcerpt: c.canonicalExcerpt, sourceSentenceIds: (c.sourceSentenceIds || []).join("|"),
      claimForm: c.claimForm, articleUse: c.articleUse, scoreTransform: c.scoreTransform,
      speakerSource: c.speakerOrSource, pillar: c.pillar, cluster: c.cluster,
      evidenceEntered: enteringIds.has(c.sourceClaimId) ? "yes" : "", evidenceExclusionReason: excludedById.get(c.sourceClaimId) || "" };
    rows.push(enrich(row, c.visibleClaimText, c.visibleClaimText, c.embeddedSubstantiveClaim));
  }
  for (const c of s.selectedClaims || []) {
    const row = { ...baseRow(), ...meta, rowType: "selected", sourceStage: "phase2b_selected",
      rowId: `dump1|sel|${c.sourceClaimId}`, sourceClaimId: c.sourceClaimId,
      claimId: c.claimId ?? "", contentClaimId: c.contentClaimId ?? "", selectedEvaluationClaimId: c.selectedEvaluationClaimId ?? "",
      selectedStatus: "selected", selectionRank: c.rank,
      visibleClaimText: c.text, selectedClaimText: c.text, representativeClaimText: c.representativeClaimText,
      canonicalExcerpt: c.canonicalExcerpt, sourceSentenceIds: (c.sourceSentenceIds || []).join("|"),
      pillar: c.pillar, cluster: c.cluster, selectionReason: c.selectionReason,
      evidenceEntered: enteringIds.has(c.sourceClaimId) ? "yes" : "no", evidenceExclusionReason: excludedById.get(c.sourceClaimId) || "" };
    rows.push(enrich(row, c.text, c.text, ""));
  }
  for (const c of s.omittedHighValue || []) {
    const row = { ...baseRow(), ...meta, rowType: "omitted_high_value", sourceStage: "phase2b_omitted",
      rowId: `dump1|omit|${c.sourceClaimId}`, sourceClaimId: c.sourceClaimId,
      selectedStatus: "not_selected", omissionReason: c.omissionReason, suspiciousOmission: c.suspicious ? "YES" : "",
      visibleClaimText: c.visibleClaimText, embeddedSubstantiveClaim: c.embeddedSubstantiveClaim,
      canonicalExcerpt: c.canonicalExcerpt, sourceSentenceIds: (c.sourceSentenceIds || []).join("|"),
      claimForm: c.claimForm, articleUse: c.articleUse, scoreTransform: c.scoreTransform,
      pillar: c.pillar, cluster: c.cluster };
    rows.push(enrich(row, c.visibleClaimText, c.visibleClaimText, c.embeddedSubstantiveClaim));
  }
  for (const t of s.targets || []) {
    const row = { ...baseRow(), ...meta, rowType: "phase3_target", sourceStage: "phase3_target",
      rowId: `dump1|tgt|${t.targetId}`, sourceClaimId: t.sourceClaimId, targetId: t.targetId,
      evaluationTargetId: t.evaluationTargetId ?? "", selectedEvaluationClaimId: t.selectedEvaluationClaimId ?? "",
      contentClaimId: t.contentClaimId ?? "",
      selectedStatus: selectedByOcc.has(t.sourceClaimId) ? "selected" : "",
      visibleClaimText: t.linkedClaimText, targetText: t.targetText, primaryQueryText: t.primaryQueryText,
      queryHints: t.queryHints, bearingCriteria: t.bearingCriteria,
      targetType: t.targetType, scoreTransform: t.scoreTransform,
      searchEligible: t.searchEligible ? "yes" : "no", verdictEligible: t.verdictEligible ? "yes" : "no" };
    rows.push(enrich(row, t.targetText, t.linkedClaimText, ""));
  }
  return rows;
}

function rowsFromSidecar(sidecar, sidecarPath) {
  const rows = [];
  const meta = {
    packagePath: path.relative(ROOT, sidecarPath),
    packageTimestamp: sidecar.createdAt,
    contentId: sidecar.contentId, taskId: sidecar.contentId,
    tm4ClaimPackageId: sidecar.tm4ClaimPackageId ?? "", runId: sidecar.previewRunId,
  };
  const rid = sidecar.previewRunId;
  const selectedByOcc = new Map((sidecar.tm4.selectedEvaluationClaims || []).map((c) => [c.claimId, c]));
  const suppressionByOcc = new Map((sidecar.tm4.nonSelectedClaims || []).map((c) => [c.claimId, c]));
  const dbByOcc = new Map((sidecar.claimMap || []).map((c) => [c.tm4Occurrences?.[0], c]));

  // Index Phase 3 targets by source claim so selected rows can roll them up.
  const targetsByOcc = new Map();
  for (const t of sidecar.tm4.targets || []) {
    if (!targetsByOcc.has(t.sourceClaimId)) targetsByOcc.set(t.sourceClaimId, []);
    targetsByOcc.get(t.sourceClaimId).push(t);
  }
  const summarizeBearing = (b) => {
    if (!b) return "";
    const parts = [];
    if ((b.mustMatch || []).length) parts.push(`must:${b.mustMatch.length}`);
    if ((b.shouldMatch || []).length) parts.push(`should:${b.shouldMatch.length}`);
    if ((b.rejectIfOnly || []).length) parts.push(`rejectIfOnly:${b.rejectIfOnly.length}`);
    if (b.weak) parts.push("weak");
    return parts.join(" ");
  };
  const rollupTargets = (occId) => {
    const ts = targetsByOcc.get(occId) || [];
    if (!ts.length) return {};
    const types = ts.map((t) => t.targetType);
    const transforms = ts.map((t) => t.scoreTransform || "none");
    const tally = (arr) => Object.entries(arr.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {}))
      .map(([k, n]) => `${k}:${n}`).join("|");
    const sub = ts.find((t) => t.targetType === "substantive");
    const srcIds = [...new Set(ts.flatMap((t) => t.queryExpansionSourceClaimIds || []))];
    const sibHints = [...new Set(ts.flatMap((t) => t.queryExpansion?.siblingEvidenceHints || t.queryHints?.siblingEvidenceHints || []))];
    const docHints = [...new Set(ts.flatMap((t) => t.documentAffordanceHints || t.queryHints?.documentAffordanceHints || []))];
    return {
      targetCount: ts.length,
      searchEligibleTargetCount: ts.filter((t) => t.searchEligible !== false).length,
      verdictEligibleTargetCount: ts.filter((t) => t.verdictEligible).length,
      targetTypesSummary: tally(types),
      scoreTransformsSummary: tally(transforms),
      primarySubstantiveTargetText: sub?.targetText || "",
      primarySubstantiveQueryText: sub?.queryHints?.primaryQueryText || "",
      primaryBearingCriteriaSummary: summarizeBearing(sub?.bearingCriteria),
      queryExpansionSourceClaimIds: srcIds.join("|"),
      siblingEvidenceHints: sibHints.join(" ⏸ "),
      documentAffordanceHints: docHints.join("|"),
      hasAttributionTarget: types.includes("attribution") ? "yes" : "",
      hasSubstantiveTarget: types.includes("substantive") ? "yes" : "",
      hasStudyIdentityTarget: types.includes("study_identity") ? "yes" : "",
      hasEvidenceLandscapeTarget: types.includes("evidence_landscape") ? "yes" : "",
    };
  };

  for (const c of sidecar.tm4.rawClaims || []) {
    const sel = selectedByOcc.get(c.claimId);
    const sup = suppressionByOcc.get(c.claimId);
    const row = { ...baseRow(), ...meta, rowType: sel ? "selected" : "raw_phase1",
      sourceStage: sel ? "phase2b_selected" : "phase1_raw",
      rowId: `${rid}|${sel ? "sel" : "raw"}|${c.claimId}`, sourceClaimId: c.claimId,
      claimId: dbByOcc.get(c.claimId)?.dbClaimId ?? "",
      selectedStatus: sel ? "selected" : "not_selected", selectionRank: sel?.selectionRank ?? "",
      omissionReason: sel ? "" : (sup?.suppressionReason || "NO_REJECTION_REASON_CAPTURED"),
      visibleClaimText: c.visibleClaimText, embeddedSubstantiveClaim: c.embeddedSubstantiveClaim,
      selectedClaimText: sel ? c.visibleClaimText : "",
      canonicalExcerpt: c.canonicalExcerpt, sourceSentenceIds: (c.sourceSentenceIds || []).join("|"),
      claimForm: c.claimForm, articleUse: c.articleUse, scoreTransform: c.scoreTransformHint,
      speakerSource: c.speakerOrSource, pillar: c.phase2PillarId, cluster: c.phase2ClusterId,
      selectionReason: sel?.selectionRationale || "",
      // Selected rows roll up their Phase 3 targets + evidence-search behavior.
      ...(sel ? rollupTargets(c.claimId) : {}) };
    rows.push(enrich(row, c.visibleClaimText, c.visibleClaimText, c.embeddedSubstantiveClaim));
  }
  for (const t of sidecar.tm4.targets || []) {
    const row = { ...baseRow(), ...meta, rowType: "phase3_target", sourceStage: "phase3_target",
      rowId: `${rid}|tgt|${t.targetId}`, sourceClaimId: t.sourceClaimId, targetId: t.targetId,
      selectedStatus: selectedByOcc.has(t.sourceClaimId) ? "selected" : "",
      visibleClaimText: t.visibleClaimText || "", targetText: t.targetText,
      primaryQueryText: t.queryHints?.primaryQueryText || "",
      queryHints: t.queryHints, bearingCriteria: t.bearingCriteria,
      targetType: t.targetType, scoreTransform: t.scoreTransform,
      searchEligible: t.searchEligible ? "yes" : "no", verdictEligible: t.verdictEligible ? "yes" : "no" };
    rows.push(enrich(row, t.targetText, t.visibleClaimText || "", ""));
  }
  return rows;
}

// ---------------------------------------------------------------------------
async function main() {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  let dumpPaths = collectArgs("--dump");
  let sidecarPaths = collectArgs("--sidecar");
  if (!dumpPaths.length && !sidecarPaths.length) {
    const dumps = (await fs.readdir(ARTIFACTS)).filter((f) => /^tm4_claim_detail_dump_.*\.json$/.test(f)).sort();
    if (dumps.length) dumpPaths = [path.join(ARTIFACTS, dumps[dumps.length - 1])];
    const sidecars = (await fs.readdir(RUNS_DIR).catch(() => [])).filter((f) => /^tm4prev-.*\.json$/.test(f) && !f.includes(".rawllm")).sort();
    if (sidecars.length) sidecarPaths = [path.join(RUNS_DIR, sidecars[sidecars.length - 1])];
  }

  const rows = [];
  for (const p of dumpPaths) rows.push(...rowsFromDetailDump(JSON.parse(await fs.readFile(p, "utf-8")), p));
  for (const p of sidecarPaths) rows.push(...rowsFromSidecar(JSON.parse(await fs.readFile(p, "utf-8")), p));
  if (!rows.length) throw new Error("No rows produced — pass --dump and/or --sidecar");

  const csv = [ALL_COLUMNS.join(","), ...rows.map((r) => ALL_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\r\n");
  const csvPath = path.join(ARTIFACTS, `tm4_claim_correction_${TS}.csv`);
  const jsonPath = path.join(ARTIFACTS, `tm4_claim_correction_${TS}.json`);
  await fs.writeFile(csvPath, "﻿" + csv); // BOM for Excel
  await fs.writeFile(jsonPath, JSON.stringify({ timestamp: TS, sources: [...dumpPaths, ...sidecarPaths].map((p) => path.relative(ROOT, p)), columns: ALL_COLUMNS, rows }, null, 2));

  const readme = `# TM4 Claim Correction Sheet — ${TS}

**File:** \`${path.relative(ROOT, csvPath)}\` (${rows.length} rows) — opens in Excel/Numbers/Google Sheets (UTF-8 BOM, quoted multiline fields, nothing truncated).

Row types: ${[...new Set(rows.map((r) => r.rowType))].join(", ")}. Left columns are system output (read-only); **your correction columns start at \`manualAction\`** (far right).

## How to fill it in
- **manualAction**: keep | rewrite | drop | split | merge | promote_to_selected | demote_from_selected
- **corrected\*Text** fields: write the text you WISH the system had produced (full sentences; hard predicates; keep actors/numbers/studies).
- **shouldBeSelected**: yes | no | maybe
- **selectionPriority / falsifiabilityScore / articleCentralityScore / evidenceSearchabilityScore**: integers 1–5
- **desiredTargetType**: substantive | attribution | study_identity | evidence_landscape | inference
- **correctionLabels** (pipe-separate multiple): softening_removed | topic_to_claim | predicate_restored | named_entity_restored | number_or_date_restored | study_identity_restored | attribution_restored | embedded_substantive_claim_restored | compound_split | wrong_target_type | query_hint_repaired | bearing_criteria_repaired | should_have_been_selected | should_not_have_been_selected | duplicate_or_redundant | too_vague | not_falsifiable | not_article_central
- **manualNotes**: anything else.

## Pre-flagged for attention
- rows with \`softeningWarning=YES\` or \`predicatePreserved=NO\` — likely topic-summary decay
- rows with \`suspiciousOmission=YES\` — high-value claims the selector dropped without family coverage
- rows with \`claimBearingAnchorFamily\` empty but \`auditProbeTags\` non-empty — topic word survived, proposition didn't

## When done
\`\`\`bash
node scripts/testing/tm4_ingest_claim_corrections_csv.mjs --csv <your edited csv>
\`\`\`
`;
  const readmePath = path.join(ARTIFACTS, `tm4_claim_correction_readme_${TS}.md`);
  await fs.writeFile(readmePath, readme);
  console.log(`✅ Correction sheet: ${rows.length} rows\n   ${csvPath}\n   ${jsonPath}\n   ${readmePath}`);
}

main().catch((e) => { console.error("❌ FATAL:", e.message || e); process.exit(1); });
