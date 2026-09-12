// backend/src/queries/referenceClaimLinks.js

export async function insertReferenceClaimLink(query, row) {
  const {
    claim_id,
    task_claim_id = null,
    content_relation_id = null,
    reference_content_id,
    stance,
    score = null,
    confidence = null,
    support_level = null,
    rationale = null,
    evidence_text = null,
    evidence_offsets = null,
    created_by_ai = 1,
    verified_by_user_id = null,
    scrape_status = "full",
  } = row;

  if (!claim_id || !reference_content_id || !stance) {
    console.warn("[insertReferenceClaimLink] Missing required:", row);
    return null;
  }

  const sql = `
  INSERT INTO reference_claim_links
  (
    claim_id,
    task_claim_id,
    content_relation_id,
    reference_content_id,
    stance,
    score,
    confidence,
    support_level,
    rationale,
    evidence_text,
    evidence_offsets,
    created_by_ai,
    verified_by_user_id,
    scrape_status
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

  const params = [
    claim_id,
    task_claim_id,
    content_relation_id,
    reference_content_id,
    stance,
    score,
    confidence,
    support_level,
    rationale,
    evidence_text,
    evidence_offsets,
    created_by_ai,
    verified_by_user_id,
    scrape_status,
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
  if (!items.length) {
    console.log("[insertReferenceClaimLinksBulk] No items to insert");
    return [];
  }

  console.log(
    `[insertReferenceClaimLinksBulk] Preparing to insert ${items.length} items`,
  );

  const sql = `INSERT INTO reference_claim_links
(
  claim_id,
  task_claim_id,
  content_relation_id,
  reference_content_id,
  stance,
  score,
  confidence,
  support_level,
  rationale,
  evidence_text,
  evidence_offsets,
  created_by_ai,
  verified_by_user_id,
  scrape_status
)
VALUES ?`;

  const values = items.map((row) => [
    row.claim_id,
    row.task_claim_id ?? null,
    row.content_relation_id ?? null,
    row.reference_content_id,
    row.stance,
    row.score ?? null,
    row.confidence ?? null,
    row.support_level ?? null,
    row.rationale ?? null,
    row.evidence_text ?? null,
    row.evidence_offsets ?? null,
    row.created_by_ai ?? 1,
    row.verified_by_user_id ?? null,
    row.scrape_status ?? "full",
  ]);

  console.log("[insertReferenceClaimLinksBulk] First row values:", values[0]);

  try {
    const result = await query(sql, [values]);
    console.log("[insertReferenceClaimLinksBulk] Query result:", result);
    const firstId = result.insertId;
    const insertedIds = Array.from(
      { length: result.affectedRows },
      (_, i) => firstId + i,
    );
    console.log(
      `[insertReferenceClaimLinksBulk] Successfully inserted ${result.affectedRows} rows`,
    );
    return insertedIds;
  } catch (err) {
    console.error("[insertReferenceClaimLinksBulk] SQL error:", err);
    console.error("[insertReferenceClaimLinksBulk] SQL:", sql);
    console.error("[insertReferenceClaimLinksBulk] Values:", values);
    throw err; // Re-throw instead of silently returning []
  }
}
