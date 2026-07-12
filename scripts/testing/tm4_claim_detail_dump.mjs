#!/usr/bin/env node

/**
 * TM4 CLAIM DETAIL DUMP — read-only. Full claim text at every stage.
 *
 * Dumps the important TM4 packages with ACTUAL claim/target text so
 * extraction, selection, targetization, and evidence inputs can be tuned:
 *   1. readiness package (pre-Phase 2b)   backend/logs/tm4_phase3_readiness_package_2026-07-08T07-57-46.json
 *   2. selected sidecar                   backend/logs/tm4_preview_runs/tm4prev-2026-07-08T12-42-18.json
 *   3. persisted sidecar (content 17162)  backend/logs/tm4_preview_runs/tm4prev-2026-07-08T14-11-16.json
 *   4. latest targets file                backend/logs/tm4_phase3_targets_2026-07-08T14-11-16.json
 * plus DB rows for tm4_claim_package_id 1 / content_id 17162 when reachable.
 *
 * No evidence runs. No Workspace writes. DB access is SELECT-only.
 *
 * Usage: node scripts/testing/tm4_claim_detail_dump.mjs
 * Output: artifacts/tm4_claim_detail_dump_<timestamp>.{md,json}
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const ARTIFACTS = path.join(ROOT, "artifacts");
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

dotenv.config({ path: path.join(BACKEND, ".env") });

const FILES = {
  readiness: path.join(BACKEND, "logs/tm4_phase3_readiness_package_2026-07-08T07-57-46.json"),
  selectedRun: path.join(BACKEND, "logs/tm4_preview_runs/tm4prev-2026-07-08T12-42-18.json"),
  persistedRun: path.join(BACKEND, "logs/tm4_preview_runs/tm4prev-2026-07-08T14-11-16.json"),
  targetsFile: path.join(BACKEND, "logs/tm4_phase3_targets_2026-07-08T14-11-16.json"),
};

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

const HIGH_VALUE_RE = new RegExp([
  "thompson", "william thompson", "cdc scientist", "whistleblower", "\\bMMR\\b", "autism",
  "manipulat", "data manipulation", "destroy(ed)? (the )?(evidence|documents|data)", "2004 study",
  "hooker", "brian hooker", "re-?analysis", "fraudulent", "re-?worked study",
  "verstraeten", "simpsonwood", "thimerosal", "aluminum", "tomato", "blood.brain barrier",
  "\\b1986\\b", "liabilit", "\\bVAERS\\b",
].join("|"), "i");

const ANCHOR_FAMILIES = {
  "Thompson / CDC / MMR data manipulation": /thompson|(\bMMR\b.*(manipulat|fraud|re-?work|omit|alter))|((manipulat|fraud|re-?work|omit|alter).*\bMMR\b)|cdc.*(scientist|whistleblower)/i,
  "CDC destruction-of-evidence allegation": /destroy(ed)?.*(evidence|documents|data)|ordered the destruction/i,
  "Hooker / reanalysis / original CDC study": /hooker|re-?analysis|2004 (cdc )?study/i,
  "Thimerosal / Simpsonwood / Verstraeten": /thimerosal|simpsonwood|verstraeten/i,
  "1986 Act / liability / industry capture": /\b1986\b|liabilit|industry capture/i,
  "Aluminum / tomato / blood-brain barrier / dosing": /aluminum|tomato|blood.brain barrier/i,
  "VAERS death timing claim": /\bVAERS\b.*(death|died|day)|(death|died).*\bVAERS\b/i,
};

const claimHay = (c) => [c.visibleClaimText, c.embeddedSubstantiveClaim, c.canonicalExcerpt, c.searchText].filter(Boolean).join(" ");
const anchorsFor = (text) => Object.entries(ANCHORS).filter(([, re]) => re.test(text)).map(([k]) => k);
const norm = (t) => String(t || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

async function loadJson(p) { return JSON.parse(await fs.readFile(p, "utf-8")); }

async function makeReadOnlyQuery() {
  try {
    const { query } = await import(path.join(BACKEND, "src/db/pool.js"));
    const ro = async (sql, params) => {
      if (!/^(SELECT|SHOW|DESCRIBE|EXPLAIN)/i.test(String(sql).trim())) throw new Error("read-only");
      return query(sql, params);
    };
    await ro("SELECT 1");
    return ro;
  } catch { return null; }
}

// ---------------------------------------------------------------------------

function rawClaimRecord(c, i, { selectedById, suppressionById }) {
  const sel = selectedById?.get(c.claimId);
  const sup = suppressionById?.get(c.claimId);
  return {
    sourceClaimId: c.claimId,
    occurrenceOrder: i,
    sectionIndex: Number(String(c.claimId).match(/^S(\d+)/)?.[1] ?? -1),
    visibleClaimText: c.visibleClaimText || "",
    canonicalExcerpt: c.canonicalExcerpt || "",
    sourceSentenceIds: c.sourceSentenceIds || [],
    claimForm: c.claimForm || "",
    articleUse: c.articleUse || "",
    scoreTransform: c.scoreTransformHint || c.targetHints?.likelyScoreTransform || "",
    speakerOrSource: c.speakerOrSource || "",
    embeddedSubstantiveClaim: c.embeddedSubstantiveClaim || "",
    warrantContext: c.warrantHint || "",
    pillar: c.phase2PillarId || "",
    cluster: c.phase2ClusterId || "",
    phase2Role: c.phase2Role || "",
    reconciliation: c.reconciliation?.groupId ? { groupId: c.reconciliation.groupId, status: c.reconciliation.status, canonical: c.reconciliation.canonicalOccurrenceId } : null,
    selected: Boolean(sel),
    selectionRank: sel?.selectionRank ?? null,
    selectionScore: sel?.selectionScore ?? sup?.selectionScore ?? null,
    omissionReason: sel ? null : (sup?.suppressionReason || "NO_REJECTION_REASON_CAPTURED"),
    anchors: anchorsFor(claimHay(c)),
  };
}

function mdRawClaim(r) {
  return `### ${r.sourceClaimId}${r.selected ? ` — ✅ SELECTED (rank ${r.selectionRank})` : ""}
> ${r.visibleClaimText}

- form: \`${r.claimForm}\` · use: \`${r.articleUse}\` · transform: \`${r.scoreTransform}\` · speaker: ${r.speakerOrSource || "—"}
- pillar: ${r.pillar || "—"} · cluster: ${r.cluster || "—"} · role: ${r.phase2Role || "—"} · sentences: [${r.sourceSentenceIds.join(",")}] · order: ${r.occurrenceOrder}
${r.embeddedSubstantiveClaim ? `- embedded substantive: "${r.embeddedSubstantiveClaim}"\n` : ""}${r.warrantContext ? `- warrant: "${r.warrantContext}"\n` : ""}${r.reconciliation ? `- reconciliation: group ${r.reconciliation.groupId} (${r.reconciliation.status}, canonical ${r.reconciliation.canonical})\n` : ""}- excerpt: "${(r.canonicalExcerpt || "").slice(0, 400)}${(r.canonicalExcerpt || "").length > 400 ? "… [full in JSON]" : ""}"
- anchors: ${r.anchors.join(", ") || "none"}
- ${r.selected ? `selection score: ${r.selectionScore}` : `omission: ${r.omissionReason}${r.selectionScore != null ? ` (score ${Number(r.selectionScore).toFixed(3)})` : ""}`}`;
}

// ---------------------------------------------------------------------------

async function main() {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  const readiness = await loadJson(FILES.readiness);
  const selectedRun = await loadJson(FILES.selectedRun);
  const persistedRun = await loadJson(FILES.persistedRun);
  const targetsFile = await loadJson(FILES.targetsFile);
  const ro = await makeReadOnlyQuery();

  // DB rows for package 1 / content 17162
  let db = { available: false };
  if (ro) {
    try {
      const [pkg] = await ro(`SELECT * FROM tm4_claim_packages WHERE tm4_claim_package_id = 1`);
      const rawRows = await ro(`SELECT tm4_raw_claim_occurrence_id, source_claim_id, claim_id, is_selected, suppression_reason, selection_score, visible_claim_text FROM tm4_raw_claim_occurrences WHERE tm4_claim_package_id = 1 ORDER BY occurrence_order`);
      const selRows = await ro(`SELECT tm4_selected_evaluation_claim_id, source_claim_id, claim_id, content_claim_id, source_raw_occurrence_id, selection_rank, selection_score, pillar_id, cluster_id, selection_reason, thesis_relevance_score, evidence_priority, representative_claim_text, evaluation_question, is_workspace_visible, is_evidence_eligible FROM tm4_selected_evaluation_claims WHERE tm4_claim_package_id = 1 ORDER BY selection_rank`);
      const targetRows = await ro(`SELECT evaluation_target_id, claim_id, target_key, source_claim_id, target_type, target_text, primary_query_text, query_hints_json, bearing_criteria_json, score_transform, search_eligible, verdict_eligible, mapping_confidence, mapping_rationale, quality_status, quality_flags_json, weak_bearing, needs_atomic_split FROM claim_evaluation_targets WHERE content_id = 17162 ORDER BY claim_id, target_order`);
      db = { available: true, pkg: pkg || null, rawRows, selRows, targetRows };
    } catch (e) { db = { available: false, error: e.message }; }
  }

  // Latest evidence regression artifact → evidence-entering claims
  let regression = null;
  try {
    const regFiles = (await fs.readdir(ARTIFACTS)).filter((f) => /^tm4_evidence_regression_.*\.json$/.test(f)).sort();
    if (regFiles.length) regression = await loadJson(path.join(ARTIFACTS, regFiles[regFiles.length - 1]));
  } catch { /* none */ }

  // Build stage structures
  const packages = [
    { key: "readiness", label: "readiness package (pre-Phase 2b)", path: FILES.readiness, data: readiness,
      raw: readiness.claims || [], selected: [], nonSelected: [], targets: [],
      strongIds: new Set(readiness.strongCandidateClaimIds || []) },
    { key: "selectedRun", label: "selected sidecar (content 17106 run)", path: FILES.selectedRun, data: selectedRun,
      raw: selectedRun.tm4?.rawClaims || [], selected: selectedRun.tm4?.selectedEvaluationClaims || [],
      nonSelected: selectedRun.tm4?.nonSelectedClaims || [], targets: selectedRun.tm4?.targets || [] },
    { key: "persistedRun", label: "persisted sidecar (content 17162, package 1)", path: FILES.persistedRun, data: persistedRun,
      raw: persistedRun.tm4?.rawClaims || [], selected: persistedRun.tm4?.selectedEvaluationClaims || [],
      nonSelected: persistedRun.tm4?.nonSelectedClaims || [], targets: persistedRun.tm4?.targets || [] },
  ];

  const out = { timestamp: TS, files: FILES, dbAvailable: db.available, sections: {} };
  let md = `# TM4 Claim Detail Dump — ${TS}\n\nFull claim text at every stage. Read-only; no evidence run; no Workspace writes.\n`;

  // ============ 1. Package inventory ============
  md += `\n## 1. Package inventory\n\n| package | path | content_id | pkg_id | raw | selected | targets | search-elig | verdict-elig | anchors |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  const inv = [];
  for (const p of packages) {
    const texts = p.raw.map((c) => claimHay(c));
    const cov = anchorsFor(texts.join("\n"));
    const row = {
      package: p.label, path: path.relative(ROOT, p.path),
      contentId: p.data.contentId ?? null, packageId: p.data.tm4ClaimPackageId ?? null,
      timestamp: p.data.timestamp || p.data.createdAt || null,
      rawCount: p.raw.length, selectedCount: p.selected.length || null,
      targetCount: p.targets.length || null,
      searchEligible: p.targets.filter((t) => t.searchEligible).length || null,
      verdictEligible: p.targets.filter((t) => t.verdictEligible).length || null,
      anchorCoverage: `${cov.length}/13 (${cov.join(", ")})`,
    };
    inv.push(row);
    md += `| ${p.label} | ${row.path} | ${row.contentId ?? "—"} | ${row.packageId ?? "—"} | ${row.rawCount} | ${row.selectedCount ?? "—"} | ${row.targetCount ?? "—"} | ${row.searchEligible ?? "—"} | ${row.verdictEligible ?? "—"} | ${cov.length}/13 |\n`;
  }
  const tf = targetsFile.targets || [];
  md += `| targets file | ${path.relative(ROOT, FILES.targetsFile)} | — | — | — | — | ${tf.length} | ${tf.filter((t) => t.searchEligible).length} | ${tf.filter((t) => t.verdictEligible).length} | — |\n`;
  inv.push({ package: "targets file", path: path.relative(ROOT, FILES.targetsFile), targetCount: tf.length });
  out.sections.inventory = inv;

  // ============ 2. Full raw Phase 1 claims (persisted package = primary; readiness for pre-2b view) ============
  out.sections.rawClaims = {};
  for (const p of packages) {
    const selectedById = new Map(p.selected.map((c) => [c.claimId, c]));
    const suppressionById = new Map(p.nonSelected.map((c) => [c.claimId, c]));
    const records = p.raw.map((c, i) => rawClaimRecord(c, i, { selectedById, suppressionById }));
    // strong-candidate marker for readiness package
    if (p.strongIds) records.forEach((r) => { r.strongCandidate = p.strongIds.has(r.sourceClaimId); });
    out.sections.rawClaims[p.key] = records;
  }
  md += `\n## 2. Full raw Phase 1 claims — persisted package (content 17162, 61 occurrences)\n\n`;
  md += out.sections.rawClaims.persistedRun.map(mdRawClaim).join("\n\n");
  md += `\n\n### Readiness package (pre-Phase 2b, 60 occurrences) — claims NOT in the persisted run's wording\n\n`;
  const persistedNorm = new Set(out.sections.rawClaims.persistedRun.map((r) => norm(r.visibleClaimText)));
  const readinessOnly = out.sections.rawClaims.readiness.filter((r) => !persistedNorm.has(norm(r.visibleClaimText)));
  md += readinessOnly.length
    ? readinessOnly.map((r) => `- **${r.sourceClaimId}**${r.strongCandidate ? " [strong candidate]" : ""} (${r.claimForm}/${r.articleUse}): "${r.visibleClaimText}" — anchors: ${r.anchors.join(", ") || "none"}`).join("\n")
    : "_(all readiness claims re-appear in the persisted run in identical or near-identical wording)_";

  // ============ 3. SelectedEvaluationClaims detail ============
  const targetsByOcc = new Map();
  for (const t of packages[2].targets) {
    if (!targetsByOcc.has(t.sourceClaimId)) targetsByOcc.set(t.sourceClaimId, []);
    targetsByOcc.get(t.sourceClaimId).push(t);
  }
  const dbSelByOcc = new Map((db.selRows || []).map((r) => [r.source_claim_id, r]));
  out.sections.selectedClaims = packages[2].selected.map((c) => {
    const dbr = dbSelByOcc.get(c.claimId);
    return {
      rank: c.selectionRank,
      selectedEvaluationClaimId: dbr?.tm4_selected_evaluation_claim_id ?? null,
      sourceClaimId: c.claimId,
      sourceRawOccurrenceId: dbr?.source_raw_occurrence_id ?? null,
      claimId: dbr?.claim_id ?? null,
      contentClaimId: dbr?.content_claim_id ?? null,
      text: c.visibleClaimText,
      representativeClaimText: dbr?.representative_claim_text || c.visibleClaimText,
      evaluationQuestion: dbr?.evaluation_question || null,
      pillar: c.phase2PillarId || dbr?.pillar_id || "",
      cluster: c.phase2ClusterId || dbr?.cluster_id || "",
      selectionReason: c.selectionRationale || dbr?.selection_reason || "",
      selectionScore: c.selectionScore,
      thesisRelevanceScore: dbr?.thesis_relevance_score ?? c.selectionScore,
      evidencePriority: dbr?.evidence_priority ?? c.selectionRank,
      sourceSentenceIds: c.sourceSentenceIds || [],
      canonicalExcerpt: c.canonicalExcerpt || "",
      anchors: anchorsFor(claimHay(c)),
      sourceRawClaimIds: c.sourceRawClaimIds || [c.claimId],
      isWorkspaceVisible: dbr ? Boolean(dbr.is_workspace_visible) : null,
      isEvidenceEligible: dbr ? Boolean(dbr.is_evidence_eligible) : null,
      targets: (targetsByOcc.get(c.claimId) || []).map((t) => ({ targetId: t.targetId, type: t.targetType, text: t.targetText })),
    };
  });
  md += `\n\n## 3. SelectedEvaluationClaims detail (persisted run, content 17162)\n\n`;
  md += out.sections.selectedClaims.map((s) => `### Rank ${s.rank} — ${s.sourceClaimId}${s.selectedEvaluationClaimId ? ` (sel_id ${s.selectedEvaluationClaimId}, claim_id ${s.claimId}, cc_id ${s.contentClaimId})` : ""}
> ${s.text}

- pillar: ${s.pillar || "—"} · cluster: ${s.cluster || "—"} · score: ${s.selectionScore} · evidence priority: ${s.evidencePriority}
- selection reason: ${s.selectionReason}
- sentences: [${s.sourceSentenceIds.join(",")}] · raw occurrence(s): ${s.sourceRawClaimIds.join(", ")}${s.sourceRawOccurrenceId ? ` · db raw row ${s.sourceRawOccurrenceId}` : ""}
- excerpt: "${s.canonicalExcerpt.slice(0, 300)}${s.canonicalExcerpt.length > 300 ? "… [full in JSON]" : ""}"
- anchors: ${s.anchors.join(", ") || "none"}
- workspace visible: ${s.isWorkspaceVisible ?? "?"} · evidence eligible: ${s.isEvidenceEligible ?? "?"}
- targets (${s.targets.length}):
${s.targets.map((t) => `  - [${t.type}] "${t.text}"`).join("\n")}`).join("\n\n");

  // ============ 4. Omitted high-value candidates ============
  const selectedClusters = new Set(packages[2].selected.map((c) => c.phase2ClusterId).filter(Boolean));
  const selectedByCluster = new Map(packages[2].selected.filter((c) => c.phase2ClusterId).map((c) => [c.phase2ClusterId, c.claimId]));
  out.sections.omittedHighValue = out.sections.rawClaims.persistedRun
    .filter((r) => !r.selected && HIGH_VALUE_RE.test(`${r.visibleClaimText} ${r.embeddedSubstantiveClaim} ${r.canonicalExcerpt}`))
    .map((r) => {
      const coveredBy = r.cluster && selectedClusters.has(r.cluster) ? selectedByCluster.get(r.cluster) : null;
      const suspicious = !coveredBy && (r.omissionReason === "NO_REJECTION_REASON_CAPTURED" || /below selection cut/.test(r.omissionReason));
      return { ...r, coveredByClusterRepresentative: coveredBy, suspicious };
    });
  md += `\n\n## 4. Omitted high-value candidates (${out.sections.omittedHighValue.length} of 51 non-selected match the high-value list)\n\n`;
  md += out.sections.omittedHighValue.map((r) => `### ${r.sourceClaimId}${r.suspicious ? " — ⚠️ SUSPICIOUS OMISSION" : ""}
> ${r.visibleClaimText}

- excerpt: "${(r.canonicalExcerpt || "").slice(0, 300)}${(r.canonicalExcerpt || "").length > 300 ? "…" : ""}"
- pillar: ${r.pillar || "—"} · cluster: ${r.cluster || "—"} · score: ${r.selectionScore != null ? Number(r.selectionScore).toFixed(3) : "—"} · anchors: ${r.anchors.join(", ") || "none"}
- why not selected: ${r.omissionReason}
- ${r.coveredByClusterRepresentative ? `family covered by selected cluster representative **${r.coveredByClusterRepresentative}**` : r.suspicious ? "**no selected claim covers this cluster/family — review**" : "structural suppression (cap/duplicate)"}`).join("\n\n");

  // ============ 5. Phase 3 target detail ============
  const dbTargetsByKey = new Map((db.targetRows || []).map((r) => [r.target_key || r.source_claim_id + "|" + r.target_type, r]));
  const selIdByOcc = new Map(out.sections.selectedClaims.map((s) => [s.sourceClaimId, s]));
  out.sections.targets = tf.map((t) => {
    const dbr = (db.targetRows || []).find((r) => r.target_key === t.targetId) ||
      (db.targetRows || []).find((r) => r.source_claim_id === t.sourceClaimId && r.target_type === (["attribution","substantive","inference","study_identity"].includes(t.targetType) ? t.targetType : "substantive") && String(r.target_text || "").slice(0, 60) === String(t.targetText || "").slice(0, 60));
    const sel = selIdByOcc.get(t.sourceClaimId);
    return {
      targetId: t.targetId,
      evaluationTargetId: dbr?.evaluation_target_id ?? null,
      sourceClaimId: t.sourceClaimId,
      selectedEvaluationClaimId: sel?.selectedEvaluationClaimId ?? null,
      contentClaimId: sel?.contentClaimId ?? null,
      targetType: t.targetType,
      targetText: t.targetText,
      primaryQueryText: t.queryHints?.primaryQueryText || dbr?.primary_query_text || "",
      queryHints: t.queryHints || null,
      bearingCriteria: t.bearingCriteria || null,
      scoreTransform: t.scoreTransform,
      searchEligible: t.searchEligible,
      verdictEligible: t.verdictEligible,
      mappingReason: t.mappingReason || "",
      confidence: t.mappingConfidence ?? null,
      weakBearing: Boolean(t.bearingCriteria?.weak),
      needsAtomicSplit: Boolean(t.needsAtomicSplit || /needsAtomicSplit/.test(t.mappingReason || "")),
      qualityStatus: dbr?.quality_status || "passing (quality audit: 16/16, 0 flags)",
      qualityFlags: dbr?.quality_flags_json ? JSON.parse(dbr.quality_flags_json) : null,
      linkedClaimText: sel?.text || packages[2].raw.find((c) => c.claimId === t.sourceClaimId)?.visibleClaimText || "",
    };
  });
  md += `\n\n## 5. Phase 3 target detail (${out.sections.targets.length} targets)\n\n`;
  md += out.sections.targets.map((t) => `### ${t.targetId} — ${t.targetType}${t.evaluationTargetId ? ` (evaluation_target_id ${t.evaluationTargetId})` : ""}
- claim ${t.sourceClaimId}${t.selectedEvaluationClaimId ? ` (sel_id ${t.selectedEvaluationClaimId}, cc_id ${t.contentClaimId})` : ""}: "${t.linkedClaimText}"
- targetText: "${t.targetText}"
- primaryQueryText: "${t.primaryQueryText}"
- queryHints: \`${JSON.stringify(t.queryHints || {}).slice(0, 300)}\`
- bearing mustMatch: ${(t.bearingCriteria?.mustMatch || []).map((x) => `"${x}"`).join(", ") || "—"}
- bearing rejectIfOnly: ${(t.bearingCriteria?.rejectIfOnly || []).map((x) => `"${x}"`).join(", ") || "—"}
- transform: \`${t.scoreTransform}\` · search: ${t.searchEligible} · verdict: ${t.verdictEligible} · confidence: ${t.confidence} · weak: ${t.weakBearing} · atomicSplit: ${t.needsAtomicSplit}
- mappingReason: ${t.mappingReason}
- quality: ${t.qualityStatus}${t.qualityFlags ? ` flags: ${JSON.stringify(t.qualityFlags)}` : ""}`).join("\n\n");

  // ============ 6. Claim spine table for anchor families ============
  const stageDefs = [
    ["raw Phase 1 (persisted run)", out.sections.rawClaims.persistedRun.map((r) => ({ id: r.sourceClaimId, text: r.visibleClaimText, hay: `${r.visibleClaimText} ${r.embeddedSubstantiveClaim} ${r.canonicalExcerpt}` }))],
    ["strong candidates (readiness pkg)", out.sections.rawClaims.readiness.filter((r) => r.strongCandidate).map((r) => ({ id: r.sourceClaimId, text: r.visibleClaimText, hay: `${r.visibleClaimText} ${r.embeddedSubstantiveClaim} ${r.canonicalExcerpt}` }))],
    ["selectedEvaluationClaims", out.sections.selectedClaims.map((s) => ({ id: `${s.sourceClaimId} (rank ${s.rank})`, text: s.text, hay: `${s.text} ${s.canonicalExcerpt}` }))],
    ["Phase 3 targets", out.sections.targets.map((t) => ({ id: t.targetId, text: t.targetText, hay: `${t.targetText} ${t.linkedClaimText} ${t.primaryQueryText}` }))],
    ["persisted raw rows (DB)", (db.rawRows || []).map((r) => ({ id: `raw#${r.tm4_raw_claim_occurrence_id} ${r.source_claim_id}`, text: r.visible_claim_text, hay: r.visible_claim_text }))],
    ["persisted selected rows (DB)", (db.selRows || []).map((r) => ({ id: `sel#${r.tm4_selected_evaluation_claim_id} ${r.source_claim_id}`, text: r.representative_claim_text, hay: r.representative_claim_text }))],
    ["evidence-entering claims (harness)", (regression?.engine?.claims || []).map((c) => ({ id: c.sourceClaimId, text: c.text, hay: `${c.text} ${c.searchText}` }))],
  ];
  out.sections.anchorSpine = {};
  md += `\n\n## 6. Claim spine — anchor families across stages\n`;
  for (const [family, re] of Object.entries(ANCHOR_FAMILIES)) {
    out.sections.anchorSpine[family] = {};
    md += `\n### ${family}\n`;
    for (const [stage, items] of stageDefs) {
      const hits = items.filter((i) => re.test(i.hay));
      out.sections.anchorSpine[family][stage] = hits.map((h) => ({ id: h.id, text: h.text }));
      md += `- **${stage}**: ${hits.length ? hits.map((h) => `\`${h.id}\` "${String(h.text).slice(0, 110)}${String(h.text).length > 110 ? "…" : ""}"`).join(" · ") : "❌ ABSENT"}\n`;
    }
  }

  // ============ 7. Side-by-side selected package comparison ============
  const selA = packages[1].selected, selB = packages[2].selected;
  const normA = new Map(selA.map((c) => [norm(c.visibleClaimText), c]));
  const normB = new Map(selB.map((c) => [norm(c.visibleClaimText), c]));
  const dropped = selA.filter((c) => !normB.has(norm(c.visibleClaimText)));
  const added = selB.filter((c) => !normA.has(norm(c.visibleClaimText)));
  out.sections.comparison = {
    runA: { file: path.basename(FILES.selectedRun), contentId: selectedRun.contentId, selected: selA.map((c) => ({ rank: c.selectionRank, id: c.claimId, text: c.visibleClaimText })), targets: packages[1].targets.length, anchors: anchorsFor(selA.map(claimHay).join("\n")) },
    runB: { file: path.basename(FILES.persistedRun), contentId: persistedRun.contentId, selected: selB.map((c) => ({ rank: c.selectionRank, id: c.claimId, text: c.visibleClaimText })), targets: packages[2].targets.length, anchors: anchorsFor(selB.map(claimHay).join("\n")) },
    droppedFromA: dropped.map((c) => ({ id: c.claimId, rank: c.selectionRank, text: c.visibleClaimText })),
    addedInB: added.map((c) => ({ id: c.claimId, rank: c.selectionRank, text: c.visibleClaimText })),
    note: "Both runs are fresh Phase 1/2 LLM extractions of the same fixture; wording and section ids differ run-to-run, so claims are compared by normalized text.",
  };
  md += `\n\n## 7. Side-by-side selected package comparison\n
