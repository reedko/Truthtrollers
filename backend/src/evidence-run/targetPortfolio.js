import { er1TaskId } from "./ids.js";
import { er1Fail } from "./errors.js";

const unique = (values) => [...new Set((values || []).filter(Boolean))];

export function buildTargetPortfolio(packageValue) {
  const claimMap = new Map(packageValue.selectedEvaluationClaims.map((claim) =>
    [claim.selectedClaimId, claim]));
  const targetMap = new Map();
  for (const target of packageValue.phase3Targets) {
    if (!claimMap.has(target.selectedClaimId)) {
      er1Fail("ER1_TARGET_UNKNOWN_CLAIM", "Phase 3 target cites an unknown selected claim", {
        targetId: target.targetId, selectedClaimId: target.selectedClaimId,
      });
    }
    if (targetMap.has(target.targetId)) {
      er1Fail("ER1_DUPLICATE_TARGET", "Duplicate Phase 3 target ID", { targetId: target.targetId });
    }
    targetMap.set(target.targetId, target);
  }
  const cardsByTarget = new Map();
  for (const card of packageValue.evidenceNeedCards) {
    if (!targetMap.has(card.targetId)) {
      er1Fail("ER1_CARD_UNKNOWN_TARGET", "Evidence Need Card cites an unknown target", {
        cardId: card.cardId, targetId: card.targetId,
      });
    }
    if (cardsByTarget.has(card.targetId)) {
      er1Fail("ER1_DUPLICATE_CARD", "Target has multiple Evidence Need Cards", {
        targetId: card.targetId,
      });
    }
    cardsByTarget.set(card.targetId, card);
  }

  const tasks = [];
  for (const claim of packageValue.selectedEvaluationClaims) {
    if (!claim.searchEligible) continue;
    const targets = [...targetMap.values()].filter((target) =>
      target.selectedClaimId === claim.selectedClaimId && target.searchEligible);
    if (!targets.length) continue;
    const cards = targets.map((target) => cardsByTarget.get(target.targetId)).filter(Boolean);
    if (cards.length !== targets.length) {
      const missing = targets.filter((target) => !cardsByTarget.has(target.targetId)).map((x) => x.targetId);
      er1Fail("ER1_TARGET_CARD_MISSING", "Searchable targets require Evidence Need Cards", { missing });
    }
    tasks.push({
      taskId: er1TaskId(packageValue.packageId, claim.selectedClaimId),
      selectedClaimId: claim.selectedClaimId,
      claimText: claim.claimText,
      articleRole: claim.articleRole,
      articleUse: claim.articleUse || null,
      materiality: claim.materiality,
      themeBearing: claim.themeBearing || null,
      relatedPillarIds: unique(claim.relatedPillarIds),
      targetIds: targets.map((target) => target.targetId),
      identityBundleIds: unique([...targets.flatMap((target) => target.identityBundleIds || []),
        ...cards.flatMap((card) => card.identityBundleIds || [])]),
      namedWorkIds: unique([...targets.flatMap((target) => target.namedWorkIds || []),
        ...cards.flatMap((card) => card.relevantNamedWorkIds || [])]),
      targets: targets.map((target) => ({
        targetId: target.targetId, targetText: target.targetText, targetType: target.targetType,
        scoreTransform: target.scoreTransform, verdictEligible: target.verdictEligible,
        sourceUnitIds: unique(target.sourceUnitIds),
        evidenceNeedCard: cardsByTarget.get(target.targetId),
      })),
      status: "planned",
    });
  }
  return {
    schemaVersion: "er1.targetPortfolio.v1",
    packageId: packageValue.packageId,
    theme: packageValue.articleMap?.theme || null,
    thesis: packageValue.articleMap?.thesis?.text || null,
    taskCount: tasks.length,
    targetCount: tasks.reduce((sum, task) => sum + task.targets.length, 0),
    tasks,
  };
}
