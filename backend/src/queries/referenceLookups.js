export async function lookupClaimIdFromText(query, text) {
  const rows = await query(
    "SELECT claim_id FROM claims WHERE claim_text = ? LIMIT 1",
    [text]
  );
  return rows?.[0]?.claim_id || null;
}

export async function lookupReferenceIdFromUrl(query, url) {
  const rows = await query(
    "SELECT content_id FROM content WHERE url = ? LIMIT 1",
    [url]
  );
  return rows?.[0]?.content_id || null;
}
