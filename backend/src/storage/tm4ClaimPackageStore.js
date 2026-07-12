// backend/src/storage/tm4ClaimPackageStore.js
//
// Schema-first persistence for TM4 claim packages.
//
// Persists the full TM4 pipeline output into the tables created by
// backend/migrations/tm4_claim_package_persistence.sql:
//   tm4_claim_packages            — run/package record
//   tm4_raw_claim_occurrences     — ALL Phase 1 occurrences (audit/provenance)
//   tm4_claim_reconciliations     — Phase 1b duplicate/stance groups
//   tm4_selected_evaluation_claims — the 8–12 product-facing claims,
//                                    anchored to content_claims.cc_id
// and stamps the TM4 columns (primary_query_text, query_hints_json,
// bearing_criteria_json, quality fields) onto the existing
// claim_evaluation_targets rows the evidence engine consumes.
//
// PERSISTED ≠ WORKSPACE-VISIBLE: nothing in this module writes to
// content_claims. Workspace visibility is decided by which claims the caller
// materialized into content_claims (selectedEvaluationClaims only).

import crypto from "crypto";
import logger from "../utils/logger.js";

const j = (v) => (v == null ? null : JSON.stringify(v));

export class Tm4TablesMissingError extends Error {
  constructor(cause) {
    super(
      "TM4 persistence tables are missing. Run backend/migrations/tm4_claim_package_persistence.sql first. " +
      `(${cause?.message || cause})`
    );
    this.name = "Tm4TablesMissingError";
  }
}

const isMissingTable = (err) => err?.code === "ER_NO_SUCH_TABLE";

/**
 * Persist a complete TM4 run.
 *
 * @param query   promisified db query
 * @param payload {
 *   contentId, runId, pipelineVersion, sourcePackagePath, fixtureName,
 *   articleThesis, selectionSummary, diagnostics,
 *   rawClaims,           // ALL readiness entries (Phase 1/1b/2 merged)
 *   selectedClaims,      // Phase 2b output (selectionRank/Score/Rationale/…)
 *   nonSelectedClaims,   // Phase 2b output (suppressionReason, selectionScore)
 *   dbClaimIdBySourceId, // Map tm4 source_claim_id -> claims.claim_id (selected only)
 *   targetTm4Fields,     // [{evaluationTargetId, tm4Target}] for column stamping
 * }
 * @returns { packageId, counts }
 */
