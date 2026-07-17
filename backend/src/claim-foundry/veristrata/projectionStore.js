export async function lockCf1Binding(query, bindingId) {
  const rows = await query(`SELECT * FROM claim_foundry_package_bindings
    WHERE binding_id = ? FOR UPDATE`, [bindingId]);
  return rows[0] ?? null;
}

export async function findOrCreateClaim(query, claimText, lookupText) {
  const rows = await query(`SELECT claim_id, claim_text FROM claims
    WHERE REGEXP_REPLACE(TRIM(claim_text), '[[:space:]]+', ' ') = ?
    ORDER BY claim_id LIMIT 1`, [lookupText]);
  if (rows[0]) return rows[0].claim_id;
  const result = await query(`INSERT INTO claims
    (claim_text, claim_type, veracity_score, confidence_level, last_verified)
    VALUES (?, 'task', 0, 0, CURRENT_TIMESTAMP)`, [claimText]);
  return result.insertId;
}

export function insertCf1ContentClaim(query, contentId, claimId, value) {
  return query(`INSERT INTO content_claims
    (content_id, claim_id, relationship_type, claim_role, claim_order, score_transform,
     article_stance, argument_function, search_eligible, verdict_eligible,
     selected_for_evaluation, evaluation_eligible, visibility,
     argument_mapping_rationale, argument_mapping_confidence,
     claim_foundry_package_id, claim_foundry_selected_claim_id, claim_foundry_binding_id,
     cf1_grade_target, cf1_thesis_hinge)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'workspace_eval', ?, ?, ?, ?, ?, ?, ?)`,
  [contentId, claimId, value.relationshipType, value.claimRole, value.claimOrder,
    value.scoreTransform, value.articleStance, value.argumentFunction,
    value.searchEligible, value.verdictEligible, value.rationale, value.confidence,
    value.packageId, value.selectedClaimId, value.bindingId,
    value.cf1GradeTarget, value.cf1ThesisHinge]);
}

export function insertCf1Target(query, value) {
  return query(`INSERT INTO claim_evaluation_targets
    (content_id, claim_id, target_type, target_text, object_text, source_excerpt,
     article_stance, score_transform, search_eligible, verdict_eligible, resolution_status,
     target_order, mapping_rationale, primary_query_text, query_hints_json,
     bearing_criteria_json, claim_foundry_package_id, claim_foundry_target_id,
     claim_foundry_card_id, evidence_need_card_json, cf1_grade_target, cf1_verification_target)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [value.contentId, value.claimId, value.targetType, value.targetText, value.objectText,
    value.sourceExcerpt, value.articleStance, value.scoreTransform, value.searchEligible,
    value.verdictEligible, value.resolutionStatus, value.targetOrder, value.mappingRationale,
    value.primaryQueryText, value.queryHintsJson, value.bearingCriteriaJson, value.packageId,
    value.targetId, value.cardId, value.cardJson, value.cf1GradeTarget, value.cf1VerificationTarget]);
}

export async function countCf1Projection(query, packageId) {
  const claims = await query(`SELECT COUNT(*) AS count FROM content_claims
    WHERE claim_foundry_package_id = ?`, [packageId]);
  const targets = await query(`SELECT COUNT(*) AS count FROM claim_evaluation_targets
    WHERE claim_foundry_package_id = ?`, [packageId]);
  return { selectedClaims: Number(claims[0]?.count ?? 0), targets: Number(targets[0]?.count ?? 0) };
}
