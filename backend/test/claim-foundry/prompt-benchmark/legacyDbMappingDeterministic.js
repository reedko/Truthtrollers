const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "among", "article", "because",
  "before", "being", "between", "could", "does", "from", "have", "into", "more",
  "most", "other", "over", "said", "says", "than", "that", "their", "there",
  "these", "they", "this", "those", "through", "under", "were", "what", "when",
  "where", "which", "while", "with", "would",
]);

function terms(value) {
  return [...new Set(String(value ?? "").toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g)
    ?.filter((term) => !STOP_WORDS.has(term)) ?? [])];
}

function paragraphScore(paragraph, signalTerms) {
  const haystack = new Set(terms(paragraph));
  return signalTerms.reduce((score, term) => score + (haystack.has(term)
    ? (/^\d/.test(term) ? 3 : 1) : 0), 0);
}

export function buildLocalClaimContext(articleText, claim, { radius = 2, maxChars = 6000 } = {}) {
  const paragraphs = String(articleText ?? "").split(/\n\s*\n/)
    .map((text) => text.trim()).filter(Boolean);
  const signals = terms([
    claim?.text,
    claim?.searchText,
    claim?.sourceCitedInArticle,
    ...(claim?.namedEntities ?? []),
    ...(claim?.studiesOrDocuments ?? []),
  ].filter(Boolean).join(" "));
  if (!paragraphs.length || !signals.length) {
    return { text: "", bestParagraphIndex: null, score: 0, paragraphRange: [] };
  }
  const ranked = paragraphs.map((text, index) => ({
    index,
    score: paragraphScore(text, signals),
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0];
  if (!best || best.score === 0) {
    return { text: "", bestParagraphIndex: null, score: 0, paragraphRange: [] };
  }
  const start = Math.max(0, best.index - radius);
  const end = Math.min(paragraphs.length - 1, best.index + radius);
  const selected = paragraphs.slice(start, end + 1);
  return {
    text: selected.join("\n\n").slice(0, maxChars),
    bestParagraphIndex: best.index,
    score: best.score,
    paragraphRange: [start, end],
  };
}

export function buildMappingClaimPacket(articleText, claim, claimId) {
  const local = buildLocalClaimContext(articleText, claim);
  return {
    claimId,
    text: claim.text,
    role: claim.role || null,
    relationshipType: claim.relationshipType || null,
    objectText: claim.objectText || null,
    searchText: claim.searchText || "",
    sourceCitedInArticle: claim.sourceCitedInArticle || "",
    namedEntities: claim.namedEntities ?? [],
    studiesOrDocuments: claim.studiesOrDocuments ?? [],
    articleStanceHint: claim.articleStance ?? null,
    localArticleContext: local.text,
    contextMatch: {
      bestParagraphIndex: local.bestParagraphIndex,
      score: local.score,
      paragraphRange: local.paragraphRange,
    },
  };
}

export function deriveHostScoreTransform(argumentFunction, stance, emitted) {
  // Semantic labels outrank the mechanically derivable model field. This makes
  // contradictions visible instead of allowing a model-emitted default to win.
  if (argumentFunction === "opposing_claim_to_refute" || stance === "rejects") return "invert";
  if (argumentFunction === "background" || argumentFunction === "reported_neutral") return "none";
  if (argumentFunction === "unclear" || stance === "unclear") return "review";
  if (["thesis", "supporting_premise", "evidence"].includes(argumentFunction)) return "normal";
  if (stance === "neutral") return "none";
  if (stance === "endorses") return "normal";
  return ["normal", "invert", "none", "review"].includes(emitted) ? emitted : "review";
}
