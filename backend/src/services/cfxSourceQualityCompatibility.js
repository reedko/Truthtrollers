import { SourceQualityScorer } from "../core/sourceQualityScorer.js";

function positive(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return number;
}

function hostname(value) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Reuse the production source-quality scorer once per canonical document.
 * Existing rows always win so CFX cannot overwrite user, hybrid, or historical
 * assessments. The default is the scorer's deterministic fallback; callers may
 * inject the established scorer with its governed model separately.
 */
export async function ensureCfxSourceQuality({
  query,
  referenceContentId,
  contentText,
  metadata = {},
  url = "",
  scorer = null,
} = {}) {
  if (typeof query !== "function") throw new TypeError("query is required");
  const contentId = positive(referenceContentId, "referenceContentId");
  const existing = await query(
    `SELECT score_id AS source_quality_id,content_id,quality_score,risk_score,quality_tier,
            scored_by,scoring_model
       FROM source_quality_scores WHERE content_id=? LIMIT 1`,
    [contentId],
  );
  if (existing?.[0]) {
    return { status: "preserved_existing", row: existing[0], scores: null };
  }

  const qualityScorer = scorer || new SourceQualityScorer(null, query);
  const scores = await qualityScorer.scoreSource({
    content_id: contentId,
    content_text: String(contentText || ""),
    metadata,
    url,
    domain: hostname(url),
  });
  const inserted = await query(
    `INSERT IGNORE INTO source_quality_scores (
       content_id,author_transparency,publisher_transparency,evidence_density,
       claim_specificity,correction_behavior,domain_reputation,
       original_reporting,sensationalism_score,monetization_pressure,
       quality_score,risk_score,quality_tier,scored_by,scoring_model
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'auto','heuristic:cfx-compatibility-v1')`,
    [contentId, scores.author_transparency, scores.publisher_transparency,
      scores.evidence_density, scores.claim_specificity,
      scores.correction_behavior, scores.domain_reputation ?? 5,
      scores.original_reporting, scores.sensationalism_score,
      scores.monetization_pressure, scores.quality_score, scores.risk_score,
      scores.quality_tier],
  );
  if (Number(inserted?.affectedRows) === 0) {
    const raced = await query(
      `SELECT score_id AS source_quality_id,content_id,quality_score,risk_score,quality_tier,
              scored_by,scoring_model
         FROM source_quality_scores WHERE content_id=? LIMIT 1`,
      [contentId],
    );
    return { status: "preserved_existing", row: raced?.[0] || null, scores: null };
  }
  return { status: "created", row: null, scores };
}
