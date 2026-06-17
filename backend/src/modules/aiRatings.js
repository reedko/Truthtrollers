// backend/src/modules/aiRatings.js
/**
 * AI Ratings Module
 *
 * This module handles all operations related to AI-generated claim ratings.
 * AI ratings are stored in claim_links with created_by_ai = 1 and include
 * support_level values that represent AI's assessment of claim veracity.
 */

import logger from "../utils/logger.js";
import {
  calculateUserClaimScore as calculateWeightedUserClaimScore,
  calculateUserContentScore as calculateWeightedUserContentScore,
} from "../services/verimeterScoringService.js";

/**
 * Calculate AI-only verimeter score for a specific claim
 * @param {Function} query - Database query function
 * @param {number} claimId - The claim ID to score
 * @returns {Promise<number>} - AI verimeter score (-1 to 1)
 */
export async function calculateAIClaimScore(query, claimId) {
  try {
    // Include AI ratings from claim_links, reference_claim_task_links, AND
    // reference_claim_links (document-level dotted-line AI evidence links)
    // Use stance-based normalized scores (+1 support, -1 refute, +0.5 nuance)
    // rather than raw support_level values which are dampened by confidence*quality
    const [result] = await query(
      `SELECT COALESCE(AVG(normalized_score), 0) as ai_score
       FROM (
         SELECT CASE
           WHEN support_level > 0.3 THEN 1.0
           WHEN support_level < -0.3 THEN -1.0
           ELSE 0.5
         END as normalized_score
         FROM claim_links
         WHERE target_claim_id = ?
           AND disabled = 0
           AND created_by_ai = 1
           AND support_level != 0
         UNION ALL
         SELECT CASE
           WHEN support_level > 0.3 THEN 1.0
           WHEN support_level < -0.3 THEN -1.0
           ELSE 0.5
         END as normalized_score
         FROM reference_claim_task_links
         WHERE task_claim_id = ?
           AND created_by_ai = 1
           AND support_level != 0
         UNION ALL
         SELECT CASE stance
           WHEN 'support' THEN 1.0
           WHEN 'refute' THEN -1.0
           WHEN 'nuance' THEN 0.5
           ELSE 0.0
         END as normalized_score
         FROM reference_claim_links
         WHERE claim_id = ?
           AND created_by_ai = 1
           AND stance IN ('support', 'refute', 'nuance')
       ) as combined_ratings`,
      [claimId, claimId, claimId]
    );

    let score = result?.ai_score || 0;

    // Clamp to valid range
    if (score > 1.0) score = 1.0;
    if (score < -1.0) score = -1.0;

    return score;
  } catch (error) {
    logger.error(`Error calculating AI score for claim ${claimId}:`, error);
    return 0;
  }
}

/**
 * Calculate user-only verimeter score for a specific claim
 * @param {Function} query - Database query function
 * @param {number} claimId - The claim ID to score
 * @param {number|null} userId - Optional user ID for personal scores
 * @returns {Promise<number>} - User verimeter score (-1 to 1)
 */
export async function calculateUserClaimScore(query, claimId, userId = null) {
  const score = await calculateWeightedUserClaimScore(query, claimId, userId);
  return score.verimeter_score || 0;
}

/**
 * Calculate combined AI+User verimeter score for a specific claim
 * @param {Function} query - Database query function
 * @param {number} claimId - The claim ID to score
 * @param {number|null} userId - Optional user ID for personal scores
 * @param {number} aiWeight - Weight for AI score (0-1), user weight is (1 - aiWeight)
 * @returns {Promise<number>} - Combined verimeter score (-1 to 1)
 */
export async function calculateCombinedClaimScore(query, claimId, userId = null, aiWeight = 0.5) {
  try {
    const aiScore = await calculateAIClaimScore(query, claimId);
    const userScore = await calculateUserClaimScore(query, claimId, userId);

    // Weighted average
    const combined = (aiScore * aiWeight) + (userScore * (1 - aiWeight));

    // Clamp to valid range
    let score = combined;
    if (score > 1.0) score = 1.0;
    if (score < -1.0) score = -1.0;

    return score;
  } catch (error) {
    logger.error(`Error calculating combined score for claim ${claimId}:`, error);
    return 0;
  }
}

/**
 * Calculate AI-only verimeter score for entire content
 * @param {Function} query - Database query function
 * @param {number} contentId - The content ID to score
 * @returns {Promise<Object>} - Scores object with verimeter_score, pro_score, con_score
 */
