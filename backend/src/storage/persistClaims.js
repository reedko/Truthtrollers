// backend/src/storage/persistClaims.js

/**
 * Clear old content_claims links before re-scraping
 * Only deletes the LINKS (content_claims), not the claims themselves
 * Claims are reusable and may be linked to other content
 */
export async function clearContentClaimLinks(query, contentId, relationshipTypes = ['reference', 'snippet']) {
  if (!contentId) return;

  // Delete content_claims junction (just the links, not the claims)
  const result = await query(
    `DELETE FROM content_claims WHERE content_id = ? AND relationship_type IN (?)`,
    [contentId, relationshipTypes]
  );

  if (result.affectedRows > 0) {
    console.log(`🗑️  [persistClaims] Cleared ${result.affectedRows} old claim links for content_id ${contentId}`);
  }
}

export async function persistClaims(
  query,
  contentId,
  claims = [],
  relationshipType = "task",
  claimType = "task",
  clearOldLinks = false  // New parameter to clear old links before persisting
) {
  if (!contentId || !Array.isArray(claims)) return [];

  // Clear old content_claims links if requested (for re-scraping)
  // This prevents duplicate links when re-processing the same content
  if (clearOldLinks) {
    const relationshipTypesToClear = relationshipType === 'reference'
      ? ['reference', 'snippet']  // Clear both reference and snippet links
      : [relationshipType];
    await clearContentClaimLinks(query, contentId, relationshipTypesToClear);
  }

  const claimIds = [];

  for (const claimText of claims) {
    if (!claimText || !claimText.trim()) continue;

    const normalizedClaimText = claimText.trim();

    // 1) Check if claim already exists (reuse existing claims)
    const existingClaim = await query(
      `SELECT claim_id FROM claims WHERE claim_text = ? LIMIT 1`,
      [normalizedClaimText]
    );

    let claimId;

    if (existingClaim.length > 0) {
      // Reuse existing claim
      claimId = existingClaim[0].claim_id;
      console.log(`♻️  [persistClaims] Reusing existing claim_id ${claimId}`);
    } else {
      // Create new claim
      const veracity_score = 0;
      const confidence_level = 0;
      const last_verified = new Date()
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

      const insertResult = await query(
        `
          INSERT INTO claims
            (claim_text, claim_type, veracity_score, confidence_level, last_verified)
          VALUES (?, ?, ?, ?, ?)
        `,
        [normalizedClaimText, claimType, veracity_score, confidence_level, last_verified]
      );

      claimId = insertResult.insertId;
      console.log(`✨ [persistClaims] Created new claim_id ${claimId}`);
    }

    claimIds.push(claimId);

    // 2) Link claim to content (check if link already exists to avoid duplicates)
    const existingLink = await query(
      `SELECT 1 FROM content_claims WHERE content_id = ? AND claim_id = ? AND relationship_type = ? LIMIT 1`,
      [contentId, claimId, relationshipType]
    );

    if (existingLink.length === 0) {
      await query(
        `
          INSERT INTO content_claims
            (content_id, claim_id, relationship_type)
          VALUES (?, ?, ?)
        `,
        [contentId, claimId, relationshipType]
      );
      console.log(`🔗 [persistClaims] Linked claim_id ${claimId} to content_id ${contentId} (${relationshipType})`);
    } else {
      console.log(`⏭️  [persistClaims] Link already exists: claim_id ${claimId} → content_id ${contentId}`);
    }
  }

  return claimIds;
}
