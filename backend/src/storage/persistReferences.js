// backend/src/storage/persistReferences.js
// Returns DOM reference metadata WITHOUT creating content records.
// Content records will be created by /api/scrape-reference.

export async function persistReferences(query, parentContentId, refs = []) {
  if (!parentContentId || !Array.isArray(refs)) return [];

  const saved = [];

  for (const ref of refs) {
    if (!ref || !ref.url) continue;

    // Return metadata for extension to scrape
    saved.push({
      url: ref.url,
      content_name: ref.content_name || "Untitled Reference",
      origin: "dom",
      // DOM refs don't have claim links (those come from AI evidence)
    });
  }

  console.log(
    `💾 [persistReferences] Returning ${saved.length} DOM reference metadata (no DB writes)`
  );

  return saved;
}