export async function persistTm4ClaimPackage(query, payload) {
  const {
    contentId, runId, pipelineVersion = "tm4-preview-1",
    sourcePackagePath = null, fixtureName = null,
    articleThesis = "", selectionSummary = null, diagnostics = null,
    rawClaims = [], selectedClaims = [], nonSelectedClaims = [],
    dbClaimIdBySourceId = new Map(), targetTm4Fields = [],
  } = payload;

  if (!contentId || !runId) throw new Error("persistTm4ClaimPackage: contentId and runId required");

  const packageHash = crypto.createHash("sha256")
    .update(JSON.stringify({ rawClaims, selectedClaims: selectedClaims.map((c) => c.claimId) }))
    .digest("hex");

  const selectedBySourceId = new Map(selectedClaims.map((c) => [c.claimId, c]));
  const suppressionBySourceId = new Map(nonSelectedClaims.map((c) => [c.claimId, c]));

  // 1) Package row
  let pkgResult;
  try {
    pkgResult = await query(
      `INSERT INTO tm4_claim_packages
        (content_id, run_id, pipeline_version, source_package_path, source_package_hash,
         fixture_name, article_thesis, raw_claim_count, selected_claim_count, target_count,
         selection_summary_json, diagnostics_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [contentId, runId, pipelineVersion, sourcePackagePath, packageHash, fixtureName,
       String(articleThesis).slice(0, 4000), rawClaims.length, selectedClaims.length,
       targetTm4Fields.length, j(selectionSummary), j(diagnostics)]
    );
  } catch (err) {
    if (isMissingTable(err)) throw new Tm4TablesMissingError(err);
    throw err;
  }
  const packageId = pkgResult.insertId;

  // 2) Raw occurrences — every Phase 1 occurrence, selected or not.
  const rawIdBySourceId = new Map();
  for (let i = 0; i < rawClaims.length; i++) {
    const c = rawClaims[i];
    const sel = selectedBySourceId.get(c.claimId);
    const sup = suppressionBySourceId.get(c.claimId);
    const res = await query(
      `INSERT INTO tm4_raw_claim_occurrences
        (tm4_claim_package_id, content_id, claim_id, source_claim_id, occurrence_order,
         section_index, section_heading, visible_claim_text, canonical_excerpt,
         source_sentence_ids_json, claim_form, article_use, speaker_source,
         embedded_substantive_claim, warrant_context, score_transform, evaluation_lane_hint,
         pillar_id, cluster_id, phase2_role, is_selected, suppression_reason,
         selection_score, phase1_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [packageId, contentId,
       sel ? dbClaimIdBySourceId.get(c.claimId) ?? null : null,
       c.claimId, i,
       Number(String(c.claimId).match(/^S(\d+)/)?.[1]) ?? null,
       null,
       c.visibleClaimText || "", c.canonicalExcerpt || null,
       j(c.sourceSentenceIds || []), c.claimForm || null, c.articleUse || null,
       (c.speakerOrSource || "").slice(0, 255) || null,
       c.embeddedSubstantiveClaim || null,
       (c.warrantHint || "").slice(0, 512) || null,
       (c.scoreTransformHint || "").slice(0, 16) || null,
       c.evaluationLaneHint || null,
       c.phase2PillarId || null, c.phase2ClusterId || null, c.phase2Role || null,
       sel ? 1 : 0,
       sel ? null : (sup?.suppressionReason || "not selected").slice(0, 255),
       sel?.selectionScore ?? sup?.selectionScore ?? null,
       j(c)]
    );
    rawIdBySourceId.set(c.claimId, res.insertId);
  }

  // 3) Reconciliation records — one row per occurrence that belongs to a group.
  let reconCount = 0;
  for (const c of rawClaims) {
    const r = c.reconciliation;
    if (!r?.groupId) continue;
    await query(
      `INSERT INTO tm4_claim_reconciliations
        (tm4_claim_package_id, group_id, raw_occurrence_id, source_claim_id,
         canonical_source_claim_id, status, reconciliation_reason, reconciliation_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [packageId, r.groupId, rawIdBySourceId.get(c.claimId), c.claimId,
       r.canonicalOccurrenceId || null, r.status || null,
       (r.reason || "").slice(0, 512) || null, j(r)]
    );
    reconCount++;
  }

  // 4) Selected evaluation claims — anchored to content_claims.cc_id.
  for (const sel of selectedClaims) {
    const dbClaimId = dbClaimIdBySourceId.get(sel.claimId);
    if (!dbClaimId) throw new Error(`persistTm4ClaimPackage: no claims.claim_id for selected ${sel.claimId}`);
    const ccRows = await query(
      `SELECT cc_id FROM content_claims WHERE content_id = ? AND claim_id = ? AND relationship_type = 'task' LIMIT 1`,
      [contentId, dbClaimId]
    );
    const ccId = ccRows?.[0]?.cc_id ?? null;
    if (!ccId) logger.warn(`[tm4ClaimPackageStore] No content_claims row for selected claim ${sel.claimId} (claim_id ${dbClaimId})`);
    await query(
      `INSERT INTO tm4_selected_evaluation_claims
        (tm4_claim_package_id, content_id, content_claim_id, claim_id,
         source_raw_occurrence_id, source_claim_id, cluster_id, pillar_id,
         selection_rank, selection_score, thesis_relevance_score, evidence_priority,
         representative_claim_text, evaluation_question, selection_reason,
         selection_breakdown_json, source_raw_claim_ids_json,
         is_workspace_visible, is_evidence_eligible)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [packageId, contentId, ccId, dbClaimId,
       rawIdBySourceId.get(sel.claimId) ?? null, sel.claimId,
       sel.phase2ClusterId || null, sel.phase2PillarId || null,
       sel.selectionRank, sel.selectionScore ?? null, sel.selectionScore ?? null,
       sel.selectionRank,
       sel.visibleClaimText || "", null, sel.selectionRationale || null,
       j(sel.selectionBreakdown || null), j(sel.sourceRawClaimIds || [sel.claimId])]
    );
  }

  // 5) Stamp TM4 columns onto the engine-facing claim_evaluation_targets rows.
  let stampedTargets = 0;
  for (const { evaluationTargetId, tm4Target } of targetTm4Fields) {
    if (!evaluationTargetId || !tm4Target) continue;
    await query(
      `UPDATE claim_evaluation_targets
          SET source_claim_id = ?, target_key = ?, primary_query_text = ?,
              query_hints_json = ?, bearing_criteria_json = ?,
              quality_status = ?, quality_flags_json = ?,
              weak_bearing = ?, needs_atomic_split = ?
        WHERE evaluation_target_id = ?`,
      [tm4Target.sourceClaimId || null, (tm4Target.targetId || "").slice(0, 64) || null,
       tm4Target.queryHints?.primaryQueryText || null,
       j(tm4Target.queryHints || null), j(tm4Target.bearingCriteria || null),
       tm4Target.qualityStatus || "passing", j(tm4Target.qualityFlags || null),
       tm4Target.bearingCriteria?.weak ? 1 : 0,
       tm4Target.needsAtomicSplit ? 1 : 0,
       evaluationTargetId]
    );
    stampedTargets++;
  }

  const counts = {
    packageId,
    rawOccurrences: rawIdBySourceId.size,
    reconciliations: reconCount,
    selectedClaims: selectedClaims.length,
    stampedTargets,
  };
  logger.log(`[tm4ClaimPackageStore] Persisted package ${packageId} (run ${runId}): ${JSON.stringify(counts)}`);
  return counts;
}

/**
 * The evidence gating query: candidates come ONLY from
 * tm4_selected_evaluation_claims (is_evidence_eligible=1) joined to their
 * search-eligible claim_evaluation_targets. Raw occurrences and non-selected
 * claims can never appear here.
 */
export async function loadTm4EvidenceCandidates(query, contentId) {
  try {
    return await query(
      `SELECT sec.tm4_selected_evaluation_claim_id, sec.claim_id, sec.content_claim_id,
              sec.selection_rank, sec.representative_claim_text, sec.source_claim_id,
              t.evaluation_target_id, t.target_type, t.target_text,
              t.primary_query_text, t.query_hints_json, t.bearing_criteria_json,
              t.score_transform, t.search_eligible, t.verdict_eligible,
              t.weak_bearing, t.needs_atomic_split
         FROM tm4_selected_evaluation_claims sec
         LEFT JOIN claim_evaluation_targets t
           ON t.content_id = sec.content_id AND t.claim_id = sec.claim_id AND t.search_eligible = 1
        WHERE sec.content_id = ? AND sec.is_evidence_eligible = 1
        ORDER BY sec.selection_rank, t.target_order`,
      [contentId]
    );
  } catch (err) {
    if (isMissingTable(err)) throw new Tm4TablesMissingError(err);
    throw err;
  }
}
