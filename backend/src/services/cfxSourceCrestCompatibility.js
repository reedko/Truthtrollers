import {
  enrichPublisherIfNeeded,
  reEvaluateAdmiraltyForPublisher,
} from "./publisherEnrichmentService.js";

function positive(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return number;
}

const legitimateSourceCrest = (value) => /^[A-E](?:[1-5]|Ø)$/u.test(String(value || ""));

/**
 * Run the complete production publisher-to-SourceCrest lifecycle for one
 * canonical evidence document:
 *
 * 1. resolve its persisted publisher identity;
 * 2. run production publisher enrichment (including its freshness gates);
 * 3. reload persisted profiles, ratings, and provider signals;
 * 4. run the existing Admiralty evaluator;
 * 5. return the persisted content-level evaluation.
 *
 * reEvaluateAdmiraltyForPublisher owns steps 3-5. Although production
 * enrichment currently performs its own synchronous reevaluation, the explicit
 * final reevaluation here makes this adapter's postcondition independent of
 * that implementation detail and introduces no additional external call.
 */
export async function ensureCfxSourceCrest({
  query,
  referenceContentId,
  publisherId = null,
  publisherName = null,
  enricher = enrichPublisherIfNeeded,
  evaluator = reEvaluateAdmiraltyForPublisher,
} = {}) {
  if (typeof query !== "function") throw new TypeError("query is required");
  const contentId = positive(referenceContentId, "referenceContentId");
  const publishers = await query(
    `SELECT p.publisher_id,p.publisher_name,c.url AS source_url
       FROM content c
       LEFT JOIN content_publishers cp ON cp.content_id=c.content_id
       LEFT JOIN publishers p ON p.publisher_id=cp.publisher_id
      WHERE c.content_id=?
      ORDER BY COALESCE(cp.is_primary,0) DESC,cp.publisher_id LIMIT 1`,
    [contentId],
  );
  // The persisted primary content-publisher relationship is canonical. Inputs
  // supplied by the acquisition seam are only a race-safe fallback for a
  // just-created identity that is not yet visible to the caller's connection.
  const resolvedPublisherId = Number(publishers?.[0]?.publisher_id)
    || Number(publisherId)
    || null;
  const resolvedPublisherName = String(publishers?.[0]?.publisher_name || "").trim()
    || String(publisherName || "").trim()
    || null;
  const sourceUrl = String(publishers?.[0]?.source_url || "").trim() || null;
  if (!resolvedPublisherId || !resolvedPublisherName) {
    return {
      status: "identity_pending",
      completed: false,
      row: null,
      enrichment: null,
      updates: {},
    };
  }

  const enrichment = await enricher({
    query,
    publisherId: resolvedPublisherId,
    publisherName: resolvedPublisherName,
    sourceUrl,
    force: false,
    context: "reference_source",
  });

  // This function reloads the now-current stored profiles, ratings, and
  // provider signals before evaluating and persisting both publisher- and
  // content-level SourceCrests.
  const updates = await evaluator(
    query,
    resolvedPublisherId,
    resolvedPublisherName,
  );
  const refreshed = await query(
    `SELECT admiralty_evaluation_id,admiralty_code,evaluation_status
       FROM admiralty_evaluations
      WHERE target_type='content' AND target_id=?
      ORDER BY FIELD(evaluation_status,'human_confirmed','community_reviewed','machine_suggested'),
               updated_at DESC,created_at DESC LIMIT 1`,
    [contentId],
  );
  const row = refreshed?.[0] || null;
  const completed = legitimateSourceCrest(row?.admiralty_code);
  return {
    status: completed ? "production_enriched_and_evaluated" : "insufficient_data",
    completed,
    row,
    enrichment,
    updates,
  };
}
