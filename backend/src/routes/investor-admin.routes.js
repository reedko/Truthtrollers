// /backend/src/routes/investor-admin.routes.js
// super_admin-only management of investor portal invitations. Reuses the
// existing JWT auth (same login as the rest of the app) — no new auth
// system, no hard-coded credentials.
import { Router } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { generateToken, hashToken, tokenPrefix } from "../utils/investorTokens.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_EXPIRY_DAYS = new Set([7, 14, 30, 60, 90]);
const DOCUMENT_EVENT_TYPES = ["document_opened", "document_downloaded"];

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== "super_admin") {
    return res.status(403).json({ error: "super_admin required" });
  }
  next();
}

function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

function resolveExpiresAt({ expiresInDays, expiresAt }) {
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return null;
    return d;
  }
  const days = Number(expiresInDays) || 30;
  if (!ALLOWED_EXPIRY_DAYS.has(days)) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function statusOf(inv) {
  const now = Date.now();
  if (inv.revoked_at) return "Revoked";
  if (new Date(inv.expires_at).getTime() <= now) return "Expired";
  if (Number(inv.session_count) > 0) return "Active";
  return "Unused";
}

async function logAudit(query, { invitationId, adminUserId, action, detail }) {
  await query(
    `INSERT INTO investor_admin_audit (invitation_id, admin_user_id, action, detail) VALUES (?, ?, ?, ?)`,
    [invitationId ?? null, adminUserId, action, detail ?? null],
  ).catch((e) => console.error("investor_admin_audit insert failed:", e.message));
}

const LIST_SELECT = `
  SELECT
    i.invitation_id, i.recipient_email, i.recipient_name, i.organization, i.notes,
    i.token_prefix, i.created_at, i.updated_at, i.expires_at, i.revoked_at,
    u.username AS created_by,
    (SELECT COUNT(*) FROM investor_access_sessions s WHERE s.invitation_id = i.invitation_id) AS session_count,
    (SELECT MIN(e.created_at) FROM investor_access_events e WHERE e.invitation_id = i.invitation_id AND e.event_type = 'access_granted') AS first_access,
    (SELECT MAX(e.created_at) FROM investor_access_events e WHERE e.invitation_id = i.invitation_id AND e.event_type IN ('access_granted','portal_opened','document_opened','document_downloaded')) AS last_access,
    (SELECT COUNT(*) FROM investor_access_events e WHERE e.invitation_id = i.invitation_id AND e.event_type IN ('document_opened','document_downloaded')) AS document_opens
  FROM investor_invitations i
  JOIN users u ON u.user_id = i.created_by_admin_id
`;

