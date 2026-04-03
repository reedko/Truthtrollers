/**
 * Centralized Verimeter Score Utilities
 *
 * This module provides a single source of truth for fetching and normalizing
 * verimeter scores across the application.
 *
 * CRITICAL SCORE FORMAT RULES:
 * - Database (claim_scores table) stores scores in range: -1.0 to +1.0
 * - API endpoints return scores in range: -1.0 to +1.0
 * - VerimeterMeter/VerimeterBar components expect: -1.0 to +1.0
 * - Display as percentage: Math.round(score * 100) to get -100% to +100%
 * - NEVER divide or multiply scores before passing to VerimeterMeter/VerimeterBar
 * - ALWAYS use fetchClaimScoresForTask() from useDashboardAPI for consistency
 *
 * Example Usage:
 * ```typescript
 * const scores = await fetchClaimScoresForTask(contentId, viewerId);
 * const score = scores[claimId];
 * <VerimeterBar score={score} />  // Pass score directly, no transformation!
 * ```
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

/**
 * Fetch verimeter score for a single claim
 * Uses the live verimeter endpoint which computes the score on-demand
 *
 * @param claimId - The ID of the claim
 * @param viewerId - Optional user ID to filter by user's links
 * @returns Score in range -1.0 to +1.0, ready for VerimeterMeter
 */
export async function fetchClaimVerimeterScore(
  claimId: number,
  viewerId: number | null = null
): Promise<number | null> {
  try {
    const qs = viewerId != null ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
    const res = await fetch(
      `${API_BASE_URL}/api/live-verimeter-score/${claimId}${qs}`
    );

    if (!res.ok) {
      console.error(`Failed to fetch verimeter score for claim ${claimId}`);
      return null;
    }

    const data = await res.json();
    const score = Array.isArray(data) && data[0]?.verimeter_score !== undefined
      ? data[0].verimeter_score
      : data.verimeter_score;

    return typeof score === "number" ? score : null;
  } catch (error) {
    console.error(`Error fetching verimeter score for claim ${claimId}:`, error);
    return null;
  }
}

/**
 * Fetch verimeter scores for all claims in a content/task
 * Returns a map of claim_id -> score
 *
 * @param contentId - The ID of the content/task
 * @param viewerId - Optional user ID to filter by user's links
 * @returns Map of {claim_id: score} where scores are in range -1.0 to +1.0
 */
export async function fetchContentClaimScores(
  contentId: number,
  viewerId: number | null = null
): Promise<Record<number, number>> {
  try {
    const qs = viewerId != null ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
    const res = await fetch(
      `${API_BASE_URL}/api/content/${contentId}/claim-scores${qs}`
    );

    if (!res.ok) {
      console.error(`Failed to fetch claim scores for content ${contentId}`);
      return {};
    }

    const scoreMap: Record<number, number> = await res.json();
    return scoreMap;
  } catch (error) {
    console.error(`Error fetching claim scores for content ${contentId}:`, error);
    return {};
  }
}

/**
 * Format a verimeter score for display as a percentage
 *
 * @param score - Score in range -1.0 to +1.0
 * @returns Formatted string like "+85%" or "-42%"
 */
export function formatVerimeterScore(score: number | null): string {
  if (score === null || score === undefined) {
    return "N/A";
  }

  const percent = Math.round(score * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

/**
 * Get the color for a verimeter score (for badges, text, etc.)
 *
 * @param score - Score in range -1.0 to +1.0
 * @returns Color name from Chakra UI color palette
 */
export function getVerimeterColor(score: number | null): string {
  if (score === null || score === undefined) {
    return "gray";
  }

  if (score > 0.1) return "green";
  if (score < -0.1) return "red";
  return "yellow";
}

/**
 * VERIMETER LABEL CONFIGURATION
 *
 * Change these values to switch between label styles:
 * - Original: { positive: "TRUE", negative: "FALSE" }
 * - Alternative: { positive: "SUPPORTED", negative: "REFUTED" }
 *
 * Simply change USE_ORIGINAL_LABELS to toggle between styles
 */
const USE_ORIGINAL_LABELS = false; // Set to true to use TRUE/FALSE, false for SUPPORTED/REFUTED

export const VERIMETER_LABELS = {
  positive: USE_ORIGINAL_LABELS ? "TRUE" : "SUPPORTED",
  negative: USE_ORIGINAL_LABELS ? "FALSE" : "REFUTED",
  neutral: "NUANCED",
  unknown: "UNKNOWN",
};
