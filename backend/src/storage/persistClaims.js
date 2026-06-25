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
  const virtualIdToClaimId = new Map();

  for (let claimOrder = 0; claimOrder < claims.length; claimOrder++) {
    const claimEntry = claims[claimOrder];
    const claimText = typeof claimEntry === "string" ? claimEntry : claimEntry?.text;
    if (!claimText || !String(claimText).trim()) continue;

    const normalizedClaimText = String(claimText).trim();
    const claimRole = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.role || null)
      : null;
    const linkRelationshipType = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.relationshipType || claimEntry.relationship_type || relationshipType)
      : relationshipType;
    const rawParentClaimId = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.parentClaimId ?? claimEntry.parent_claim_id ?? null)
      : null;
    const virtualParentId = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.parentId ?? claimEntry.parent_id ?? null)
      : null;
    const virtualClaimId = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.id ?? claimEntry.claimId ?? claimEntry.claim_id ?? null)
      : null;
    const claimDepth = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.claimDepth ?? claimEntry.claim_depth ?? null)
      : null;
    const centralityScore = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.centrality ?? claimEntry.centralityScore ?? claimEntry.centrality_score ?? null)
      : null;
    const verifiabilityScore = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.verifiability ?? claimEntry.verifiabilityScore ?? claimEntry.verifiability_score ?? null)
      : null;
    const objectClaimText = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.objectClaim ?? claimEntry.objectText ?? claimEntry.object_claim_text ?? null)
      : null;
    const isAttribution = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.isAttribution ?? claimEntry.is_attribution ?? null)
      : null;
    const speakerEntity = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.speakerEntity ?? claimEntry.speaker_entity ?? null)
      : null;
    const accountabilityEligible = typeof claimEntry === "object" && claimEntry !== null
      ? (claimEntry.accountabilityEligible ?? claimEntry.accountability_eligible ?? null)
      : null;
    const inferredClaimDepth = claimDepth !== null && claimDepth !== undefined
      ? claimDepth
      : claimRole === 'thesis'
        ? 0
        : claimRole === 'pillar'
          ? 1
          : claimRole
            ? 2
            : null;

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
    if (virtualClaimId !== null && virtualClaimId !== undefined && String(virtualClaimId).trim()) {
      virtualIdToClaimId.set(String(virtualClaimId), claimId);
    }

    const parsedParentClaimId = Number(rawParentClaimId);
    const parentClaimId = Number.isInteger(parsedParentClaimId) && parsedParentClaimId > 0
      ? parsedParentClaimId
      : virtualParentId != null && virtualIdToClaimId.has(String(virtualParentId))
        ? virtualIdToClaimId.get(String(virtualParentId))
        : null;

    // 2) Link claim to content (check if link already exists to avoid duplicates)
    const existingLink = await query(
      `SELECT 1 AS exists_link FROM content_claims WHERE content_id = ? AND claim_id = ? AND relationship_type = ? LIMIT 1`,
      [contentId, claimId, linkRelationshipType]
    );

    if (existingLink.length === 0) {
      await query(
        `
          INSERT INTO content_claims
            (content_id, claim_id, relationship_type, claim_role, parent_claim_id, claim_depth, centrality_score, verifiability_score, claim_order,
             object_claim_text, is_attribution, speaker_entity, accountability_eligible)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          contentId,
          claimId,
          linkRelationshipType,
          claimRole,
          parentClaimId,
          inferredClaimDepth,
          centralityScore,
          verifiabilityScore,
          claimOrder,
          objectClaimText,
          isAttribution == null ? null : (isAttribution ? 1 : 0),
          speakerEntity,
          accountabilityEligible == null ? null : (accountabilityEligible ? 1 : 0),
        ]
      );
      console.log(`🔗 [persistClaims] Linked claim_id ${claimId} to content_id ${contentId} (${linkRelationshipType})`);
    } else {
      await query(
        `
          UPDATE content_claims
          SET claim_role = COALESCE(?, claim_role),
              parent_claim_id = COALESCE(?, parent_claim_id),
              claim_depth = COALESCE(?, claim_depth),
              centrality_score = COALESCE(?, centrality_score),
              verifiability_score = COALESCE(?, verifiability_score),
              claim_order = COALESCE(?, claim_order),
              object_claim_text = COALESCE(?, object_claim_text),
              is_attribution = COALESCE(?, is_attribution),
              speaker_entity = COALESCE(?, speaker_entity),
              accountability_eligible = COALESCE(?, accountability_eligible)
          WHERE content_id = ? AND claim_id = ? AND relationship_type = ?
        `,
        [
          claimRole,
          parentClaimId,
          inferredClaimDepth,
          centralityScore,
          verifiabilityScore,
          claimOrder,
          objectClaimText,
          isAttribution == null ? null : (isAttribution ? 1 : 0),
          speakerEntity,
          accountabilityEligible == null ? null : (accountabilityEligible ? 1 : 0),
          contentId,
          claimId,
          linkRelationshipType,
        ]
      );
      console.log(`⏭️  [persistClaims] Link already exists: claim_id ${claimId} → content_id ${contentId} (metadata updated if present)`);
    }
  }

  return claimIds;
}