export default function ({ query, pool }) {
  const router = Router();
  router.use("/api/admin/investor-invitations", authenticateToken, requireSuperAdmin);

  /**
   * POST /api/admin/investor-invitations
   * Creates an invitation and returns the raw link exactly once.
   */
  router.post("/api/admin/investor-invitations", async (req, res) => {
    try {
      const { email, name, organization, notes, expiresInDays, expiresAt } = req.body || {};
      const recipientEmail = normalizeEmail(email);
      if (!EMAIL_RE.test(recipientEmail)) {
        return res.status(400).json({ error: "Enter a valid recipient email address." });
      }
      const expires = resolveExpiresAt({ expiresInDays, expiresAt });
      if (!expires) {
        return res.status(400).json({ error: "Invalid or past expiration." });
      }

      const token = generateToken();
      const result = await query(
        `INSERT INTO investor_invitations
           (recipient_email, recipient_name, organization, notes, token_hash, token_prefix, created_by_admin_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          recipientEmail,
          name || null,
          organization || null,
          notes || null,
          hashToken(token),
          tokenPrefix(token),
          req.user.user_id,
          expires,
        ],
      );

      await logAudit(query, {
        invitationId: result.insertId,
        adminUserId: req.user.user_id,
        action: "created",
        detail: `Issued for ${recipientEmail}, expires ${expires.toISOString()}`,
      });

      const origin = process.env.INVESTOR_SITE_ORIGIN || "https://investors.veristrata.ai";
      res.status(201).json({
        invitation_id: result.insertId,
        link: `${origin}/access/${token}`,
        expires_at: expires,
      });
    } catch (err) {
      console.error("❌ [Investor Admin] create error:", err);
      res.status(500).json({ error: "Failed to create invitation." });
    }
  });

  /**
   * GET /api/admin/investor-invitations
   * Query params: email, name, organization, status, from, to (created_at range)
   */
  router.get("/api/admin/investor-invitations", async (req, res) => {
    try {
      const { email, name, organization, status, from, to } = req.query;
      const clauses = [];
      const params = [];

      if (email) {
        clauses.push("i.recipient_email LIKE ?");
        params.push(`%${normalizeEmail(email)}%`);
      }
      if (name) {
        clauses.push("i.recipient_name LIKE ?");
        params.push(`%${name}%`);
      }
      if (organization) {
        clauses.push("i.organization LIKE ?");
        params.push(`%${organization}%`);
      }
      if (from) {
        clauses.push("i.created_at >= ?");
        params.push(new Date(from));
      }
      if (to) {
        clauses.push("i.created_at <= ?");
        params.push(new Date(to));
      }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await query(`${LIST_SELECT} ${where} ORDER BY i.created_at DESC`, params);

      let invitations = rows.map((r) => ({ ...r, status: statusOf(r) }));
      if (status) {
        invitations = invitations.filter((r) => r.status.toLowerCase() === String(status).toLowerCase());
      }

      res.json({ invitations });
    } catch (err) {
      console.error("❌ [Investor Admin] list error:", err);
      res.status(500).json({ error: "Failed to list invitations." });
    }
  });

  /**
   * GET /api/admin/investor-invitations/:id
   * Detail + per-document activity. Note: activity is attributed to "the
   * link issued for <email>", never claimed as proof the recipient
   * personally viewed it (possession of the link is what grants access).
   */
  router.get("/api/admin/investor-invitations/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await query(`${LIST_SELECT} WHERE i.invitation_id = ?`, [id]);
      if (rows.length === 0) return res.status(404).json({ error: "Invitation not found." });
      const invitation = { ...rows[0], status: statusOf(rows[0]) };

      const docRows = await query(
        `SELECT document_id, event_type, MIN(created_at) AS first_at, MAX(created_at) AS last_at, COUNT(*) AS opens
         FROM investor_access_events
         WHERE invitation_id = ? AND document_id IS NOT NULL AND event_type IN (${DOCUMENT_EVENT_TYPES.map(() => "?").join(",")})
         GROUP BY document_id, event_type`,
        [id, ...DOCUMENT_EVENT_TYPES],
      );

      const byDocument = {};
      for (const r of docRows) {
        const bucket = byDocument[r.document_id] || {
          document_id: r.document_id,
          first_at: r.first_at,
          last_at: r.last_at,
          opens: 0,
        };
        bucket.opens += Number(r.opens);
        if (new Date(r.first_at) < new Date(bucket.first_at)) bucket.first_at = r.first_at;
        if (new Date(r.last_at) > new Date(bucket.last_at)) bucket.last_at = r.last_at;
        byDocument[r.document_id] = bucket;
      }

      const recentEvents = await query(
        `SELECT event_type, document_id, created_at
         FROM investor_access_events
         WHERE invitation_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
        [id],
      );

      // Coarse visitor identity per session — self-reported email (if given)
      // and IP/area, so Reed can eyeball whether this plausibly looks like
      // the invited investor or like the link was forwarded to someone else.
      const sessions = await query(
        `SELECT session_id, created_at, last_seen_at, ip_address, geo_area, visitor_email
         FROM investor_access_sessions
         WHERE invitation_id = ?
         ORDER BY created_at DESC`,
        [id],
      );

      res.json({
        invitation,
        documents: Object.values(byDocument).sort((a, b) => new Date(b.last_at) - new Date(a.last_at)),
        recent_events: recentEvents,
        sessions,
      });
    } catch (err) {
      console.error("❌ [Investor Admin] detail error:", err);
      res.status(500).json({ error: "Failed to load invitation." });
    }
  });

  /**
   * PATCH /api/admin/investor-invitations/:id
   * Edits name/organization/notes only. Use /extend, /revoke, /replace for
   * anything that changes access.
   */
  router.patch("/api/admin/investor-invitations/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { name, organization, notes } = req.body || {};
      const result = await query(
        `UPDATE investor_invitations SET recipient_name = ?, organization = ?, notes = ? WHERE invitation_id = ?`,
        [name || null, organization || null, notes || null, id],
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: "Invitation not found." });

      await logAudit(query, {
        invitationId: id,
        adminUserId: req.user.user_id,
        action: "edited",
        detail: "Updated name/organization/notes",
      });
      res.json({ message: "Updated." });
    } catch (err) {
      console.error("❌ [Investor Admin] edit error:", err);
      res.status(500).json({ error: "Failed to update invitation." });
    }
  });

  /**
   * POST /api/admin/investor-invitations/:id/extend
   * Body: { expiresInDays } or { expiresAt }
   */
  router.post("/api/admin/investor-invitations/:id/extend", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { expiresInDays, expiresAt } = req.body || {};
      const expires = expiresAt
        ? new Date(expiresAt)
        : new Date(Date.now() + (Number(expiresInDays) || 30) * 24 * 60 * 60 * 1000);
      if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
        return res.status(400).json({ error: "Invalid or past expiration." });
      }

      const result = await query(`UPDATE investor_invitations SET expires_at = ? WHERE invitation_id = ?`, [
        expires,
        id,
      ]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Invitation not found." });

      await logAudit(query, {
        invitationId: id,
        adminUserId: req.user.user_id,
        action: "extended",
        detail: `New expiration ${expires.toISOString()}`,
      });
      res.json({ message: "Extended.", expires_at: expires });
    } catch (err) {
      console.error("❌ [Investor Admin] extend error:", err);
      res.status(500).json({ error: "Failed to extend invitation." });
    }
  });

  /**
   * POST /api/admin/investor-invitations/:id/revoke
   * Invalidates the invitation and, by extension, every session issued
   * through it (session validity is checked jointly with the invitation
   * on every request, so this takes effect immediately).
   */
  router.post("/api/admin/investor-invitations/:id/revoke", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const result = await query(
        `UPDATE investor_invitations SET revoked_at = NOW() WHERE invitation_id = ? AND revoked_at IS NULL`,
        [id],
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Invitation not found or already revoked." });
      }

      await logAudit(query, { invitationId: id, adminUserId: req.user.user_id, action: "revoked" });
      res.json({ message: "Revoked." });
    } catch (err) {
      console.error("❌ [Investor Admin] revoke error:", err);
      res.status(500).json({ error: "Failed to revoke invitation." });
    }
  });

  /**
   * POST /api/admin/investor-invitations/:id/replace
   * Issues a fresh token for the same invitation record and returns the new
   * link once. The old raw token is unrecoverable and no longer matches any
   * stored hash, so it stops working immediately.
   */
  router.post("/api/admin/investor-invitations/:id/replace", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const rows = await query(`SELECT invitation_id, expires_at FROM investor_invitations WHERE invitation_id = ?`, [
        id,
      ]);
      if (rows.length === 0) return res.status(404).json({ error: "Invitation not found." });

      const token = generateToken();
      await query(
        `UPDATE investor_invitations SET token_hash = ?, token_prefix = ?, revoked_at = NULL WHERE invitation_id = ?`,
        [hashToken(token), tokenPrefix(token), id],
      );

      await logAudit(query, { invitationId: id, adminUserId: req.user.user_id, action: "replaced" });

      const origin = process.env.INVESTOR_SITE_ORIGIN || "https://investors.veristrata.ai";
      res.json({ link: `${origin}/access/${token}`, expires_at: rows[0].expires_at });
    } catch (err) {
      console.error("❌ [Investor Admin] replace error:", err);
      res.status(500).json({ error: "Failed to replace invitation link." });
    }
  });

  return router;
}
