#!/usr/bin/env node

/**
 * TM4 CLAIM CORRECTION INGESTER + TUNING-RULE ANALYZER — read-only.
 *
 * Reads a manually edited correction CSV (from
 * tm4_generate_claim_correction_csv.mjs), diffs Reed's corrections against
 * the system output, classifies each correction delta, maps it to the
 * pipeline phase most likely responsible, and generalizes tuning rules.
 *
 * Usage:
 *   node scripts/testing/tm4_ingest_claim_corrections_csv.mjs --csv artifacts/tm4_claim_correction_<ts>.csv
 *
 * Output:
 *   artifacts/tm4_claim_correction_analysis_<timestamp>.{md,json}
 *   artifacts/tm4_claim_tuning_rules_<timestamp>.{md,json}
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { SOFTENING_PHRASES } from "./lib/tm4Declarativeness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

const args = process.argv.slice(2);
const csvPath = args[args.indexOf("--csv") + 1];
if (!csvPath || args.indexOf("--csv") < 0) { console.error("Usage: --csv <edited correction csv>"); process.exit(1); }

// ---- minimal RFC4180 parser (quoted multiline fields) -----------------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ---- delta detection --------------------------------------------------------
const ENTITY_RE = /\b([A-Z][a-z]+ [A-Z][a-z]+|\bCDC\b|\bFDA\b|\bWHO\b|thimerosal|aluminum|formaldehyde|MMR|DTaP|VAERS)\b/g;
const setOf = (t, re) => new Set((String(t || "").match(re) || []).map((s) => s.toLowerCase()));

function detectDeltas(row) {
  const deltas = [];
  const orig = row.selectedClaimText || row.visibleClaimText || row.targetText || "";
  const corrected = row.correctedSelectedClaimText || row.correctedSubstantiveClaim || row.correctedTargetText || "";
  if (corrected && corrected !== orig) {
    if (SOFTENING_PHRASES.some((re) => re.test(orig)) && !SOFTENING_PHRASES.some((re) => re.test(corrected))) deltas.push("topic_summary_to_declarative");
    const oe = setOf(orig, ENTITY_RE), ce = setOf(corrected, ENTITY_RE);
    if ([...ce].some((e) => !oe.has(e))) deltas.push("missing_actor_or_entity_restored");
    if (!/\d/.test(orig) && /\d/.test(corrected)) deltas.push("missing_date_study_law_stat_restored");
    if (corrected.length > orig.length * 1.3) deltas.push("missing_predicate_or_object_restored");
    if (corrected.length < orig.length * 0.6) deltas.push("vague_to_specific_compression");
  }
  if (row.correctedAttributionText) deltas.push("attribution_repaired");
  if (row.correctedSubstantiveClaim && row.embeddedSubstantiveClaim !== row.correctedSubstantiveClaim) deltas.push("embedded_substantive_claim_repaired");
  if (row.manualAction === "split") deltas.push("compound_split_needed");
  if (row.manualAction === "merge") deltas.push("merge_needed");
  if (row.manualAction === "promote_to_selected" || (row.shouldBeSelected === "yes" && row.selectedStatus !== "selected")) deltas.push("selected_claim_promoted");
  if (row.manualAction === "demote_from_selected" || (row.shouldBeSelected === "no" && row.selectedStatus === "selected")) deltas.push("selected_claim_demoted");
  if (row.desiredTargetType && row.targetType && row.desiredTargetType !== row.targetType) deltas.push("target_type_changed");
  if (row.correctedPrimaryQueryText || row.correctedQueryHints) deltas.push("query_hint_repaired");
  if (row.correctedBearingCriteria) deltas.push("bearing_criteria_repaired");
  return deltas;
}

const DELTA_PHASE = {
  topic_summary_to_declarative: "Phase 1 extraction + Phase 2/2b selection",
  missing_actor_or_entity_restored: "Phase 1 extraction",
  missing_date_study_law_stat_restored: "Phase 1 extraction",
  missing_predicate_or_object_restored: "Phase 1 extraction",
  vague_to_specific_compression: "Phase 1 extraction",
  attribution_repaired: "Phase 3 targetizer",
  embedded_substantive_claim_repaired: "Phase 1 extraction",
  compound_split_needed: "Phase 1 extraction (atomicity)",
  merge_needed: "Phase 1b reconciliation",
  selected_claim_promoted: "Phase 2/2b selection",
  selected_claim_demoted: "Phase 2/2b selection",
  target_type_changed: "Phase 3 targetizer",
  query_hint_repaired: "evidence query generation",
  bearing_criteria_repaired: "bearing criteria generation",
};

// Rule generators: generalized (never article-specific) rules keyed by delta.
const RULE_TEMPLATES = {
  topic_summary_to_declarative: "If a selected claim uses softening language (raises concerns about / debate over / handling of…), recover the hard predicate from the raw visible claim or embeddedSubstantiveClaim instead of summarizing the topic.",
  missing_actor_or_entity_restored: "Preserve named actors/organizations from the source sentence in the selected claim text; an allegation without its actor is not falsifiable.",
  missing_date_study_law_stat_restored: "Preserve dates, statistics, study identities, and law/act names verbatim; they are the falsifiable core of the claim.",
  missing_predicate_or_object_restored: "Selected claim text must keep the full subject–predicate–object proposition; do not drop the object or consequence clause.",
  vague_to_specific_compression: "Prefer the most specific atomic proposition over an umbrella restatement covering several sentences.",
  attribution_repaired: "If an attributed allegation has an embedded substantive claim, preserve BOTH the attribution target (who said it) and the substantive target (is it true).",
  embedded_substantive_claim_repaired: "When claimForm is quoted/attributed, always extract the embedded substantive proposition into embeddedSubstantiveClaim.",
  compound_split_needed: "Split compound claims joining independent propositions (multiple conjunctions/commas) into atomic claims before selection.",
  merge_needed: "Reconcile near-duplicate occurrences into one canonical claim before selection so they don't split selection scores.",
  selected_claim_promoted: "Loose audit-probe topic overlap is not enough; the selector must weight claim-bearing predicates (allegation verbs, statistics, legal actions) when ranking, so article-central allegations beat generic topic statistics.",
  selected_claim_demoted: "Do not select claims that are vague, non-falsifiable, or not article-bearing even when they carry topic anchors.",
  target_type_changed: "Do not let study_identity or attribution replace a substantive allegation; create sibling targets — the substantive proposition carries the verdict.",
  query_hint_repaired: "Query hints must quote the claim's distinguishing entities/numbers, not the topic words shared by the whole article.",
  bearing_criteria_repaired: "Bearing mustMatch criteria must be entity/predicate-derived; generic criteria admit tangential sources.",
};

async function main() {
  const rows = parseCsv(await fs.readFile(csvPath, "utf-8"));
  const edited = rows.filter((r) => MANUALLY_EDITED(r));
  function MANUALLY_EDITED(r) {
    return ["manualAction", "correctedSelectedClaimText", "correctedSubstantiveClaim", "correctedAttributionText",
      "correctedTargetText", "correctedPrimaryQueryText", "correctedBearingCriteria", "correctedQueryHints",
      "correctedAnchorFamily", "shouldBeSelected", "correctionLabels", "manualNotes"]
      .some((c) => String(r[c] || "").trim() !== "");
  }

  const corrections = edited.map((r) => {
    const deltas = detectDeltas(r);
    return {
      rowId: r.rowId, sourceClaimId: r.sourceClaimId, rowType: r.rowType,
      originalText: r.selectedClaimText || r.visibleClaimText || r.targetText,
      correctedText: r.correctedSelectedClaimText || r.correctedSubstantiveClaim || r.correctedTargetText || "(no text rewrite)",
      manualAction: r.manualAction || "(none)",
      correctionLabels: (r.correctionLabels || "").split("|").filter(Boolean),
      shouldBeSelected: r.shouldBeSelected || "",
      detectedDeltas: deltas,
      likelyAffectedPhases: [...new Set(deltas.map((d) => DELTA_PHASE[d]))],
      manualNotes: r.manualNotes || "",
    };
  });

  // Generalized rules: any delta observed OR label supplied activates its template, with evidence rows.
  const ruleEvidence = new Map();
  const activate = (key, rowId) => {
    if (!RULE_TEMPLATES[key]) return;
    if (!ruleEvidence.has(key)) ruleEvidence.set(key, []);
    ruleEvidence.get(key).push(rowId);
  };
  const LABEL_TO_DELTA = {
    softening_removed: "topic_summary_to_declarative", topic_to_claim: "topic_summary_to_declarative",
    predicate_restored: "missing_predicate_or_object_restored", named_entity_restored: "missing_actor_or_entity_restored",
    number_or_date_restored: "missing_date_study_law_stat_restored", study_identity_restored: "missing_date_study_law_stat_restored",
    attribution_restored: "attribution_repaired", embedded_substantive_claim_restored: "embedded_substantive_claim_repaired",
    compound_split: "compound_split_needed", wrong_target_type: "target_type_changed",
    query_hint_repaired: "query_hint_repaired", bearing_criteria_repaired: "bearing_criteria_repaired",
    should_have_been_selected: "selected_claim_promoted", should_not_have_been_selected: "selected_claim_demoted",
    too_vague: "topic_summary_to_declarative", not_falsifiable: "selected_claim_demoted",
    duplicate_or_redundant: "merge_needed", not_article_central: "selected_claim_demoted",
  };
  for (const c of corrections) {
    for (const d of c.detectedDeltas) activate(d, c.rowId);
    for (const l of c.correctionLabels) activate(LABEL_TO_DELTA[l], c.rowId);
  }
  const rules = [...ruleEvidence.entries()].map(([key, rowIds]) => ({
    ruleId: key, rule: RULE_TEMPLATES[key], affectedPhase: DELTA_PHASE[key],
    evidenceRowCount: rowIds.length, evidenceRowIds: rowIds.slice(0, 20),
  })).sort((a, b) => b.evidenceRowCount - a.evidenceRowCount);

  // ---- artifacts ----
  const analysis = { timestamp: TS, csv: path.relative(ROOT, csvPath), totalRows: rows.length, editedRows: edited.length, corrections };
  const aJson = path.join(ARTIFACTS, `tm4_claim_correction_analysis_${TS}.json`);
  await fs.writeFile(aJson, JSON.stringify(analysis, null, 2));
  const aMd = path.join(ARTIFACTS, `tm4_claim_correction_analysis_${TS}.md`);
  await fs.writeFile(aMd, `# TM4 Claim Correction Analysis — ${TS}

Source: \`${analysis.csv}\` — ${analysis.editedRows} of ${analysis.totalRows} rows carry manual corrections.

${corrections.map((c) => `## ${c.rowId} (${c.sourceClaimId || "—"}, ${c.rowType})
- **original:** "${c.originalText}"
- **corrected:** "${c.correctedText}"
- action: \`${c.manualAction}\` · shouldBeSelected: ${c.shouldBeSelected || "—"} · labels: ${c.correctionLabels.join(", ") || "—"}
- detected deltas: ${c.detectedDeltas.join(", ") || "(from labels only)"}
- likely affected phase(s): ${c.likelyAffectedPhases.join("; ") || "—"}
${c.manualNotes ? `- notes: ${c.manualNotes}` : ""}`).join("\n\n") || "_No edited rows found — fill the manual columns and re-run._"}
`);

  const rJson = path.join(ARTIFACTS, `tm4_claim_tuning_rules_${TS}.json`);
  await fs.writeFile(rJson, JSON.stringify({ timestamp: TS, source: analysis.csv, rules }, null, 2));
  const rMd = path.join(ARTIFACTS, `tm4_claim_tuning_rules_${TS}.md`);
  await fs.writeFile(rMd, `# TM4 Claim Tuning Rules — ${TS}

Generalized from ${analysis.editedRows} manual corrections in \`${analysis.csv}\`. Rules are article-agnostic; evidence rows show which corrections activated each rule.

${rules.map((r, i) => `## Rule ${i + 1}: ${r.ruleId} (${r.evidenceRowCount} correction${r.evidenceRowCount === 1 ? "" : "s"})
> ${r.rule}

- affected phase: **${r.affectedPhase}**
- evidence: ${r.evidenceRowIds.join(", ")}`).join("\n\n") || "_No rules activated yet._"}
`);

  console.log(`✅ Ingested ${edited.length} corrected rows → ${rules.length} generalized rules`);
  console.log(`   ${aMd}\n   ${aJson}\n   ${rMd}\n   ${rJson}`);
}

main().catch((e) => { console.error("❌ FATAL:", e.message || e); process.exit(1); });
