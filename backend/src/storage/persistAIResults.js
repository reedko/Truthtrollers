// backend/src/storage/persistAIResults.js
// Returns AI reference metadata WITHOUT creating content records.
// Content records will be created by /api/scrape-reference.

export async function persistAIResults(
  query,
  { contentId, evidenceRefs = [], claimIds = [] }
) {
  if (!contentId || !Array.isArray(evidenceRefs)) return [];

  const saved = [];

  for (const ref of evidenceRefs) {
    if (!ref.url) continue;

    const url = ref.url.trim();
    const name = ref.title || "AI Reference";
    const stance = ref.stance || "insufficient";
    const why = ref.summary || ref.quote || null;
    const quote = ref.quote || null;

    // Convert claim indices to actual claim IDs
    const taskClaimIds = [];
    if (Array.isArray(ref.claims)) {
      for (const idx of ref.claims) {
        const claimId = claimIds[idx];
        if (claimId) taskClaimIds.push(claimId);
      }
    }

    // Return metadata for extension to scrape
    saved.push({
      url,
      content_name: name,
      origin: "claim",
      claimIds: taskClaimIds,
      stance,
      quote,
      summary: why,
      quality: ref.quality || 0,
      location: ref.location || undefined,
      publishedAt: ref.publishedAt || null,
    });
  }

  console.log(
    `💾 [persistAIResults] Returning ${saved.length} AI reference metadata (no DB writes)`
  );

  return saved;
}
