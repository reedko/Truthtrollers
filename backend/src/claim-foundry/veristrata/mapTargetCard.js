import { articleStanceForScoreTransform } from "../claimPosture.js";

const TYPES = Object.freeze({ article_endorsed_substantive: "substantive",
  opponent_substantive: "substantive", attribution_provenance: "attribution",
  source_identity: "study_identity", inference_warrant: "inference",
  context_scope: "substantive" });

export function mapCf1TargetCard(target, card, { packageId, claimId, contentId, order }) {
  const seeds = card.queryLaneSeeds ?? [];
  const hints = { queryLaneSeeds: seeds, identifierHints: card.identifierHints };
  return {
    contentId, claimId, packageId, targetId: target.targetId, cardId: card.cardId,
    targetType: TYPES[target.targetType], targetText: target.targetText,
    objectText: target.targetType.includes("substantive") ? target.targetText : null,
    sourceExcerpt: target.sourceExcerpt,
    articleStance: articleStanceForScoreTransform(target.scoreTransform),
    scoreTransform: target.scoreTransform, searchEligible: target.searchEligible ? 1 : 0,
    verdictEligible: target.targetType === "context_scope" ? 0 : (target.verdictEligible ? 1 : 0),
    resolutionStatus: target.mappingStatus,
    targetOrder: order, mappingRationale: `${target.targetType}: ${target.mappingRationale}`,
    primaryQueryText: seeds[0]?.query ?? null, queryHintsJson: JSON.stringify(hints),
    bearingCriteriaJson: JSON.stringify(card.bearingCriteria), cardJson: JSON.stringify(card),
    // Queryable hinge dimension (Step 3b). Null-by-design for baseline packages that
    // predate the fields; the projection guard enforces they are non-null when decided.
    cf1GradeTarget: target.gradeTarget ?? null,
    cf1VerificationTarget: card.disputedQuestion?.verificationTarget ?? null,
  };
}
