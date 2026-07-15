import { Cf1Error } from "../errors.js";

export async function assertVeriStrataContentAccess(query, { contentId, userId, role }) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Cf1Error("CF1_USER_ID_REQUIRED", "Authenticated user identity is required", { status: 401 });
  }
  if (role === "super_admin") return true;
  const rows = await query(`SELECT 1 AS allowed FROM content_users
    WHERE content_id = ? AND user_id = ? LIMIT 1`, [contentId, userId]);
  if (!rows[0]) throw new Cf1Error("CF1_CONTENT_ACCESS_DENIED", "Content access denied", { status: 403 });
  return true;
}