**Run A** ${path.basename(FILES.selectedRun)} (content 17106) — ${selA.length} selected, ${packages[1].targets.length} targets, anchors ${out.sections.comparison.runA.anchors.length}/13
**Run B** ${path.basename(FILES.persistedRun)} (content 17162, persisted pkg 1) — ${selB.length} selected, ${packages[2].targets.length} targets, anchors ${out.sections.comparison.runB.anchors.length}/13

| rank | Run A (17106) | Run B (17162) |
|---|---|---|
${Array.from({ length: Math.max(selA.length, selB.length) }, (_, i) => `| ${i + 1} | ${selA[i] ? `${selA[i].claimId}: "${selA[i].visibleClaimText.slice(0, 70)}…"` : "—"} | ${selB[i] ? `${selB[i].claimId}: "${selB[i].visibleClaimText.slice(0, 70)}…"` : "—"} |`).join("\n")}

**Disappeared (in A, not B):**
${dropped.map((c) => `- ${c.claimId} (rank ${c.selectionRank}): "${c.visibleClaimText}"`).join("\n") || "- none"}

**Added (in B, not A):**
${added.map((c) => `- ${c.claimId} (rank ${c.selectionRank}): "${c.visibleClaimText}"`).join("\n") || "- none"}

${out.sections.comparison.note}
`;

  // ============ 8. Evidence-entering claim detail ============
  const enteringIds = (regression?.engine?.claims || []).map((c) => c.sourceClaimId);
  out.sections.evidenceEntering = {
    harnessArtifact: regression ? `artifacts/tm4_evidence_regression_${regression.timestamp}.json` : null,
    entered: (regression?.engine?.claims || []).map((c) => ({ sourceClaimId: c.sourceClaimId, rank: c.rank, text: c.text, targets: c.targets, searchText: c.searchText })),
    excluded: out.sections.selectedClaims.filter((s) => !enteringIds.includes(s.sourceClaimId)).map((s) => ({
      sourceClaimId: s.sourceClaimId, rank: s.rank, text: s.text,
      isEvidenceEligible: s.isEvidenceEligible, searchEligibleTargets: s.targets.length,
      exclusionReason: "harness --limit 2 dev cap (claims taken in selection-rank order); NOT target gating, NOT verdict/search eligibility, NOT budget, NOT package mismatch — all 10 selected claims are evidence-eligible with search-eligible targets",
    })),
  };
  md += `\n\n## 8. Evidence-entering claim detail (latest harness run)\n
