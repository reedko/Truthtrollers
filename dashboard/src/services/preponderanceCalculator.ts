// src/services/preponderanceCalculator.ts
/**
 * Calculate "what the evidence actually says" - preponderance of evidence
 * Used to score user accuracy: did they publish what evidence supports?
 */

import { ReferenceClaimTaskLink } from "./referenceClaimRelevance";

export interface PreponderanceResult {
  evidenceTruthScore: number; // 0-100 (what evidence says overall)
  totalWeight: number; // Sum of all quality scores
  supportWeight: number; // Quality × stance for supports
  refuteWeight: number; // Quality × stance for refutes
  nuanceWeight: number; // Quality × stance for nuances
  breakdown: {
    supports: number; // Count of support claims
    refutes: number; // Count of refute claims
    nuances: number; // Count of nuance claims
    insufficient: number; // Count of insufficient claims
  };
}

/**
 * Calculate preponderance of evidence for a task claim
 * Returns what % true the evidence suggests (0-100)
 */
export function calculatePreponderance(
  links: ReferenceClaimTaskLink[]
): PreponderanceResult {
  if (links.length === 0) {
    return {
      evidenceTruthScore: 50, // Neutral if no evidence
      totalWeight: 0,
      supportWeight: 0,
      refuteWeight: 0,
      nuanceWeight: 0,
      breakdown: {
        supports: 0,
        refutes: 0,
        nuances: 0,
        insufficient: 0,
      },
    };
  }

  let supportWeight = 0;
  let refuteWeight = 0;
  let nuanceWeight = 0;
  let insufficientWeight = 0;

  const breakdown = {
    supports: 0,
    refutes: 0,
    nuances: 0,
    insufficient: 0,
  };

  // Weight each claim by quality × confidence
  links.forEach((link) => {
    const weight = link.score * link.confidence; // score is quality × 100

    switch (link.stance) {
      case "support":
        supportWeight += weight;
        breakdown.supports++;
        break;
      case "refute":
        refuteWeight += weight;
        breakdown.refutes++;
        break;
      case "nuance":
        nuanceWeight += weight * 0.5; // Nuance counts as half
        breakdown.nuances++;
        break;
      case "insufficient":
        insufficientWeight += weight * 0; // Doesn't count
        breakdown.insufficient++;
        break;
    }
  });

  const totalWeight = supportWeight + refuteWeight + nuanceWeight;

  // Calculate truth score: support / (support + refute)
  // Nuance adds to both sides proportionally
  const adjustedSupport = supportWeight + nuanceWeight * 0.5;
  const adjustedRefute = refuteWeight + nuanceWeight * 0.5;

  let evidenceTruthScore = 50; // Default neutral

  if (totalWeight > 0) {
    evidenceTruthScore =
      (adjustedSupport / (adjustedSupport + adjustedRefute)) * 100;
  }

  return {
    evidenceTruthScore: Math.round(evidenceTruthScore),
    totalWeight,
    supportWeight,
    refuteWeight,
    nuanceWeight,
    breakdown,
  };
}

/**
 * Calculate user's accuracy score
 * How close was user's rating to evidence truth score?
 */
export function calculateAccuracyScore(
  userRating: number, // 0-100
  evidenceTruthScore: number // 0-100
): number {
  const gap = Math.abs(userRating - evidenceTruthScore);
  return Math.max(0, 100 - gap);
}

/**
 * Calculate mind change bonus
 * Reward users who updated their beliefs based on evidence
 */
export function calculateMindChangeBonus(
  priorBelief: number, // 0-100
  finalRating: number, // 0-100
  evidenceTruthScore: number // 0-100
): number {
  const beliefShift = Math.abs(finalRating - priorBelief);
  const movedTowardEvidence =
    Math.abs(finalRating - evidenceTruthScore) <
    Math.abs(priorBelief - evidenceTruthScore);

  // Award points for changing mind, more if toward evidence
  if (beliefShift > 20) {
    if (movedTowardEvidence) {
      return 75; // Big bonus for moving toward evidence
    } else {
      return 25; // Small bonus for any belief update
    }
  }

  return 0;
}

/**
 * Calculate honesty score across all card ratings
 * Did user rate card quality honestly (vs AI ratings)?
 */
export function calculateHonestyScore(userRatings: {
  userQuality: number;
  aiQuality: number;
}[]): number {
  if (userRatings.length === 0) return 0;

  let totalHonesty = 0;

  userRatings.forEach((rating) => {
    const gap = Math.abs(rating.userQuality - rating.aiQuality);
    const honestyPoints = Math.max(0, 100 - gap);
    totalHonesty += honestyPoints;
  });

  return Math.round(totalHonesty / userRatings.length);
}

/**
 * Calculate total game score
 */
export function calculateTotalScore(
  accuracyScore: number,
  honestyScore: number,
  mindChangeBonus: number
): {
  total: number;
  breakdown: {
    accuracy: number;
    honesty: number;
    mindChange: number;
  };
} {
  return {
    total: accuracyScore + honestyScore + mindChangeBonus,
    breakdown: {
      accuracy: accuracyScore,
      honesty: honestyScore,
      mindChange: mindChangeBonus,
    },
  };
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
 * Get credibility stars from average score
 */
export function getCredibilityStars(averageScore: number): number {
  if (averageScore >= 250) return 5;
  if (averageScore >= 200) return 4;
  if (averageScore >= 150) return 3;
  if (averageScore >= 100) return 2;
  return 1;
}
