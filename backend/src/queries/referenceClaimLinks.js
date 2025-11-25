// backend/src/queries/referenceClaimLinks.js

export async function insertReferenceClaimLink(query, row) {
  const {
    claim_id,
    reference_content_id,
    stance,
    score = null,
    rationale = null,
    evidence_text = null,
    evidence_offsets = null,
    created_by_ai = 1,
    verified_by_user_id = null,
  } = row;

  if (!claim_id || !reference_content_id || !stance) {
    console.warn("[insertReferenceClaimLink] Missing required:", row);
    return null;
  }

  const sql = `
    INSERT INTO reference_claim_links
      (claim_id, reference_content_id, stance, score, rationale, evidence_text, evidence_offsets, created_by_ai, verified_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    claim_id,
    reference_content_id,
    stance,
    score,
    rationale,
    evidence_text,
    evidence_offsets,
    created_by_ai,
    verified_by_user_id,
  ];

  try {
    const result = await query(sql, params);
    return result.insertId;
  } catch (err) {
    console.error("[insertReferenceClaimLink] SQL error:", err);
    return null;
  }
}

// REAL bulk insert — fast, multi-row insert
export async function insertReferenceClaimLinksBulk(query, items = []) {
  if (!items.length) return [];

  const sql = `
    INSERT INTO reference_claim_links
      (claim_id, reference_content_id, stance, score, rationale, evidence_text, evidence_offsets, created_by_ai, verified_by_user_id)
    VALUES ?
  `;

  const values = items.map((row) => [
    row.claim_id,
    row.reference_content_id,
    row.stance,
    row.score ?? null,
    row.rationale ?? null,
    row.evidence_text ?? null,
    row.evidence_offsets ?? null,
    row.created_by_ai ?? 1,
    row.verified_by_user_id ?? null,
  ]);

  try {
    const result = await query(sql, [values]);
    const firstId = result.insertId;
    return Array.from({ length: result.affectedRows }, (_, i) => firstId + i);
  } catch (err) {
    console.error("[insertReferenceClaimLinksBulk] SQL error:", err);
    return [];
  }
}
