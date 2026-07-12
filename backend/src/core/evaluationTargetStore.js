import logger from "../utils/logger.js";

export const EVALUATION_TARGET_TYPES = new Set(["attribution", "substantive", "inference", "study_identity"]);

const clean = (value, max = 10000) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const bool = (value, fallback) => value == null ? fallback : value === true || value === 1 || value === "1";

export function normalizeEvaluationTarget(raw = {}, context = {}) {
  const targetType = EVALUATION_TARGET_TYPES.has(raw.targetType || raw.target_type) ? (raw.targetType || raw.target_type) : "substantive";
  const targetText = clean(raw.targetText || raw.target_text || raw.objectText || raw.object_text || context.objectClaim || context.claimText);
  return {
    evaluationTargetId: Number(raw.evaluationTargetId || raw.evaluation_target_id) || null,
    contentId: Number(raw.contentId || raw.content_id || context.contentId) || null,
    claimId: Number(raw.claimId || raw.claim_id || context.claimId) || null,
    parentTargetId: Number(raw.parentTargetId || raw.parent_target_id) || null,
    targetType,
    targetText,
    subjectEntity: clean(raw.subjectEntity || raw.subject_entity, 500),
    predicate: clean(raw.predicate || raw.predicateText || raw.predicate_text, 500),
    objectText: clean(raw.objectText || raw.object_text || (targetType === "substantive" ? targetText : "")),
    allegedAction: clean(raw.allegedAction || raw.alleged_action, 500),
    studyTitle: clean(raw.studyTitle || raw.study_title),
    studyAuthors: clean(raw.studyAuthors || raw.study_authors),
    studyYear: Number(raw.studyYear || raw.study_year) || null,
    studyIdentifier: clean(raw.studyIdentifier || raw.study_identifier, 255),
    populationScope: clean(raw.populationScope || raw.population_scope),
    sourceExcerpt: clean(raw.sourceExcerpt || raw.source_excerpt),
    articleStance: clean(raw.articleStance || raw.article_stance || context.articleStance || "unclear", 32),
    scoreTransform: clean(raw.scoreTransform || raw.score_transform || context.scoreTransform || "review", 32),
    searchEligible: bool(raw.searchEligible ?? raw.search_eligible, true),
    verdictEligible: bool(raw.verdictEligible ?? raw.verdict_eligible, targetType !== "study_identity"),
    resolutionStatus: clean(raw.resolutionStatus || raw.resolution_status || (targetText ? "mapped" : "underspecified"), 32),
    targetOrder: Number(raw.targetOrder ?? raw.target_order ?? context.targetOrder) || 0,
    mappingConfidence: Number(raw.mappingConfidence ?? raw.mapping_confidence ?? context.mappingConfidence) || 0,
    mappingRationale: clean(raw.mappingRationale || raw.mapping_rationale || context.mappingRationale),
    // TM4 query-hint layer (Phase 3): the enriched primary query + the sidecar
    // evidence-affordance expansion (sibling document leads). Surfaced here so
    // the query builder can consume them; null when the column is absent.
    primaryQueryText: clean(raw.primaryQueryText || raw.primary_query_text || (raw.queryHints || parseJsonSafe(raw.query_hints_json))?.primaryQueryText),
    queryHints: raw.queryHints || parseJsonSafe(raw.query_hints_json) || null,
    bearingCriteria: raw.bearingCriteria || parseJsonSafe(raw.bearing_criteria_json) || null,
    weakBearing: bool(raw.weakBearing ?? raw.weak_bearing, false),
  };
}

