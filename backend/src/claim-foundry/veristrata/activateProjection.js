import { Cf1Error } from "../errors.js";
import { withTransaction } from "../../storage/dbTransaction.js";

async function lockTarget(query, bindingId) {
  const rows = await query(`SELECT * FROM claim_foundry_package_bindings
    WHERE binding_id = ? FOR UPDATE`, [bindingId]);
  return rows[0] ?? null;
}

export async function activateCf1Projection({ bindingId, consumerKey = "veristrata" }, dependencies = {}) {
  const transact = dependencies.withTransaction ?? withTransaction;
  return transact(async ({ query }) => {
    const target = await (dependencies.lockTarget ?? lockTarget)(query, bindingId);
    if (!target?.content_id || target.consumer_key !== consumerKey
      || !["projected", "superseded"].includes(target.projection_status)) {
      throw new Cf1Error("CF1_PROJECTION_NOT_ACTIVATABLE",
        "Binding must be a projected package for this consumer", { status: 409 });
    }
    const activeRows = await query(`SELECT binding_id, package_id
      FROM claim_foundry_package_bindings WHERE consumer_key = ? AND content_id = ?
      AND is_active_projection = 1 FOR UPDATE`, [consumerKey, target.content_id]);
    const previous = activeRows[0] ?? null;
    if (Number(previous?.binding_id) === Number(bindingId)) {
      return { bindingId, packageId: target.package_id, contentId: target.content_id,
        previousBindingId: null, alreadyActive: true };
    }
    await query(`UPDATE claim_foundry_package_bindings SET is_active_projection = 0
      WHERE consumer_key = ? AND content_id = ? AND is_active_projection = 1`,
    [consumerKey, target.content_id]);
    await query(`UPDATE claim_foundry_package_bindings SET is_active_projection = 1,
      projection_status = 'projected', projection_error_json = NULL WHERE binding_id = ?`, [bindingId]);
    return { bindingId, packageId: target.package_id, contentId: target.content_id,
      previousBindingId: previous?.binding_id ?? null, alreadyActive: false };
  }, { pool: dependencies.pool });
}
