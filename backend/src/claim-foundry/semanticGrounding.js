const STOP_WORDS = new Set(["that", "this", "with", "from", "were", "their", "which", "there",
  "have", "been", "among", "more", "most", "article", "study"]);

function stem(word) {
  if (word.endsWith("ies") && word.length > 5) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es") && word.length > 5) return word.slice(0, -1);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 4) return word.slice(0, -1);
  return word;
}

export function semanticWords(value) {
  return new Set((String(value).toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
    .map(stem).filter((word) => !STOP_WORDS.has(word)));
}

export function semanticOverlap(left, right) {
  const wanted = semanticWords(left);
  const available = semanticWords(right);
  return [...wanted].filter((word) => available.has(word)).length;
}

export function minimumGroundingOverlap(sourceUnitIds = []) {
  return sourceUnitIds.length > 1 ? 2 : 3;
}