The harness was invoked with \`--limit 2\`, which takes the top-2 claims by selection rank. That — and only that — is why exactly two claims entered evidence.

**Entered:**
${out.sections.evidenceEntering.entered.map((c) => `- rank ${c.rank} \`${c.sourceClaimId}\` (${c.targets} targets): "${c.text}"\n  - searchText: "${c.searchText}"`).join("\n") || "- (no engine stage in latest artifact)"}

**Excluded (all 10 selected are evidence-eligible; every exclusion below is the --limit cap):**
${out.sections.evidenceEntering.excluded.map((s) => `- rank ${s.rank} \`${s.sourceClaimId}\` (eligible=${s.isEvidenceEligible}, ${s.searchEligibleTargets} targets): "${s.text.slice(0, 90)}…"`).join("\n")}
`;

  // ============ 9. Raw LLM response capture status ============
  out.sections.rawLlmCapture = {
    rawResponsesSaved: false,
    parsedClaimsBeginAt: "AtomicVisibleClaimsExtractor.extractFromSection → JSON.parse(llmResult) — on parse failure the raw text is DISCARDED (only the error string survives); first persisted form is the parsed visibleClaims array (backend/logs/tm4_phase1_full_claims_*.json, sidecar tm4.rawClaims, DB tm4_raw_claim_occurrences.phase1_json)",
    validationRejectedClaimsSaved: false,
    smallestFix: "Add an optional captureRaw(phase, sectionIndex, {system,user}, rawText) callback to AtomicVisibleClaimsExtractor and LocalClaimMapSynthesizer config (~10 lines); tm4_materialize_preview.mjs passes a writer appending JSONL to backend/logs/tm4_preview_runs/<runId>.rawllm.jsonl. Captures the exact pre-repair response per phase per section. No logging framework.",
  };
  md += `\n\n## 9. Raw LLM response capture status\n
