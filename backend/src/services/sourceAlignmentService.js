const ALIGNMENTS = Object.freeze({
  industry_trade_association: { marker: "IND", label: "Industry aligned", scope: "organizational" },
  advocacy_organization: { marker: "ADV", label: "Advocacy aligned", scope: "organizational" },
  government_organization: { marker: "GOV", label: "Government source", scope: "organizational" },
  corporate_publisher: { marker: "CORP", label: "Corporate source", scope: "organizational" },
  partisan_organization: { marker: "PART", label: "Partisan aligned", scope: "organizational" },
  state_controlled_media: { marker: "STATE", label: "State controlled", scope: "organizational" },
  sponsored_content: { marker: "SPON", label: "Sponsored content", scope: "distribution" },
  educational_institution: { marker: "EDU", label: "Educational institution", scope: "organizational" },
  social_distribution: { marker: "SOC", label: "Social / community distribution", scope: "distribution" },
});

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

export function normalizeSourceAlignment(value = {}) {
  const type = String(value.type || value.alignmentType || value.alignment_type || "").trim().toLowerCase();
  const definition = ALIGNMENTS[type];
  if (!definition) return null;
  const risk = Number(value.riskScore ?? value.risk_score);
  const confidence = Number(value.confidence);
  return {
    type,
    marker: definition.marker,
    label: value.label || definition.label,
    scope: value.scope || definition.scope,
    riskScore: Number.isFinite(risk) ? Math.max(0, Math.min(100, risk)) : null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    status: value.status || "machine_suggested",
    method: value.method || value.provenance || "unknown",
    explanation: value.explanation || null,
    evidence: Array.isArray(value.evidence) ? value.evidence : value.evidence ? [value.evidence] : [],
  };
}

export async function upsertSourceAlignment(query, {
  publisherId = null,
  contentId = null,
  alignment,
  isPrimary = true,
} = {}) {
  const normalized = normalizeSourceAlignment(alignment);
  if (!normalized || (!publisherId && !contentId)) return null;
  if (publisherId && contentId) throw new Error("Source alignment must target publisher or content, not both.");
  if (isPrimary) {
    await query(
      `UPDATE source_alignments SET is_primary = 0
        WHERE target_type = ? AND target_id = ? AND alignment_scope = ?`,
      [publisherId ? "publisher" : "content", publisherId || contentId, normalized.scope],
    );
  }
  await query(
    `INSERT INTO source_alignments
      (target_type, target_id, alignment_scope, alignment_type, marker, label,
       risk_score, confidence, status, source_method, explanation, evidence_json, is_primary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE marker = VALUES(marker), label = VALUES(label),
       risk_score = VALUES(risk_score), confidence = VALUES(confidence), status = VALUES(status),
       source_method = VALUES(source_method), explanation = VALUES(explanation),
       evidence_json = VALUES(evidence_json), is_primary = VALUES(is_primary), updated_at = CURRENT_TIMESTAMP`,
    [publisherId ? "publisher" : "content", publisherId || contentId, normalized.scope,
      normalized.type, normalized.marker, normalized.label, normalized.riskScore,
      normalized.confidence, normalized.status, normalized.method, normalized.explanation,
      json(normalized.evidence), isPrimary ? 1 : 0],
  );
  return normalized;
}

export async function loadExplicitSourceAlignment(query, { publisherId = null, contentId = null } = {}) {
  const rows = await query(
    `SELECT alignment_id, target_type, target_id, alignment_scope, alignment_type,
            marker, label, risk_score, confidence, status, source_method,
            explanation, evidence_json, is_primary, updated_at
       FROM source_alignments
      WHERE (target_type = 'content' AND target_id = ?)
         OR (target_type = 'publisher' AND target_id = ?)
      ORDER BY CASE WHEN target_type = 'content' THEN 0 ELSE 1 END,
               is_primary DESC, confidence DESC, updated_at DESC
      LIMIT 1`,
    [contentId || 0, publisherId || 0],
  );
  if (!rows.length) return null;
  const row = rows[0];
  let evidence = [];
  try { evidence = typeof row.evidence_json === "string" ? JSON.parse(row.evidence_json) : row.evidence_json || []; } catch {}
  return {
    id: row.alignment_id,
    marker: row.marker,
    type: row.alignment_type,
    label: row.label,
    scope: row.alignment_scope,
    riskScore: row.risk_score == null ? null : Number(row.risk_score),
    confidence: row.confidence == null ? null : Number(row.confidence),
    status: row.status,
    provenance: row.source_method,
    explanation: row.explanation,
    evidence,
    targetType: row.target_type,
    targetId: row.target_id,
  };
}

export const SOURCE_ALIGNMENT_DEFINITIONS = ALIGNMENTS;
