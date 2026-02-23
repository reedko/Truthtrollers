// backend/src/routes/chat.routes.js
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { isOnline } from "../realtime/socketServer.js";

export default function createChatRouter({ pool }) {
  const router = Router();

  const q = (sql, params) =>
    new Promise((resolve, reject) =>
      pool.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
    );

  // ── GET /api/chat/conversations ─────────────────────────────
  // Returns one row per conversation partner, latest message + unread count
  router.get("/api/chat/conversations", authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    try {
      const rows = await q(
        `SELECT
           partner_id,
           u.username AS partner_username,
           u.user_profile_image AS partner_avatar,
           latest_body,
           latest_at,
           unread_count
         FROM (
           SELECT
             IF(sender_id = ?, recipient_id, sender_id) AS partner_id,
             SUBSTRING_INDEX(GROUP_CONCAT(body ORDER BY created_at DESC SEPARATOR '\x01'), '\x01', 1) AS latest_body,
             MAX(created_at) AS latest_at,
             SUM(IF(recipient_id = ? AND read_at IS NULL, 1, 0)) AS unread_count
           FROM chat_messages
           WHERE sender_id = ? OR recipient_id = ?
           GROUP BY partner_id
         ) conv
         JOIN users u ON u.user_id = conv.partner_id
         ORDER BY latest_at DESC`,
        [userId, userId, userId, userId]
      );
      res.json(rows);
    } catch (err) {
      console.error("[chat] conversations error:", err);
      res.status(500).json({ error: "DB error" });
    }
  });

  // ── GET /api/chat/messages/:partnerId ───────────────────────
  // Returns paginated messages between the logged-in user and a partner
  router.get("/api/chat/messages/:partnerId", authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const partnerId = parseInt(req.params.partnerId);
    const limit = Math.min(parseInt(req.query.limit || "50"), 100);
    const before = req.query.before; // ISO timestamp for pagination
    try {
      const rows = await q(
        `SELECT m.id, m.sender_id, m.recipient_id, m.body, m.created_at, m.read_at,
                u.username AS sender_username, u.user_profile_image AS sender_avatar
         FROM chat_messages m
         JOIN users u ON u.user_id = m.sender_id
         WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
           ${before ? "AND m.created_at < ?" : ""}
         ORDER BY m.created_at DESC
         LIMIT ?`,
        before
          ? [userId, partnerId, partnerId, userId, before, limit]
          : [userId, partnerId, partnerId, userId, limit]
      );
      res.json(rows.reverse()); // Return oldest-first
    } catch (err) {
      console.error("[chat] messages error:", err);
      res.status(500).json({ error: "DB error" });
    }
  });

  // ── POST /api/chat/push-subscribe ───────────────────────────
  router.post("/api/chat/push-subscribe", authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription object" });
    }
    try {
      await q(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth)`,
        [userId, endpoint, keys.p256dh, keys.auth]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[chat] push-subscribe error:", err);
      res.status(500).json({ error: "DB error" });
    }
  });

  // ── DELETE /api/chat/push-subscribe ─────────────────────────
  router.delete("/api/chat/push-subscribe", authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    try {
      await q("DELETE FROM push_subscriptions WHERE user_id = ?", [userId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "DB error" });
    }
  });

  // ── GET /api/chat/vapid-public-key ──────────────────────────
  // Frontend needs the public VAPID key to subscribe
  router.get("/api/chat/vapid-public-key", (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
  });

  // ── GET /api/users/search ───────────────────────────────────
  // Search users by username to start a DM
  router.get("/api/users/search", authenticateToken, async (req, res) => {
    const q2 = (req.query.q || "").trim();
    const userId = req.user.user_id;
    if (!q2) return res.json([]);
    try {
      const rows = await q(
        `SELECT user_id, username, user_profile_image
         FROM users
         WHERE username LIKE ? AND user_id != ?
         LIMIT 10`,
        [`%${q2}%`, userId]
      );
      res.json(rows.map((r) => ({ ...r, is_online: isOnline(r.user_id) })));
    } catch (err) {
      res.status(500).json({ error: "DB error" });
    }
  });

  // ── GET /api/users/all ──────────────────────────────────────
  // Get all users (including current user)
  router.get("/api/users/all", authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    try {
      const rows = await q(
        `SELECT user_id, username, user_profile_image
         FROM users
         ORDER BY username ASC
         LIMIT 100`,
        []
      );
      res.json(rows.map((r) => ({ ...r, is_online: isOnline(r.user_id), is_me: r.user_id === userId })));
    } catch (err) {
      res.status(500).json({ error: "DB error" });
    }
  });

  // ── GET /api/users/online ───────────────────────────────────
  // Get all online users (including current user)
  router.get("/api/users/online", authenticateToken, async (req, res) => {
    const userId = req.user.user_id;
    console.log("[/users/online] Request from user_id:", userId);
    try {
      const rows = await q(
        `SELECT user_id, username, user_profile_image
         FROM users
         ORDER BY username ASC`,
        []
      );
      console.log("[/users/online] Total users in DB:", rows.length);
      // Filter to only online users
      const onlineUsers = rows.filter((r) => {
        const online = isOnline(r.user_id);
        if (online) console.log("[/users/online] User online:", r.username, r.user_id);
        return online;
      });
      console.log("[/users/online] Online users count:", onlineUsers.length);
      res.json(onlineUsers.map((r) => ({ ...r, is_online: true, is_me: r.user_id === userId })));
    } catch (err) {
      console.error("[/users/online] Error:", err);
      res.status(500).json({ error: "DB error" });
    }
  });

  return router;
}
