function words(value) {
  return new Set((String(value).toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
    .filter((word) => !["that", "this", "with", "from", "were", "their", "which"].includes(word)));
}

function similarity(left, right) {
  const a = words(left); const b = words(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((word) => b.has(word)).length / Math.min(a.size, b.size);
}

function anchors(value) {
  return new Set(String(value).toLowerCase().match(/\b\d+(?:\.\d+)?%?\b/g) ?? []);
}

export function isExplanatoryClaim(candidate) {
  return /\b(?:because|due to|reflects?|explains?|attribut(?:e|es|ed)|likely results?|artifact|requirements?)\b/i.test(candidate.claimText);
}

export function relatedResultExplanationPairs(selected) {
  const pairs = [];
  const resultExplanation = (candidate) =>
    /\b(?:likely (?:reflects?|results?|because)|reflects?|artifact|explanation for|attribut(?:e|es|ed) to)\b/i
      .test(candidate.claimText);
  for (const explanation of selected.filter(resultExplanation)) {
    const explanationAnchors = anchors(explanation.claimText);
    const result = selected.filter((candidate) => candidate !== explanation)
      .map((candidate) => ({ candidate, sharedAnchors: [...anchors(candidate.claimText)]
        .filter((anchor) => explanationAnchors.has(anchor)).length,
      sharedPillar: candidate.relatedPillarLabels.some((label) => explanation.relatedPillarLabels.includes(label)),
      similarity: similarity(candidate.claimText, explanation.claimText) }))
      .filter((item) => item.sharedAnchors > 0 || (item.sharedPillar && item.similarity >= 0.3))
      .sort((left, right) => right.sharedAnchors - left.sharedAnchors || right.similarity - left.similarity)[0]?.candidate;
    if (result) pairs.push({ resultCandidateId: result.candidateId,
      explanationCandidateId: explanation.candidateId });
  }
  return pairs;
}
