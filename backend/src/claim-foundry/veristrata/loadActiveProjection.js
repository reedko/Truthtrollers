export async function loadActiveCf1Projection(query, contentId, consumerKey = "veristrata") {
  const rows = await query(`SELECT binding_id, package_id, content_id, consumer_key
    FROM claim_foundry_package_bindings
    WHERE consumer_key = ? AND content_id = ? AND is_active_projection = 1
    LIMIT 1`, [consumerKey, contentId]);
  return rows[0] ?? null;
}

export async function contentClaimReadScope(query, contentId, consumerKey = "veristrata") {
  const active = await loadActiveCf1Projection(query, contentId, consumerKey);
  if (!active) return { active: null, sql: "cc.claim_foundry_package_id IS NULL", params: [] };
  return { active, sql: `(cc.claim_foundry_package_id = ? OR
    (cc.claim_foundry_package_id IS NULL AND cc.user_id IS NOT NULL))`,
  params: [active.package_id] };
}
