export async function createCf1Binding(query, { packageId, consumerKey,
  consumerContentRef = null, contentId = null }) {
  const result = await query(`INSERT INTO claim_foundry_package_bindings
    (package_id, consumer_key, consumer_content_ref, content_id, projection_status)
    VALUES (?, ?, ?, ?, 'not_requested')`,
  [packageId, consumerKey, consumerContentRef, contentId]);
  return result.insertId ?? null;
}

export async function setCf1ProjectionStatus(query, { bindingId, status, error = null }) {
  const projectedAt = status === "projected" ? "CURRENT_TIMESTAMP" : "NULL";
  return query(`UPDATE claim_foundry_package_bindings SET projection_status = ?,
    projection_error_json = ?, projected_at = ${projectedAt} WHERE binding_id = ?`,
  [status, error ? JSON.stringify(error) : null, bindingId]);
}

export async function markPriorBindingsSuperseded(query, packageId) {
  return query(`UPDATE claim_foundry_package_bindings SET projection_status = 'superseded'
    WHERE package_id = ? AND projection_status IN ('not_requested','pending','projected')`, [packageId]);
}
