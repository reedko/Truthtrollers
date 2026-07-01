// /backend/src/routes/whitelist.routes.js
import { Router } from "express";

export default function({ query, pool }) {
  const router = Router();

  /**
   * POST /api/whitelist-request
   * Submit a request to join the whitelist (adds to allowed_users with allowed=FALSE initially)
   */
  router.post("/api/whitelist-request", async (req, res) => {
    try {
      const { email, name, reason } = req.body;

      if (!email || !email.trim()) {
        return res.status(400).json({ error: "Email is required" });
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      const cleanEmail = email.toLowerCase().trim();

      // Check if email already exists in allowed_users
      const existing = await query(
        "SELECT email_address, allowed FROM allowed_users WHERE email_address = ?",
        [cleanEmail]
      );

      if (existing.length > 0) {
        const existingUser = existing[0];
        if (existingUser.allowed === 1) {
          return res.status(200).json({
            message: "This email is already approved! You can register now.",
            status: "approved",
          });
        } else {
          return res.status(200).json({
            message:
              "Your request is already pending. We'll notify you when approved!",
            status: "pending",
          });
        }
      }

      // Insert new request with allowed=FALSE (pending approval)
      const notes = [];
      if (name) notes.push(`Name: ${name.trim()}`);
      if (reason) notes.push(`Reason: ${reason.trim()}`);
      const notesText = notes.length > 0 ? notes.join(" | ") : null;

      await query(
        `INSERT INTO allowed_users (email_address, allowed, created_at, notes)
         VALUES (?, FALSE, NOW(), ?)`,
        [cleanEmail, notesText]
      );

      console.log(`✅ [Whitelist Request] New request from ${cleanEmail}`);

      res.status(201).json({
        message:
          "Request submitted! We'll review your request and send you an email when approved.",
        status: "pending",
      });
    } catch (err) {
      console.error("❌ [Whitelist Request] Error:", err);

      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({
          error: "This email has already requested access.",
        });
      }

      res.status(500).json({ error: "Failed to submit request" });
    }
  });

  /**
   * GET /api/whitelist-requests
   * Get all whitelist requests from allowed_users (admin only)
   */
  router.get("/api/whitelist-requests", async (req, res) => {
    try {
      // TODO: Add authentication check for admin users
      // if (!req.user || !req.user.is_admin) {
      //   return res.status(403).json({ error: "Unauthorized" });
      // }

      const status = req.query.status; // 'pending' (allowed=0), 'approved' (allowed=1)
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;

      let sql = `
        SELECT
          email_address,
          allowed,
          created_at,
          notes
        FROM allowed_users
      `;

      const params = [];

      if (status === "pending") {
        sql += " WHERE allowed = 0";
      } else if (status === "approved") {
        sql += " WHERE allowed = 1";
      }

      sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const requests = await query(sql, params);

      // Get total count
      let countSql = "SELECT COUNT(*) as total FROM allowed_users";
      const countParams = [];

      if (status === "pending") {
        countSql += " WHERE allowed = 0";
      } else if (status === "approved") {
        countSql += " WHERE allowed = 1";
      }

      const countResult = await query(countSql, countParams);
      const total = countResult[0].total;

      // Format response to match expected structure
      const formattedRequests = requests.map(r => ({
        email: r.email_address,
        status: r.allowed === 1 ? "approved" : "pending",
        created_at: r.created_at,
        notes: r.notes,
      }));

      res.json({
        requests: formattedRequests,
        total,
        limit,
        offset,
      });
    } catch (err) {
      console.error("❌ [Whitelist Requests] Error:", err);
      res.status(500).json({ error: "Failed to fetch requests" });
    }
  });

  /**
   * PATCH /api/whitelist-request/:email/approve
   * Approve a whitelist request by setting allowed=TRUE (admin only)
   */
  router.patch("/api/whitelist-request/:email/approve", async (req, res) => {
    try {
      // TODO: Add authentication check for admin users
      // const adminId = req.user.user_id;

      const email = req.params.email.toLowerCase().trim();
      const { notes } = req.body;

      // Update notes if provided, then set allowed=TRUE
      let sql = "UPDATE allowed_users SET allowed = TRUE";
      const params = [];

      if (notes) {
        sql += ", notes = ?";
        params.push(notes);
      }

      sql += " WHERE email_address = ?";
      params.push(email);

      const result = await query(sql, params);

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Email not found in whitelist requests" });
      }

      console.log(`✅ [Whitelist] Approved ${email}`);

      // TODO: Send approval email to user

      res.json({
        message: "Request approved - user can now register",
        email: email,
      });
    } catch (err) {
      console.error("❌ [Whitelist Approve] Error:", err);
      res.status(500).json({ error: "Failed to approve request" });
    }
  });

  /**
   * DELETE /api/whitelist-request/:email
   * Remove/reject a whitelist request (admin only)
   */
  router.delete("/api/whitelist-request/:email", async (req, res) => {
    try {
      const email = req.params.email.toLowerCase().trim();

      const result = await query(
        "DELETE FROM allowed_users WHERE email_address = ? AND allowed = 0",
        [email]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Pending request not found" });
      }

      console.log(`❌ [Whitelist] Removed pending request for ${email}`);

      res.json({ message: "Request removed" });
    } catch (err) {
      console.error("❌ [Whitelist Remove] Error:", err);
      res.status(500).json({ error: "Failed to remove request" });
    }
  });

  /**
   * GET /api/whitelist-check/:email
   * Check if an email is whitelisted/approved in allowed_users
   */
  router.get("/api/whitelist-check/:email", async (req, res) => {
    try {
      const email = req.params.email.toLowerCase().trim();

      const result = await query(
        "SELECT allowed FROM allowed_users WHERE email_address = ?",
        [email]
      );

      if (result.length === 0) {
        return res.json({ whitelisted: false, status: "not_requested" });
      }

      const allowed = result[0].allowed;

      res.json({
        whitelisted: allowed === 1,
        status: allowed === 1 ? "approved" : "pending",
      });
    } catch (err) {
      console.error("❌ [Whitelist Check] Error:", err);
      res.status(500).json({ error: "Failed to check whitelist status" });
    }
  });

  return router;
}
