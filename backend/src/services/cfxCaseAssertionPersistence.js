// Persists CFX S2 (substantive review) results -- case assertions with
// their attached evidenceSearchHandoff -- as production claims,
// content_claims, and claim_evaluation_targets.query_hints_json rows.
//
// Same SQL shape as scripts/dev/seedCfxWorkspaceFixture.mjs's
// findOrCreateClaim/upsertWorkspaceClaim/upsertEvaluationTarget (proven
// against the fixture path), but takes a freshly-generated S2 review result
// for an already-scraped content_id instead of reading a frozen JSON file.
// Lives outside claimfoundry/cfx and claimfoundry/ entirely -- this is the
// application-orchestration-layer persistence step.
//
// Takes `query` directly rather than a pool, matching every other CFX
// persistence helper (cfxProductionEvidenceStore.js, cfxCanonicalDocumentStore.js,
// etc.) -- transaction ownership belongs to the caller, exactly the way
// cfxEvidenceCoordinator.js and cfxProductionEvidencePipeline.js already wrap
// their own persistence calls:
//
//   await withTransaction(({ query }) =>
//     persistCfxCaseAssertions({ query, taskContentId, results }), { pool });
//
// That gives the same all-12-or-nothing atomicity without this file taking on
// pool/connection lifecycle it has no other reason to own.

import { clearContentClaimLinks } from "../storage/persistClaims.js";

function requirePositive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

async function findOrCreateClaim(query, claimText) {
  const existing = await query(
    `SELECT claim_id FROM claims
      WHERE claim_type='task' AND claim_text=?
      ORDER BY claim_id LIMIT 1 FOR UPDATE`,
    [claimText],
  );
  if (existing[0]) return Number(existing[0].claim_id);
  const result = await query(
    `INSERT INTO claims
       (claim_text,claim_type,triage_status,triaged_by,triage_reasoning,
        veracity_score,confidence_level,last_verified)
     VALUES (?,'task','active_evaluation','rule',
       'CFX case assertion extracted from a live scrape; no truth judgment has been made.',0,0,NOW())`,
    [claimText],
  );
  return requirePositive(Number(result.insertId), "claimId");
}

async function upsertWorkspaceClaim(query, { contentId, claimId, order, assertion, assertionSource, articleStance }) {
  const rows = await query(
    "SELECT cc_id FROM content_claims WHERE content_id=? AND claim_id=? ORDER BY cc_id LIMIT 1 FOR UPDATE",
    [contentId, claimId],
  );
  if (rows[0]) {
    await query(
      `UPDATE content_claims SET relationship_type='contains',claim_role='pillar',
         claim_order=?,object_claim_text=?,speaker_entity=?,article_stance=?,
         selected_for_evaluation=1,evaluation_eligible=1,search_eligible=1,
         verdict_eligible=1,source_eligible=0,visibility='workspace_eval'
       WHERE cc_id=?`,
      [order, assertion, assertionSource, articleStance, rows[0].cc_id],
    );
    return Number(rows[0].cc_id);
  }
  const result = await query(
    `INSERT INTO content_claims
       (content_id,claim_id,relationship_type,claim_role,claim_order,
        object_claim_text,speaker_entity,article_stance,selected_for_evaluation,
        evaluation_eligible,search_eligible,verdict_eligible,source_eligible,visibility)
     VALUES (?,?,'contains','pillar',?,?,?,?,1,1,1,1,0,'workspace_eval')`,
    [contentId, claimId, order, assertion, assertionSource, articleStance],
  );
  return requirePositive(Number(result.insertId), "contentClaimId");
}

