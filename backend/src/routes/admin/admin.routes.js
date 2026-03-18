// backend/src/routes/admin/admin.routes.js
// ──────────────────────────────────────────────────────────────────
// Admin Panel API Routes
// Handles super_admin dashboard data: online users, recent activities
// ──────────────────────────────────────────────────────────────────

import express from "express";
import logger from "../../utils/logger.js";
import { authenticateToken } from "../../middleware/auth.js";
import { isOnline } from "../../realtime/socketServer.js";
import createMigrateCanonicalHashRouter from "./migrate-canonical-hash.routes.js";

export default function createAdminRouter({ query }) {
  const router = express.Router();

  // Mount migration routes
  router.use("/", createMigrateCanonicalHashRouter({ query }));

  // ──────────────────────────────────────────────────────────────────
  // GET /api/admin/online-users
  // Get list of currently online users (super_admin only)
  // Uses Socket.io connection tracking (same as chat system)
  // ──────────────────────────────────────────────────────────────────
  router.get("/api/admin/online-users", authenticateToken, async (req, res) => {
    const userRole = req.user?.role;

    if (userRole !== "super_admin") {
      return res.status(403).json({
        error: "Access denied. Super admin only.",
      });
    }

    try {
      // EXACT SAME QUERY AS CHAT ENDPOINT - just get user_id, username
      const allUsers = await query(`
        SELECT user_id, username, email
        FROM users
        ORDER BY username ASC
      `);

      logger.log(
        `🔍 Admin: Checking ${allUsers.length} total users for online status...`,
      );

      // Filter to only online users using isOnline() - EXACT SAME AS CHAT
      const onlineUsers = allUsers
        .filter((user) => {
          const online = isOnline(user.user_id);
          if (online) {
            logger.log(
              `  ✓ User ${user.username} (ID: ${user.user_id}) is ONLINE`,
            );
          }
          return online;
        })
        .map((user) => ({
          ...user,
          last_active: new Date().toISOString(),
          minutes_ago: 0,
        }));

      logger.log(
        `✅ Admin: Retrieved ${onlineUsers.length} online users (out of ${allUsers.length} total)`,
      );
      logger.log(
        `📤 Admin: Returning online users:`,
        onlineUsers.map((u) => u.username),
      );
      res.json({ success: true, onlineUsers, count: onlineUsers.length });
    } catch (err) {
      logger.error("❌ Error fetching online users:", err);
      res.status(500).json({ error: "Failed to fetch online users" });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // GET /api/admin/recent-activities
  // Get recent user activities (super_admin only)
  // Optional query params: limit (default 50), userId, activityType
  // ──────────────────────────────────────────────────────────────────
  router.get(
    "/api/admin/recent-activities",
    authenticateToken,
    async (req, res) => {
      const userRole = req.user?.role;

      if (userRole !== "super_admin") {
        return res.status(403).json({
          error: "Access denied. Super admin only.",
        });
      }

      try {
        const { limit = 50, userId, activityType } = req.query;

        let sql = `
        SELECT
          ua.activity_id,
          ua.user_id,
          ua.username,
          ua.activity_type,
          ua.content_id,
          ua.claim_id,
          ua.link_id,
          ua.metadata,
          ua.created_at,
          u.username as user_username,
          c.content_name as content_title
        FROM user_activities ua
        LEFT JOIN users u ON ua.user_id = u.user_id
        LEFT JOIN content c ON ua.content_id = c.content_id
        WHERE 1=1
      `;

        const params = [];

        if (userId) {
          sql += " AND ua.user_id = ?";
          params.push(userId);
        }

        if (activityType) {
          sql += " AND ua.activity_type = ?";
          params.push(activityType);
        }

        sql += " ORDER BY ua.created_at DESC LIMIT ?";
        params.push(parseInt(limit));

        const activities = await query(sql, params);

        logger.log(
          `✅ Admin: Retrieved ${activities.length} recent activities`,
        );
        res.json({ success: true, activities, count: activities.length });
      } catch (err) {
        logger.error("❌ Error fetching recent activities:", err);
        res.status(500).json({ error: "Failed to fetch recent activities" });
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────
  // GET /api/admin/stats
  // Get overall platform statistics (super_admin only)
  // ──────────────────────────────────────────────────────────────────
  router.get("/api/admin/stats", authenticateToken, async (req, res) => {
    const userRole = req.user?.role;

    if (userRole !== "super_admin") {
      return res.status(403).json({
        error: "Access denied. Super admin only.",
      });
    }

    try {
      // Get various stats in parallel
      const [
        totalUsers,
        totalContent,
        totalClaims,
        activitiesLast24h,
        activitiesLast7d,
        topContributors,
      ] = await Promise.all([
        query("SELECT COUNT(*) as count FROM users"),
        query("SELECT COUNT(*) as count FROM content"),
        query("SELECT COUNT(*) as count FROM claims"),
        query(
          "SELECT COUNT(*) as count FROM user_activities WHERE created_at > NOW() - INTERVAL 24 HOUR",
        ),
        query(
          "SELECT COUNT(*) as count FROM user_activities WHERE created_at > NOW() - INTERVAL 7 DAY",
        ),
        query(`
          SELECT
            u.user_id,
            u.username,
            COUNT(ua.activity_id) as activity_count
          FROM user_activities ua
          INNER JOIN users u ON ua.user_id = u.user_id
          WHERE ua.created_at > NOW() - INTERVAL 7 DAY
          GROUP BY u.user_id, u.username
          ORDER BY activity_count DESC
          LIMIT 10
        `),
      ]);

      const stats = {
        totalUsers: totalUsers[0].count,
        totalContent: totalContent[0].count,
        totalClaims: totalClaims[0].count,
        activitiesLast24h: activitiesLast24h[0].count,
        activitiesLast7d: activitiesLast7d[0].count,
        topContributors: topContributors,
      };

      logger.log("✅ Admin: Retrieved platform stats");
      res.json({ success: true, stats });
    } catch (err) {
      logger.error("❌ Error fetching platform stats:", err);
      res.status(500).json({ error: "Failed to fetch platform stats" });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // GET /api/admin/login-attempts
  // Get recent login attempts (super_admin only)
  // Optional query params: limit (default 100), success (true/false/all)
  // ──────────────────────────────────────────────────────────────────
  router.get(
    "/api/admin/login-attempts",
    authenticateToken,
    async (req, res) => {
      const userRole = req.user?.role;

      if (userRole !== "super_admin") {
        return res.status(403).json({
          error: "Access denied. Super admin only.",
        });
      }

      try {
        const { limit = 50, success } = req.query;

        let sql = `
        SELECT
          la. login_attempts_id as id,
          la.username,
          la.success,
          la.ip_address,
          la.user_agent,
          la.reason,
          la.fingerprint,
          la.user_id,
          la.created_at,
          u.username as resolved_username
        FROM login_attempts la
        LEFT JOIN users u ON la.user_id = u.user_id
        WHERE 1=1
      `;

        const params = [];

        if (success === "true") {
          sql += " AND la.success = 1";
        } else if (success === "false") {
          sql += " AND la.success = 0";
        }

        sql += " ORDER BY la.created_at DESC LIMIT ?";
        params.push(parseInt(limit));

        const attempts = await query(sql, params);

        logger.log(`✅ Admin: Retrieved ${attempts.length} login attempts`);
        res.json({ success: true, attempts, count: attempts.length });
      } catch (err) {
        logger.error("❌ Error fetching login attempts:", err);
        res.status(500).json({ error: "Failed to fetch login attempts" });
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────
  // GET /api/admin/registration-attempts
  // Get recent registration attempts (super_admin only)
  // Optional query params: limit (default 100), success (true/false/all)
  // ──────────────────────────────────────────────────────────────────
  router.get(
    "/api/admin/registration-attempts",
    authenticateToken,
    async (req, res) => {
      const userRole = req.user?.role;

      if (userRole !== "super_admin") {
        return res.status(403).json({
          error: "Access denied. Super admin only.",
        });
      }

      try {
        const { limit = 50, success } = req.query;

        let sql = `
        SELECT
          ra.id,
          ra.username,
          ra.email,
          ra.success,
          ra.ip_address,
          ra.message,
          ra.user_agent,
          ra.created_at
        FROM registration_attempts ra
        WHERE 1=1
      `;

        const params = [];

        if (success === "true") {
          sql += " AND ra.success = 1";
        } else if (success === "false") {
          sql += " AND ra.success = 0";
        }

        sql += " ORDER BY ra.created_at DESC LIMIT ?";
        params.push(parseInt(limit));

        const attempts = await query(sql, params);

        logger.log(
          `✅ Admin: Retrieved ${attempts.length} registration attempts`,
        );
        res.json({ success: true, attempts, count: attempts.length });
      } catch (err) {
        logger.error("❌ Error fetching registration attempts:", err);
        res
          .status(500)
          .json({ error: "Failed to fetch registration attempts" });
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────
  // GET /api/admin/login-events
  // Get login events (successful logins, logouts, password resets)
  // Optional query params: limit (default 100), eventType
  // ──────────────────────────────────────────────────────────────────
  router.get("/api/admin/login-events", authenticateToken, async (req, res) => {
    const userRole = req.user?.role;

    if (userRole !== "super_admin") {
      return res.status(403).json({
        error: "Access denied. Super admin only.",
      });
    }

    try {
      const { limit = 50, eventType } = req.query;

      let sql = `
        SELECT
          le.id,
          le.user_id,
          le.fingerprint,
          le.event_type,
          le.ip_address,
          le.details,
          le.event_time as created_at,
          u.username
        FROM login_events le
        LEFT JOIN users u ON le.user_id = u.user_id
        WHERE 1=1
      `;

      const params = [];

      if (eventType) {
        sql += " AND le.event_type = ?";
        params.push(eventType);
      }

      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(parseInt(limit));

      const events = await query(sql, params);

      logger.log(`✅ Admin: Retrieved ${events.length} login events`);
      res.json({ success: true, events, count: events.length });
    } catch (err) {
      logger.error("❌ Error fetching login events:", err);
      res.status(500).json({ error: "Failed to fetch login events" });
    }
  });

  return router;
}
