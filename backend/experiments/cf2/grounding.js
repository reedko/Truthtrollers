const normalized = (value) => String(value ?? "").toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "for", "from",
  "had", "has", "have", "in", "into", "is", "it", "its", "of", "on", "or",
  "that", "the", "their", "there", "this", "to", "was", "were", "with",
  "according", "claim", "claims", "claimed", "public", "authorities",
]);

function contentTokens(value) {
  return [...new Set(normalized(value).split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token)))];
}

export function assertionUnitOverlap(assertion, unitText) {
  const assertionTokens = contentTokens(assertion);
  if (assertionTokens.length === 0) return 0;
  const unitTokens = new Set(contentTokens(unitText));
  const shared = assertionTokens.filter((token) => unitTokens.has(token)).length;
  return shared / assertionTokens.length;
}

export function repairDiscoveryGrounding(discovery, sourceUnits, {
  mismatchThreshold = 0.2,
  replacementThreshold = 0.62,
  maximumReplacements = 6,
} = {}) {
  const byId = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  return {
    ...discovery,
    candidates: discovery.candidates.map((candidate) => {
      const originalGroundingUnitIds = [...candidate.groundingUnitIds];
      const originalScores = originalGroundingUnitIds.map((unitId) =>
        assertionUnitOverlap(candidate.rawAssertion, byId.get(unitId)?.text ?? ""));
      const originalBestOverlap = originalScores.length > 0
        ? Math.max(...originalScores) : 0;
      if (originalBestOverlap >= mismatchThreshold) {
        return {
          ...candidate,
          groundingAudit: {
            status: "original_supported",
            originalGroundingUnitIds,
            repairedGroundingUnitIds: originalGroundingUnitIds,
            originalBestOverlap,
            replacementBestOverlap: originalBestOverlap,
          },
        };
      }
      const ranked = sourceUnits.map((unit) => ({
        unitId: unit.unitId,
        score: assertionUnitOverlap(candidate.rawAssertion, unit.text),
      })).sort((left, right) => right.score - left.score);
      const replacementBestOverlap = ranked[0]?.score ?? 0;
      if (replacementBestOverlap < replacementThreshold) {
        return {
          ...candidate,
          groundingAudit: {
            status: "unresolved_low_overlap",
            originalGroundingUnitIds,
            repairedGroundingUnitIds: originalGroundingUnitIds,
            originalBestOverlap,
            replacementBestOverlap,
          },
        };
      }
      const repairedGroundingUnitIds = ranked
        .filter((item) => item.score >= replacementThreshold
          && item.score >= replacementBestOverlap - 0.05)
        .slice(0, maximumReplacements)
        .map((item) => item.unitId);
      return {
        ...candidate,
        groundingUnitIds: repairedGroundingUnitIds,
        groundingAudit: {
          status: "repaired_high_confidence_overlap",
          originalGroundingUnitIds,
          repairedGroundingUnitIds,
          originalBestOverlap,
          replacementBestOverlap,
        },
      };
    }),
  };
}
