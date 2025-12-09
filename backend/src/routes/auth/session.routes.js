// /backend/src/routes/auth/session.routes.js
import { Router } from "express";
import jwt from "jsonwebtoken";
import { decodeJwt } from "../../utils/jwt.js";

export default function({ query, pool }) {
  const router = Router();

/**
 * POST /api/store-extension-session
 * Store extension session with device fingerprint
 */
router.post("/api/store-extension-session", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  console.log("🔑 Token received:", token);
  const user = decodeJwt(token); // your existing decode function

  const { device_fingerprint } = req.body;

  if (!device_fingerprint || !user?.user_id) {
    return res.status(400).json({ error: "Missing fingerprint or user" });
  }

  await query(
    `
    INSERT INTO user_sessions (device_fingerprint, user_id, jwt, updated_at)
    VALUES (?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), jwt = VALUES(jwt), updated_at = NOW()
  `,
    [device_fingerprint, user.user_id, token]
  );

  res.json({ message: "Session stored" });
});

/**
 * GET /api/get-session-user
 * Check for active session by device fingerprint
 */
router.get("/api/get-session-user", async (req, res) => {
  const { fingerprint } = req.query;
  if (!fingerprint) {
    return res.status(400).json({ error: "Missing fingerprint" });
  }
  const result = await query(
    `
    SELECT jwt FROM user_sessions
    WHERE device_fingerprint = ?
    AND updated_at > NOW() - INTERVAL 1 DAY
    LIMIT 1
  `,
    [fingerprint]
  );

  if (result.length === 0) {
    return res.json({ jwt: null }); // guest
  }
  const token = result[0].jwt;

  try {
    // ✅ Check if it's still valid
    jwt.verify(token, process.env.JWT_SECRET);
    return res.json({ jwt: token });
  } catch (err) {
    console.warn("⚠️ Stored session token is invalid or expired:", err.message);
    return res.json({ jwt: null }); // fallback to guest
  }
});

  return router;
}