export async function calculateAIContentScore(query, contentId) {
  try {
    // Single batch query — globally average all document-level AI stance assessments
    // for claims belonging to this content. Each reference-claim link is weighted
    // equally regardless of how many claims a given reference appears against.
    // This prevents the two-level averaging distortion that occurs when averaging
    // per-claim scores first (a claim with 7 refute links at -1.0 would only count
    // once in the outer average, same weight as a claim with 1 nuance link at +0.5).
    const [result] = await query(
      `SELECT
         COALESCE(AVG(CASE rcl.stance
           WHEN 'support' THEN 1.0
           WHEN 'refute'  THEN -1.0
           WHEN 'nuance'  THEN 0.5
           ELSE 0.0
         END), 0) AS avg_score,
         SUM(CASE WHEN rcl.stance = 'support' THEN 1.0 ELSE 0 END) /
           NULLIF(COUNT(*), 0) AS pro_ratio,
         SUM(CASE WHEN rcl.stance = 'refute' THEN 1.0 ELSE 0 END) /
           NULLIF(COUNT(*), 0) AS con_ratio
       FROM reference_claim_links rcl
       INNER JOIN content_claims cc ON rcl.claim_id = cc.claim_id
       WHERE cc.content_id = ?
         AND rcl.created_by_ai = 1
         AND rcl.stance IN ('support', 'refute', 'nuance')`,
      [contentId]
    );

    if (!result || result.avg_score === null) {
      return { verimeter_score: 0, pro_score: 0, con_score: 0 };
    }

    return {
      verimeter_score: Math.max(-1, Math.min(1, result.avg_score)),
      pro_score: Math.max(0, Math.min(1, result.pro_ratio || 0)),
      con_score: Math.max(0, Math.min(1, result.con_ratio || 0)),
    };
  } catch (error) {
    logger.error(`Error calculating AI content score for ${contentId}:`, error);
    return { verimeter_score: 0, pro_score: 0, con_score: 0 };
  }
}

/**
 * Calculate user-only verimeter score for entire content
 * @param {Function} query - Database query function
 * @param {number} contentId - The content ID to score
 * @param {number|null} userId - Optional user ID for personal scores
 * @returns {Promise<Object>} - Scores object with verimeter_score, pro_score, con_score
 */
export async function calculateUserContentScore(query, contentId, userId = null) {
  return calculateWeightedUserContentScore(query, contentId, userId);
}

/**
 * Calculate combined AI+User verimeter score for entire content
 * @param {Function} query - Database query function
 * @param {number} contentId - The content ID to score
 * @param {number|null} userId - Optional user ID for personal scores
 * @param {number} aiWeight - Weight for AI score (0-1), user weight is (1 - aiWeight)
 * @returns {Promise<Object>} - Scores object with verimeter_score, pro_score, con_score
 */
export async function calculateCombinedContentScore(query, contentId, userId = null, aiWeight = 0.5) {
  try {
    const aiScores = await calculateAIContentScore(query, contentId);
    const userScores = await calculateUserContentScore(query, contentId, userId);

    return {
      verimeter_score: Math.max(-1, Math.min(1,
        (aiScores.verimeter_score * aiWeight) + (userScores.verimeter_score * (1 - aiWeight))
      )),
      pro_score: Math.max(0, Math.min(1,
        (aiScores.pro_score * aiWeight) + (userScores.pro_score * (1 - aiWeight))
      )),
      con_score: Math.max(0, Math.min(1,
        (aiScores.con_score * aiWeight) + (userScores.con_score * (1 - aiWeight))
      ))
    };
  } catch (error) {
    logger.error(`Error calculating combined content score for ${contentId}:`, error);
    return { verimeter_score: 0, pro_score: 0, con_score: 0 };
  }
}

/**
 * Get AI evidence links for a claim
 * @param {Function} query - Database query function
 * @param {number} claimId - The claim ID
 * @returns {Promise<Array>} - Array of AI-generated evidence links
 */
export async function getAIEvidenceForClaim(query, claimId) {
  try {
    const links = await query(
      `SELECT
        cl.claim_link_id,
        cl.claim_id,
        cl.reference_content_id,
        cl.stance,
        cl.score,
        cl.confidence,
        cl.support_level,
        cl.rationale,
        cl.evidence_text,
        cl.evidence_offsets,
        c.content_name,
        c.url
       FROM claim_links cl
       LEFT JOIN content c ON cl.reference_content_id = c.content_id
       WHERE cl.target_claim_id = ?
         AND cl.created_by_ai = 1
         AND cl.disabled = 0
       ORDER BY ABS(cl.support_level) DESC`,
      [claimId]
    );

    return links || [];
  } catch (error) {
    logger.error(`Error fetching AI evidence for claim ${claimId}:`, error);
    return [];
  }
}

/**
 * Get count of AI vs User ratings for content
 * @param {Function} query - Database query function
 * @param {number} contentId - The content ID
 * @returns {Promise<Object>} - Counts object {ai_count, user_count, total_count}
 */
export async function getAIUserRatingCounts(query, contentId) {
  try {
    // Count ratings from both claim_links AND reference_claim_task_links
    const [result] = await query(
      `SELECT
        SUM(CASE WHEN created_by_ai = 1 THEN 1 ELSE 0 END) as ai_count,
        SUM(CASE WHEN created_by_ai = 0 THEN 1 ELSE 0 END) as user_count,
        COUNT(*) as total_count
       FROM (
         SELECT cl.created_by_ai
         FROM claim_links cl
         INNER JOIN content_claims cc ON cl.target_claim_id = cc.claim_id
         WHERE cc.content_id = ?
           AND cl.disabled = 0
         UNION ALL
         SELECT rctl.created_by_ai
         FROM reference_claim_task_links rctl
         INNER JOIN content_claims cc ON rctl.task_claim_id = cc.claim_id
         WHERE cc.content_id = ?
       ) as combined_ratings`,
      [contentId, contentId]
    );

    return {
      ai_count: result?.ai_count || 0,
      user_count: result?.user_count || 0,
      total_count: result?.total_count || 0
    };
  } catch (error) {
    logger.error(`Error getting AI/user rating counts for ${contentId}:`, error);
    return { ai_count: 0, user_count: 0, total_count: 0 };
  }
}