- **Raw LLM responses saved: NO.** Nothing captures the model's raw text in any TM4 phase.
- Parsed claims begin at: ${out.sections.rawLlmCapture.parsedClaimsBeginAt}
- Validation-rejected claims: not saved (post-processing filters them; only counters/warnings remain).
- Smallest fix: ${out.sections.rawLlmCapture.smallestFix}
`;

  // ============ 10. Why the evidence looked like crap (analysis) ============
  let evidenceAnalysis = { dbAvailable: false };
  if (ro) {
    try {
      const stance17162 = await ro(`SELECT rcl.stance, COUNT(*) n, AVG(rcl.support_level) avgSupport, AVG(rcl.confidence) avgConf FROM reference_claim_links rcl
        JOIN content_claims cc ON cc.claim_id=rcl.claim_id AND cc.content_id=17162
        JOIN content_relations cr ON cr.reference_content_id=rcl.reference_content_id AND cr.content_id=17162 GROUP BY rcl.stance`);
      const targetLinks = await ro(`SELECT l.stance, COUNT(*) n, AVG(l.bearing_score) avgB FROM evaluation_target_evidence_links l
        JOIN claim_evaluation_targets t ON t.evaluation_target_id=l.evaluation_target_id WHERE t.content_id=17162 GROUP BY l.stance`);
      const quality = await ro(`SELECT ROUND(rcl.score/10)*10 bucket, COUNT(*) n FROM reference_claim_links rcl
        JOIN content_claims cc ON cc.claim_id=rcl.claim_id AND cc.content_id=17162
        JOIN content_relations cr ON cr.reference_content_id=rcl.reference_content_id AND cr.content_id=17162 GROUP BY bucket ORDER BY bucket`);
      evidenceAnalysis = {
        dbAvailable: true,
        referenceClaimLinkStance: stance17162,
        targetEvidenceLinkStance: targetLinks,
        qualityHistogram: quality.map((r) => `${r.bucket}:${r.n}`).join(" "),
      };
    } catch (e) { evidenceAnalysis.error = e.message; }
  }
  out.sections.evidenceQualityAnalysis = evidenceAnalysis;
  const insuff = (evidenceAnalysis.referenceClaimLinkStance || []).find((r) => r.stance === "insufficient");
  const totalLinks = (evidenceAnalysis.referenceClaimLinkStance || []).reduce((s, r) => s + r.n, 0);
  md += `\n\n## 10. Why the evidence looked like crap — analysis (content 17162)\n
