import { selectBalancedCandidatesV1 } from "./balancedCandidateSelectorV1.js";

// Benchmark-only V2: preserve V1's generic scoring and regional/pillar ordering,
// but never fill a quota or portfolio slot with an item scoring below six.
// The threshold contains no topic or fixture vocabulary.
export const BALANCED_SELECTOR_V2_MINIMUM_SCORE = 6;

export function selectBalancedCandidatesV2(input = {}) {
  return selectBalancedCandidatesV1({ ...input,
    minimumScore: BALANCED_SELECTOR_V2_MINIMUM_SCORE,
    fillBelowMinimum: false });
}
