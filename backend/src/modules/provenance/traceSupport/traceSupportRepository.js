function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapRow(row) {
  return {
    traceId: row.trace_id,
    traceRunId: row.trace_run_id,
    rootContentId: row.root_content_id,
    parentReferenceContentId: row.parent_reference_content_id,
    evidenceClaimId: row.evidence_claim_id,
    supportingReferenceContentId: row.supporting_reference_content_id,
    sourceOrdinal: row.source_ordinal,
    depth: row.depth,
    resolutionStatus: row.resolution_status,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    doi: row.doi,
    pmid: row.pmid,
    citationText: row.citation_text,
    locator: parseJson(row.locator_json, null),
    explanation: row.explanation,
    publicationStatus: row.publication_status,
    statusSource: row.status_source,
    child: row.supporting_reference_content_id ? {
      contentId: row.supporting_reference_content_id,
      title: row.child_title || row.source_label,
      url: row.child_url || row.source_url,
      publisher: row.child_publisher || row.child_media_source || null,
      isRetracted: Boolean(row.child_is_retracted),
    } : null,
    createdAt: row.created_at,
  };
}

export async function loadTraceSubject(query, { rootContentId, parentReferenceContentId, evidenceClaimId }) {
  const rows = await query(
    `SELECT c.content_id, c.content_name, c.url, c.details, c.content_text,
            cl.claim_id, cl.claim_text, cl.claim_type
       FROM content c
       JOIN content_claims cc ON cc.content_id = c.content_id
       JOIN claims cl ON cl.claim_id = cc.claim_id
      WHERE c.content_id = ? AND cl.claim_id = ?
        AND cc.relationship_type IN ('reference', 'snippet')
        AND EXISTS (
          SELECT 1 FROM content_relations cr
           WHERE cr.content_id = ? AND cr.reference_content_id = c.content_id
        )
        AND (
          EXISTS (
            SELECT 1
              FROM reference_claim_task_links rctl
              JOIN content_claims task_cc ON task_cc.claim_id = rctl.task_claim_id
             WHERE rctl.reference_claim_id = cl.claim_id
               AND task_cc.content_id = ?
          )
          OR EXISTS (
            SELECT 1
              FROM claim_links linked_claim
              JOIN content_claims task_cc
                ON task_cc.claim_id = CASE
                  WHEN linked_claim.source_claim_id = cl.claim_id
                    THEN linked_claim.target_claim_id
                  ELSE linked_claim.source_claim_id
                END
             WHERE linked_claim.disabled = 0
               AND (
                 linked_claim.source_claim_id = cl.claim_id
                 OR linked_claim.target_claim_id = cl.claim_id
               )
               AND task_cc.content_id = ?
          )
        )
      LIMIT 1`,
    [
      parentReferenceContentId,
      evidenceClaimId,
      rootContentId,
      rootContentId,
      rootContentId,
    ],
  );
  return rows[0] || null;
}

export async function findContentByUrl(query, url) {
  const rows = await query(
    `SELECT content_id, content_name, url, media_source, is_retracted
       FROM content WHERE url = ? OR canonical_url = ? ORDER BY content_id LIMIT 1`,
    [url, url],
  );
  return rows[0] || null;
}

export async function insertTraceRows(query, rows) {
  for (const row of rows) {
    await query(
      `INSERT INTO provenance_trace_support (
        trace_run_id, root_content_id, parent_reference_content_id,
        evidence_claim_id, supporting_reference_content_id, source_ordinal,
        depth, resolution_status, source_label, source_url, doi, pmid,
        citation_text, locator_json, explanation, publication_status,
        status_source, context_fingerprint, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.traceRunId, row.rootContentId, row.parentReferenceContentId,
        row.evidenceClaimId, row.supportingReferenceContentId || null,
        row.sourceOrdinal, row.resolutionStatus, row.sourceLabel || null,
        row.sourceUrl || null, row.doi || null, row.pmid || null,
        row.citationText || null, row.locator ? JSON.stringify(row.locator) : null,
        row.explanation || null, row.publicationStatus || "unknown",
        row.statusSource || null, row.contextFingerprint, row.createdByUserId || null,
      ],
    );
  }
}

export async function loadLatestTrace(query, { rootContentId, parentReferenceContentId, evidenceClaimId }) {
  const runs = await query(
    `SELECT trace_run_id
       FROM provenance_trace_support
      WHERE root_content_id = ? AND parent_reference_content_id = ? AND evidence_claim_id = ?
      ORDER BY created_at DESC, trace_id DESC LIMIT 1`,
    [rootContentId, parentReferenceContentId, evidenceClaimId],
  );
  if (!runs.length) return null;
  const rows = await query(
    `SELECT pts.*, child.content_name AS child_title, child.url AS child_url,
            child.media_source AS child_media_source,
            child.is_retracted AS child_is_retracted,
            (SELECT p.publisher_name
               FROM content_publishers cp JOIN publishers p ON p.publisher_id = cp.publisher_id
              WHERE cp.content_id = child.content_id ORDER BY cp.publisher_id LIMIT 1) AS child_publisher
       FROM provenance_trace_support pts
       LEFT JOIN content child ON child.content_id = pts.supporting_reference_content_id
      WHERE pts.trace_run_id = ? ORDER BY pts.source_ordinal`,
    [runs[0].trace_run_id],
  );
  return rows.map(mapRow);
}
