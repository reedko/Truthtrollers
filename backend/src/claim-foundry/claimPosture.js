const OPPONENT_USES = new Set(["opponent_to_rebut", "rejected"]);

export function deriveClaimPosture({ articleRole, articleUse, articleUses } = {}) {
  const uses = articleUses ?? (articleUse == null ? [] : [articleUse]);
  const opponent = articleRole === "opponent_claim"
    || uses.some((value) => OPPONENT_USES.has(value));
  return opponent
    ? { targetType: "opponent_substantive", scoreTransform: "invert", verdictEligible: true }
    : { targetType: "article_endorsed_substantive", scoreTransform: "normal", verdictEligible: true };
}

export function deriveSelectedClaimPosture(selectedClaim, rawAssertions = []) {
  const rawById = new Map(rawAssertions.map((item) => [item.rawAssertionId, item]));
  const articleUses = (selectedClaim?.sourceRawAssertionIds ?? [])
    .map((id) => rawById.get(id)?.articleUse)
    .filter(Boolean);
  return deriveClaimPosture({ articleRole: selectedClaim?.articleRole, articleUses });
}

export function articleStanceForScoreTransform(scoreTransform) {
  return { normal: "endorses", invert: "opposes", none: "reports" }[scoreTransform];
}

export function synchronizePackageClaimPostures(packageValue) {
  const selectedById = new Map((packageValue.selectedEvaluationClaims ?? [])
    .map((selected) => [selected.selectedClaimId, selected]));
  const postureBySelectedId = new Map();

  for (const selected of selectedById.values()) {
    const posture = deriveSelectedClaimPosture(selected, packageValue.rawAssertions);
    postureBySelectedId.set(selected.selectedClaimId, posture);
    selected.scoreTransform = posture.scoreTransform;
    selected.verdictEligible = posture.verdictEligible;
  }

  for (const target of packageValue.phase3Targets ?? []) {
    const posture = postureBySelectedId.get(target.selectedClaimId);
    if (!posture) continue;
    target.targetType = posture.targetType;
    target.scoreTransform = posture.scoreTransform;
    target.verdictEligible = posture.verdictEligible;
  }
  return packageValue;
}
