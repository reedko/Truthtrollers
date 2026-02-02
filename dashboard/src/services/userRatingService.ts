// src/services/userRatingService.ts
/**
 * Service for submitting user claim ratings and calculating scores
 */

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export interface UserClaimRating {
  user_claim_rating_id: number;
  reference_claim_id: number;
  user_quality_rating: number;
  ai_quality_rating: number;
  ai_stance: "support" | "refute" | "nuance" | "insufficient";
  honesty_score: number;
  created_at: string;
}

export interface PreponderanceResult {
  evidenceTruthScore: number; // 0-100
  totalWeight: number;
  supportWeight: number;
  refuteWeight: number;
  nuanceWeight: number;
  breakdown: {
    supports: number;
    refutes: number;
    nuances: number;
    insufficient: number;
  };
}

export interface SessionScore {
  totalScore: number;
  breakdown: {
    accuracyScore: number;
    honestyScore: number;
    mindChangeBonus: number;
  };
  evidenceTruthScore: number;
  gap: number;
}

/**
 * Submit user's quality rating for a reference claim
 */
export async function submitUserRating(
  userId: number,
  referenceClaimId: number,
  taskClaimId: number,
  userQualityRating: number
): Promise<{ success: boolean; honestyScore: number; aiQualityRating: number }> {
  const response = await fetch(`${API_BASE_URL}/api/user-claim-rating`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      userId,
      referenceClaimId,
      taskClaimId,
      userQualityRating,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to submit user rating");
  }

  return response.json();
}

/**
 * Get all user ratings for a task claim session
 */
export async function getUserRatings(
  userId: number,
  taskClaimId: number
): Promise<UserClaimRating[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/user-claim-ratings/${userId}/${taskClaimId}`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch user ratings");
  }

  return response.json();
}

/**
 * Get preponderance of evidence (what evidence actually says)
 */
export async function getPreponderance(
  taskClaimId: number
): Promise<PreponderanceResult> {
  const response = await fetch(
    `${API_BASE_URL}/api/preponderance/${taskClaimId}`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch preponderance");
  }

  return response.json();
}

/**
 * Calculate user's score for a task claim session
 */
export async function calculateSessionScore(
  userId: number,
  taskClaimId: number,
  userFinalRating: number,
  priorBelief: number
): Promise<SessionScore> {
  const response = await fetch(`${API_BASE_URL}/api/calculate-session-score`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      userId,
      taskClaimId,
      userFinalRating,
      priorBelief,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to calculate session score");
  }

  return response.json();
}

/**
 * Get letter grade from score
 */
export function getScoreGrade(score: number): string {
  if (score >= 250) return "A+";
  if (score >= 225) return "A";
  if (score >= 200) return "B+";
  if (score >= 175) return "B";
  if (score >= 150) return "C+";
  if (score >= 125) return "C";
  if (score >= 100) return "D";
  return "F";
}

/**
 * Get credibility stars from score
 */
export function getCredibilityStars(score: number): number {
  if (score >= 250) return 5;
  if (score >= 200) return 4;
  if (score >= 150) return 3;
  if (score >= 100) return 2;
  return 1;
}

/**
 * Get visual color for truth gap
 */
export function getGapColor(gap: number): string {
  if (gap < 10) return "#4ade80"; // Green - excellent
  if (gap < 25) return "#fbbf24"; // Yellow - good
  if (gap < 50) return "#fb923c"; // Orange - fair
  return "#f87171"; // Red - poor
}