async function upsertEvaluationTarget(query, { contentId, claimId, order, proposition }) {
  const handoff = proposition.evidenceSearchHandoff;
  const queryHints = {
    propositionId: proposition.propositionId,
    groundingUnitIds: handoff?.groundingUnitIds || [],
    literalIdentifiers: handoff?.literalIdentifiers || null,
    lookupHints: handoff?.lookupHints || null,
    deterministicQueries: handoff?.queries || null,
  };
  await query(
    `INSERT INTO claim_evaluation_targets
       (content_id,claim_id,target_type,target_text,subject_entity,object_text,
        source_excerpt,article_stance,score_transform,search_eligible,
        verdict_eligible,resolution_status,target_order,mapping_confidence,
        mapping_rationale,source_claim_id,target_key,query_hints_json)
     VALUES (?,?,'assertion',?,?,?,?,?,'review',1,1,'unresolved',?,1.0000,
       'CFX S2 substantive-review case assertion from a live scrape.',?,?,?)
     ON DUPLICATE KEY UPDATE target_type=VALUES(target_type),
       target_text=VALUES(target_text),subject_entity=VALUES(subject_entity),
       object_text=VALUES(object_text),source_excerpt=VALUES(source_excerpt),
       article_stance=VALUES(article_stance),score_transform=VALUES(score_transform),
       search_eligible=1,verdict_eligible=1,resolution_status='unresolved',
       mapping_confidence=VALUES(mapping_confidence),
       mapping_rationale=VALUES(mapping_rationale),source_claim_id=VALUES(source_claim_id),
       target_key=VALUES(target_key),query_hints_json=VALUES(query_hints_json)`,
    [contentId, claimId, proposition.substantiveAssertion,
      proposition.assertionSource, proposition.substantiveAssertion,
      handoff?.groundingText || proposition.substantiveAssertion,
      proposition.articleStance, order,
      proposition.propositionId, `CFX-${proposition.propositionId}`,
      JSON.stringify(queryHints)],
  );
}

/**
 * Persists a CFX S2 substantive-review result (exactly the 12 case
 * assertions, each optionally carrying an evidenceSearchHandoff) for one
 * already-scraped content_id. Idempotent: re-running with the same or
 * updated results clears and replaces this task's prior 'contains'
 * content_claims links first, so reruns cannot duplicate claims,
 * content_claims rows, or claim_evaluation_targets rows for this content_id.
 *
 * Accepts `query` directly (see file header for why, and how to make this
 * call transaction-safe via the caller).
 *
 * @param {{query: Function, taskContentId: number, results: Array}} input
 * @returns {Promise<{claimIds: number[], claims: Array<{propositionId: string, claimId: number, assertion: string}>}>}
 */
export async function persistCfxCaseAssertions({ query, taskContentId, results }) {
  const contentId = requirePositive(Number(taskContentId), "taskContentId");
  if (!Array.isArray(results) || !results.length) {
    throw new TypeError("results must be a non-empty array of S2 substantive-review propositions");
  }
  // Each run's S2 output can differ slightly (LLM stochasticity), so a claim
  // text that doesn't exactly match an earlier run's wording creates a new
  // claim_id via findOrCreateClaim rather than reusing one -- without
  // clearing prior runs' 'contains' links first, content_claims accumulates
  // duplicate claim_order values across runs (this relationship_type is
  // scoped to this exact taskContentId, distinct from the same label used
  // for reference-document evidence assertions under other content_ids, so
  // clearing it here cannot touch those).
  await clearContentClaimLinks(query, contentId, ["contains"]);
  const claims = [];
  for (const [index, proposition] of results.entries()) {
    const claimId = await findOrCreateClaim(query, proposition.substantiveAssertion);
    await upsertWorkspaceClaim(query, {
      contentId,
      claimId,
      order: index,
      assertion: proposition.substantiveAssertion,
      assertionSource: proposition.assertionSource,
      articleStance: proposition.articleStance,
    });
    await upsertEvaluationTarget(query, { contentId, claimId, order: index, proposition });
    claims.push({ propositionId: proposition.propositionId, claimId, assertion: proposition.substantiveAssertion });
  }
  return { claimIds: claims.map((c) => c.claimId), claims };
}