// Parse a JSON column that may arrive as a string or already-parsed object.
function parseJsonSafe(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

export async function loadClaimEvaluationTargets(query, contentId, claimIds = [], {
  enableMultiTarget = process.env.ENABLE_MULTI_TARGET_EVIDENCE === "true",
} = {}) {
  if (typeof query !== "function") throw new Error("loadClaimEvaluationTargets: missing query");
  if (!contentId || !claimIds.length) return new Map();
  const ids = claimIds.map(Number).filter(Number.isFinite);
  let rows = [];
  if (enableMultiTarget) {
    try {
      rows = await query("SELECT * FROM claim_evaluation_targets WHERE content_id = ? AND claim_id IN (?) ORDER BY claim_id, target_order, evaluation_target_id", [contentId, ids]);
    } catch (error) {
      logger.warn(`[evaluationTargets] Target table unavailable; using object_claim_text compatibility path: ${error.message}`);
    }
  }
  const byClaim = new Map(ids.map((id) => [id, []]));
  for (const row of rows || []) byClaim.get(Number(row.claim_id))?.push(normalizeEvaluationTarget(row));
  const missing = ids.filter((id) => !byClaim.get(id)?.length);
  if (missing.length) {
    const legacy = await query(
      `SELECT c.claim_id, c.claim_text, cc.object_claim_text, cc.article_stance,
              cc.score_transform, cc.argument_mapping_confidence, cc.argument_mapping_rationale
         FROM claims c
         JOIN content_claims cc ON cc.claim_id = c.claim_id
        WHERE cc.content_id = ? AND c.claim_id IN (?)`,
      [contentId, missing],
    );
    for (const row of legacy || []) {
      const mappingUnresolved = String(row.argument_mapping_rationale || "")
        .startsWith("target_mapping_unresolved:");
      const target = normalizeEvaluationTarget({
        claimId: row.claim_id,
        contentId,
        targetType: mappingUnresolved ? "study_identity" : "substantive",
        targetText: mappingUnresolved
          ? `Resolve the exact study, document, or attribution anchors for: ${row.object_claim_text || row.claim_text}`
          : row.object_claim_text || row.claim_text,
        objectText: row.object_claim_text || row.claim_text,
        articleStance: row.article_stance,
        scoreTransform: mappingUnresolved ? "none" : row.score_transform,
        searchEligible: true,
        verdictEligible: !mappingUnresolved,
        resolutionStatus: mappingUnresolved ? "underspecified" : "mapped",
        mappingConfidence: row.argument_mapping_confidence,
        mappingRationale: row.argument_mapping_rationale,
      });
      byClaim.set(Number(row.claim_id), [target]);
    }
  }
  return byClaim;
}

export async function enrichTaskClaimsForMatching(query, contentId, taskClaims) {
  if (!contentId || !Array.isArray(taskClaims) || !taskClaims.length) return taskClaims;
  const ids = taskClaims.map((c) => Number(c.id)).filter(Number.isFinite);
  if (!ids.length) return taskClaims;
  let targetsByClaim;
  try {
    targetsByClaim = await loadClaimEvaluationTargets(query, contentId, ids);
  } catch {
    return taskClaims;
  }
  return taskClaims.map((claim) => {
    const targets = targetsByClaim.get(Number(claim.id)) || [];
    const primary = targets.find((t) => t.targetType === "substantive") || targets[0];
    const enrichedText = primary?.targetText?.trim() || "";
    return {
      ...claim,
      ...(enrichedText ? { text: enrichedText } : {}),
      evaluationTargets: targets,
    };
  });
}

const MIN_BEARING_FOR_TARGET_LINK = 0.25;

export async function dualWriteTargetEvidenceLinks(query, taskContentId, claimMatches, referenceContentId) {
  if (process.env.ENABLE_MULTI_TARGET_EVIDENCE !== "true") return;
  if (!Array.isArray(claimMatches) || !claimMatches.length) return;
  const taskClaimIds = [...new Set(claimMatches.map((m) => Number(m.taskClaimId)).filter(Number.isFinite))];
  if (!taskClaimIds.length) return;
  let targetRows = [];
  try {
    // Phase 7: look up ALL verdict-eligible targets (not just substantive) so attribution,
    // inference, and study_identity targets can also receive evidence links.
    targetRows = await query(
      `SELECT evaluation_target_id, claim_id, target_type FROM claim_evaluation_targets
       WHERE content_id = ? AND claim_id IN (?) AND verdict_eligible = 1
       ORDER BY claim_id, target_order`,
      [taskContentId, taskClaimIds],
    );
  } catch (err) {
    logger.warn(`[evaluationTargets] dualWriteTargetEvidenceLinks lookup failed: ${err.message}`);
    return;
  }
  // Phase 7: map claimId → primary target per type so we can route by target type when available.
  const targetsByClaimId = new Map();
  for (const r of targetRows || []) {
    const claimId = Number(r.claim_id);
    if (!targetsByClaimId.has(claimId)) targetsByClaimId.set(claimId, []);
    targetsByClaimId.get(claimId).push({ evaluationTargetId: Number(r.evaluation_target_id), targetType: r.target_type || null });
  }

  for (const match of claimMatches) {
    const claimTargets = targetsByClaimId.get(Number(match.taskClaimId));
    if (!claimTargets?.length) continue;

    const raw = String(match.stance || "").toLowerCase();
    const stance = raw === "supports" ? "support"
      : raw === "refutes" ? "refute"
      : raw === "related" ? "nuance"
      : ["support", "refute", "nuance", "insufficient"].includes(raw) ? raw
      : "insufficient";
    const bearingScore = Number.isFinite(Number(match.bearingScore))
      ? Math.max(0, Math.min(1, Number(match.bearingScore)))
      : Math.max(0, Math.min(1, Math.abs(Number(match.supportLevel) || 0) / 1.2));

    // Phase 7: prevent shared-topic evidence from creating links without predicate-level bearing.
    if (bearingScore < MIN_BEARING_FOR_TARGET_LINK) continue;

    // Route to the specific target type when the match carries target context;
    // otherwise fall back to the primary substantive target (for backward compatibility).
    const explicitTargetId = Number(match.evaluationTargetId || match.evidenceTargetId) || null;
    const matchTargetType = match.evaluationTargetType || match.evidenceTargetType || null;
    let targetToLink = null;
    if (explicitTargetId) {
      targetToLink = claimTargets.find((target) => target.evaluationTargetId === explicitTargetId) || null;
    } else if (matchTargetType) {
      // An explicit type that does not exist is a routing failure, not
      // permission to silently attach evidence to another target.
      targetToLink = claimTargets.find((target) => target.targetType === matchTargetType) || null;
    } else {
      targetToLink = claimTargets.find((target) => target.targetType === "substantive") ||
        (claimTargets.length === 1 ? claimTargets[0] : null);
    }
    const evaluationTargetId = targetToLink?.evaluationTargetId;
    if (!evaluationTargetId) continue;

    try {
      await query(
        `INSERT INTO evaluation_target_evidence_links
          (evaluation_target_id, reference_content_id, reference_claim_id, stance, bearing_score, confidence, rationale, created_by_ai)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           stance = VALUES(stance),
           bearing_score = VALUES(bearing_score),
           confidence = VALUES(confidence),
           rationale = VALUES(rationale)`,
        [evaluationTargetId, referenceContentId ?? null, match.referenceClaimId ?? null,
         stance, bearingScore, Number(match.confidence) || 0,
         String(match.rationale || "").slice(0, 2000)],
      );
    } catch (err) {
      logger.warn(`[evaluationTargets] dualWriteTargetEvidenceLinks insert failed for target ${evaluationTargetId}: ${err.message}`);
    }
  }
}

export async function replaceClaimEvaluationTargets(query, contentId, claimId, targets = []) {
  if (process.env.ENABLE_MULTI_TARGET_EVIDENCE !== "true") return [];
  const normalized = targets.map((target, index) => normalizeEvaluationTarget(target, { contentId, claimId, targetOrder: index }));
  await query("DELETE FROM claim_evaluation_targets WHERE content_id = ? AND claim_id = ?", [contentId, claimId]);
  const inserted = [];
  for (const target of normalized) {
    const result = await query(
      `INSERT INTO claim_evaluation_targets
        (content_id, claim_id, parent_target_id, target_type, target_text, subject_entity,
         predicate_text, object_text, alleged_action, study_title, study_authors, study_year,
         study_identifier, population_scope, source_excerpt, article_stance, score_transform,
         search_eligible, verdict_eligible, resolution_status, target_order,
         mapping_confidence, mapping_rationale)
       VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
               NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
               ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''))`,
      [contentId, claimId, target.parentTargetId, target.targetType, target.targetText,
       target.subjectEntity, target.predicate, target.objectText, target.allegedAction,
       target.studyTitle, target.studyAuthors, target.studyYear, target.studyIdentifier,
       target.populationScope, target.sourceExcerpt, target.articleStance, target.scoreTransform,
       target.searchEligible ? 1 : 0, target.verdictEligible ? 1 : 0, target.resolutionStatus,
       target.targetOrder, target.mappingConfidence, target.mappingRationale],
    );
    inserted.push({ ...target, evaluationTargetId: result.insertId || null });
  }
  return inserted;
}