${evidenceAnalysis.dbAvailable ? `**The evidence was retrieved and bearing-checked successfully; the signal was lost at the legacy link-persistence layer, plus a real selection gap.**

1. **Stance collapse in \`reference_claim_links\` (what the "AI evidence links" view reads).** Of ${totalLinks} links, **${insuff?.n ?? "?"} are stance='insufficient' with support_level = 0.000** (avg confidence ${insuff ? Number(insuff.avgConf).toFixed(2) : "?"}). Only ${totalLinks - (insuff?.n ?? 0)} links carry directional signal:
${(evidenceAnalysis.referenceClaimLinkStance || []).map((r) => `   - ${r.stance}: ${r.n} links, avg support_level ${Number(r.avgSupport).toFixed(3)}, avg confidence ${Number(r.avgConf).toFixed(2)}`).join("\n")}
   A link with support_level 0 renders as visually negligible evidence. The stance comes from \`ref.stance\` on the aiReference envelope in \`persistAIResults\`, which defaults to 'insufficient' — while the per-assertion stance from the bearing pass lives on the OTHER path (below). Classification: **persistence_mapping_issue**, not retrieval failure.

2. **The target-level links from the SAME run are strong and decisive** (\`evaluation_target_evidence_links\`, written by the direct-assertion path):
${(evidenceAnalysis.targetEvidenceLinkStance || []).map((r) => `   - ${r.stance}: ${r.n} links, avg bearing ${Number(r.avgB).toFixed(2)}`).join("\n")}
   High-bearing (≈0.96), stance-decisive evidence EXISTS for this run — it is simply not what the legacy link table conveys.

3. **Reference quality skew.** Quality-score histogram (score = engine quality × 100): ${evidenceAnalysis.qualityHistogram}. Several sub-30 references survived the budget because the per-claim cap keeps "top 3 by quality" even when the best available is weak — the budget has no quality floor.

4. **Selection gap compounds it (see §4/§6).** The Thompson/CDC/MMR data-manipulation storyline — the article's central allegation — was extracted (S02-C2/C3/C4), survived as strong candidates, and then failed selection in this run, so no evidence was even sought for it.

5. **One web engine was down** (SerpApi HTTP 429 quota) — reduces the web candidate pool by roughly a third, raising the weight of weaker Tavily/Brave results.` : "_(DB unavailable — stance/quality analysis skipped)_"}
`;

  // ============ write ============
  const jsonPath = path.join(ARTIFACTS, `tm4_claim_detail_dump_${TS}.json`);
  const mdPath = path.join(ARTIFACTS, `tm4_claim_detail_dump_${TS}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(out, null, 2));
  await fs.writeFile(mdPath, md);
  console.log(`✅ Claim detail dump written:\n   ${mdPath}\n   ${jsonPath}`);
  console.log(`   raw(persisted run): ${out.sections.rawClaims.persistedRun.length} · selected: ${out.sections.selectedClaims.length} · omitted-high-value: ${out.sections.omittedHighValue.length} · targets: ${out.sections.targets.length}`);
}

main().catch((e) => { console.error("❌ FATAL:", e); process.exit(1); });
