// Game scoring utilities for GameSpace

/**
 * Calculate points earned for linking a reference claim to a task claim
 * @param aiVeracityScore - AI's truth rating for the reference claim (-100 to +100)
 * @param userStance - User's assigned stance/support_level (-1.2 to +1.2)
 * @returns Points earned (max 10, can be negative)
 */
export function calculateLinkPoints(aiVeracityScore: number, userStance: number): number {
  // Normalize AI score from -100/+100 to -1.2/+1.2 to match stance scale
  const normalizedAIScore = (aiVeracityScore / 100) * 1.2;

  // Calculate absolute difference
  const difference = Math.abs(normalizedAIScore - userStance);

  // Max difference is 2.4 (from -1.2 to +1.2)
  // Perfect match (0 diff) = 10 points
  // Max difference = -10 points
  const maxPoints = 10;
  const maxDifference = 2.4;

  // Linear scaling: 10 points at 0 diff, -10 points at max diff
  const points = maxPoints - (difference / maxDifference) * (maxPoints * 2);

  return Math.round(points * 10) / 10; // Round to 1 decimal
}

/**
 * Get the maximum possible points for a reference claim
 * (assuming perfect stance assignment)
 */
export function getMaxPossiblePoints(): number {
  return 10;
}

/**
 * Calculate the potential points range for a reference claim
 * Shows what you could get with perfect match vs worst case
 */
export function getPotentialPointsRange(aiVeracityScore: number): {
  best: number;
  worst: number;
} {
  const normalizedAIScore = (aiVeracityScore / 100) * 1.2;

  // Best case: perfect match
  const best = getMaxPossiblePoints();

  // Worst case: opposite stance
  const worstStance = -normalizedAIScore; // Flip the sign
  const worst = calculateLinkPoints(aiVeracityScore, worstStance);

  return { best, worst };
}

/**
 * Format points for display
 */
export function formatPoints(points: number): string {
  const sign = points >= 0 ? '+' : '';
  return `${sign}${points.toFixed(1)}`;
}
