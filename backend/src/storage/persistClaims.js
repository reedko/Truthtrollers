// backend/src/storage/persistClaims.js

export async function persistClaims(
  query,
  contentId,
  claims = [],
  relationshipType = "task"
) {
  if (!contentId || !Array.isArray(claims)) return [];

  const claimIds = [];

  for (const claimText of claims) {
    if (!claimText || !claimText.trim()) continue;

    const veracity_score = 0;
    const confidence_level = 0;
    const last_verified = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    // 1) Insert claim
    const insertResult = await query(
      `
        INSERT INTO claims
          (claim_text, veracity_score, confidence_level, last_verified)
        VALUES (?, ?, ?, ?)
      `,
      [claimText.trim(), veracity_score, confidence_level, last_verified]
    );

    const claimId = insertResult.insertId;
    claimIds.push(claimId);

    // 2) Link claim to content
    await query(
      `
        INSERT INTO content_claims
          (content_id, claim_id, relationship_type)
        VALUES (?, ?, ?)
      `,
      [contentId, claimId, relationshipType]
    );
  }

  return claimIds;
}
