const ratio = (numerator, denominator) =>
  denominator === 0 ? null : numerator / denominator;

function verdictScore(value) {
  if (value === "correct" || value === "pass") return 1;
  if (value === "partially_correct" || value === "partial") return 0.5;
  if (value === "incorrect" || value === "fail") return 0;
  return null;
}

function scoreCategorical(pairs) {
  const evaluated = pairs.filter(({ gold }) =>
    gold !== null && gold !== undefined && gold !== "not_reviewed");
  const withPrediction = evaluated.filter(({ predicted }) =>
    predicted !== null && predicted !== undefined);
  const correct = withPrediction.filter(({ predicted, gold }) =>
    predicted === gold).length;
  return {
    goldCount: evaluated.length,
    predictionCount: withPrediction.length,
    predictionCoverage: ratio(withPrediction.length, evaluated.length),
    correct,
    accuracyWhenPredicted: ratio(correct, withPrediction.length),
    strictAccuracy: ratio(correct, evaluated.length),
  };
}

function scoreTupleReview(tupleReview) {
  const reviewed = tupleReview.items.filter((item) =>
    item.review.status === "reviewed"
    && item.review.tupleVerdict !== "not_reviewed");
  const values = reviewed
    .map((item) => verdictScore(item.review.tupleVerdict))
    .filter((value) => value !== null);
  const fieldNames = [
    "surface",
    "layerStructure",
    "substantiveAssertion",
    "grounding",
    "contentSupplier",
    "verificationTarget",
  ];
  const fields = Object.fromEntries(fieldNames.map((fieldName) => {
    const reviewedFields = tupleReview.items
      .map((item) => item.review.fieldVerdicts[fieldName])
      .filter((value) => value !== "not_reviewed");
    const correct = reviewedFields.filter((value) => value === "correct").length;
    return [fieldName, {
      reviewed: reviewedFields.length,
      correct,
      accuracy: ratio(correct, reviewedFields.length),
    }];
  }));
  return {
    reviewed: values.length,
    fullyCorrect: reviewed.filter((item) =>
      item.review.tupleVerdict === "correct").length,
    partiallyCorrect: reviewed.filter((item) =>
      item.review.tupleVerdict === "partially_correct").length,
    incorrect: reviewed.filter((item) =>
      item.review.tupleVerdict === "incorrect").length,
    meanCredit: ratio(
      values.reduce((sum, value) => sum + value, 0),
      values.length,
    ),
    fields,
  };
}

function scorePositionMap(positionReview) {
  const quality = positionReview.review.mapQuality;
  return Object.fromEntries(Object.entries(quality).map(([axis, verdict]) => [
    axis,
    {
      verdict,
      credit: verdictScore(verdict),
    },
  ]));
}

function scoreSelection(candidateReviews, predictionById) {
  const evaluated = candidateReviews.filter((item) =>
    typeof item.review.selectionGold === "boolean");
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  let missingPrediction = 0;
  for (const item of evaluated) {
    const prediction = predictionById.get(item.candidateId);
    if (!prediction || typeof prediction.selected !== "boolean") {
      missingPrediction += 1;
      continue;
    }
    const gold = item.review.selectionGold;
    if (prediction.selected && gold) truePositive += 1;
    else if (prediction.selected && !gold) falsePositive += 1;
    else if (!prediction.selected && gold) falseNegative += 1;
    else trueNegative += 1;
  }
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  return {
    goldCount: evaluated.length,
    predictionCount: evaluated.length - missingPrediction,
    missingPrediction,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision,
    recall,
    f1: precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall),
    accuracy: ratio(
      truePositive + trueNegative,
      evaluated.length - missingPrediction,
    ),
  };
}

export function scoreFixture({
  tupleReview,
  positionReview,
  prediction,
}) {
  const predictionById = new Map(prediction.candidateOutputs.map((item) =>
    [item.candidateId, item]));
  const candidateReviews = positionReview.candidateReviews;

  const treatment = scoreCategorical(candidateReviews.map((item) => ({
    gold: item.review.articleTreatmentGold,
    predicted: predictionById.get(item.candidateId)?.articleTreatment ?? null,
  })));

  const targetPairs = [];
  for (const item of candidateReviews) {
    const predictedRelations = new Map(
      (predictionById.get(item.candidateId)?.targetEffects ?? [])
        .map((relation) => [relation.positionId, relation.effectIfTrue]),
    );
    for (const relation of item.review.targetRelationsGold) {
      targetPairs.push({
        gold: relation.effectIfTrue,
        predicted: predictedRelations.get(relation.positionId) ?? null,
      });
    }
  }
  const targetSpecificEffect = scoreCategorical(targetPairs);

  const relevance = scoreCategorical(candidateReviews.map((item) => ({
    gold: item.review.relevanceGold,
    predicted: predictionById.get(item.candidateId)?.relevance ?? null,
  })));

  return {
    schemaVersion: "cf2.separateEvaluationScores.v1",
    fixtureId: positionReview.fixtureId,
    freezeId: positionReview.freezeId,
    dimensions: {
      tupleCorrectness: scoreTupleReview(tupleReview),
      positionMapQuality: scorePositionMap(positionReview),
      articleTreatment: treatment,
      targetSpecificEffect,
      relevance,
      selection: scoreSelection(candidateReviews, predictionById),
    },
    note: "No composite score is produced. Null metrics mean the required gold review or prediction is unavailable.",
  };
}
