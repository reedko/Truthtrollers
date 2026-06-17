// backend/src/routes/admin/admin.routes.js
// ──────────────────────────────────────────────────────────────────
// Admin Panel API Routes
// Handles super_admin dashboard data: online users, recent activities
// ──────────────────────────────────────────────────────────────────

import express from "express";
import logger from "../../utils/logger.js";
import { authenticateToken } from "../../middleware/auth.js";
import { isOnline } from "../../realtime/socketServer.js";
import { openAiLLM } from "../../core/openAiLLM.js";
import createMigrateCanonicalHashRouter from "./migrate-canonical-hash.routes.js";
import createXCredentialsRouter from "./x-credentials.routes.js";
import createSeedDataRoutes from "./seedData.routes.js";
import {
  calculateUserContentScore,
  getDefaultVerimeterPolicy,
  getVerimeterPolicy,
  saveVerimeterPolicy,
} from "../../services/verimeterScoringService.js";

const derivedClaimRoleSql = (alias) => `
  COALESCE(
    ${alias}.claim_role,
    CASE
      WHEN ${alias}.claim_depth = 0 THEN 'thesis'
      WHEN ${alias}.claim_depth = 1 THEN 'pillar'
      WHEN ${alias}.claim_depth >= 2 THEN 'evidence'
      WHEN ${alias}.relationship_type IN ('task', 'content') THEN 'thesis'
      WHEN ${alias}.relationship_type IN ('reference', 'snippet') THEN 'evidence'
      ELSE 'background'
    END
  )
`;

const derivedClaimDepthSql = (alias) => `
  COALESCE(
    ${alias}.claim_depth,
    CASE
      WHEN ${alias}.claim_role = 'thesis' THEN 0
      WHEN ${alias}.claim_role = 'pillar' THEN 1
      WHEN ${alias}.claim_role = 'evidence' THEN 2
      WHEN ${alias}.relationship_type IN ('task', 'content') THEN 0
      WHEN ${alias}.relationship_type IN ('reference', 'snippet') THEN 2
      ELSE 3
    END
  )
`;

const claimRolePrioritySql = (alias) => `
  CASE ${derivedClaimRoleSql(alias)}
    WHEN 'thesis' THEN 0
    WHEN 'pillar' THEN 1
    WHEN 'evidence' THEN 2
    ELSE 3
  END
`;

export default function createAdminRouter({ query, pool }) {
  const router = express.Router();

  const requireSuperAdmin = (req, res) => {
    if (req.user?.role === "super_admin") return true;
    res.status(403).json({ error: "Access denied. Super admin only." });
    return false;
  };

  // Mount migration routes
  router.use("/", createMigrateCanonicalHashRouter({ query }));

  // Mount X credentials routes
  router.use("/api/admin/x-credentials", createXCredentialsRouter({ query, pool }));

  // Mount publisher seed data CRUD routes
  router.use("/", createSeedDataRoutes());

  router.get("/api/admin/verimeter-policy", authenticateToken, async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
      const policy = await getVerimeterPolicy(query);
      res.json({
        success: true,
        policy,
        defaults: getDefaultVerimeterPolicy(),
        explanation: {
          active:
            "The user-link Verimeter averages user-created claim links. Each link starts with its support/refute strength, then its influence is adjusted by enabled credibility factors. Missing data is neutral.",
          formula:
            "sum(support_level * source_crest_factor * reviewer_reputation_factor * publisher_rating_factor * author_rating_factor) / sum(factors)",
          disabled:
            "Disabled factors and missing ratings contribute 1.0, so they do not change the score.",
        },
      });
    } catch (err) {
      logger.error("❌ Error fetching Verimeter policy:", err);
      res.status(500).json({ error: "Failed to fetch Verimeter policy" });
    }
  });

  router.put("/api/admin/verimeter-policy", authenticateToken, async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
      const policy = await saveVerimeterPolicy(query, req.body?.policy, req.user?.user_id ?? null);
      res.json({ success: true, policy });
    } catch (err) {
      logger.error("❌ Error saving Verimeter policy:", err);
      res.status(500).json({ error: "Failed to save Verimeter policy" });
    }
  });

  router.get("/api/admin/verimeter-policy/preview", authenticateToken, async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const contentId = Number(req.query.contentId);
    const userId = req.query.userId ? Number(req.query.userId) : null;
    if (!Number.isInteger(contentId) || contentId <= 0) {
      return res.status(400).json({ error: "contentId is required" });
    }
    try {
      const score = await calculateUserContentScore(query, contentId, userId, { includeExplanation: true });
      res.json({ success: true, score });
    } catch (err) {
      logger.error("❌ Error previewing Verimeter policy:", err);
      res.status(500).json({ error: "Failed to preview Verimeter calculation" });
    }
  });

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

  // ──────────────────────────────────────────────────────────────────
  // GET /api/admin/roles
  // Get all available roles (super_admin only)
  // ──────────────────────────────────────────────────────────────────
  router.get("/api/admin/roles", authenticateToken, async (req, res) => {
    const userRole = req.user?.role;

    if (userRole !== "super_admin") {
      return res.status(403).json({
        error: "Access denied. Super admin only.",
      });
    }

    try {
      const roles = await query("SELECT * FROM roles ORDER BY role_id");
      logger.log(`✅ Admin: Retrieved ${roles.length} roles`);
      res.json({ success: true, roles });
    } catch (err) {
      logger.error("❌ Error fetching roles:", err);
      res.status(500).json({ error: "Failed to fetch roles" });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // GET /api/admin/users
  // Get all users with their details for user management (super_admin only)
  // ──────────────────────────────────────────────────────────────────
  router.get("/api/admin/users", authenticateToken, async (req, res) => {
    const userRole = req.user?.role;

    if (userRole !== "super_admin") {
      return res.status(403).json({
        error: "Access denied. Super admin only.",
      });
    }

    try {
      // Get all users (same as /api/all-users)
      const users = await query("SELECT * FROM users");

      // Get roles for all users
      const usersWithRoles = await Promise.all(
        users.map(async (user) => {
          try {
            const userRoles = await query(
              `
              SELECT r.name
              FROM user_roles ur
              JOIN roles r ON ur.role_id = r.role_id
              WHERE ur.user_id = ?
            `,
              [user.user_id]
            );

            const roleNames = userRoles.map((row) => row.name);
            const role = roleNames.includes("super_admin")
              ? "super_admin"
              : roleNames.includes("admin")
                ? "admin"
                : "user";

            return {
              ...user,
              role,
              is_online: isOnline(user.user_id),
            };
          } catch (roleErr) {
            logger.error(`Error fetching role for user ${user.user_id}:`, roleErr);
            return {
              ...user,
              role: "user",
              is_online: isOnline(user.user_id),
            };
          }
        })
      );

      logger.log(`✅ Admin: Retrieved ${users.length} users`);
      res.json({
        success: true,
        users: usersWithRoles,
        count: usersWithRoles.length,
      });
    } catch (err) {
      logger.error("❌ Error fetching users:", err);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // Claim hierarchy repair / suggestion tools
  // ──────────────────────────────────────────────────────────────────
  router.get("/api/admin/content/:contentId/claims-hierarchy", authenticateToken, async (req, res) => {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({ error: "Access denied. Super admin only." });
    }

    const contentId = Number(req.params.contentId);
    if (!Number.isInteger(contentId)) {
      return res.status(400).json({ error: "Invalid contentId" });
    }

    try {
      const [contentRows] = await Promise.all([
        query("SELECT content_id, content_name, url, media_source, details FROM content WHERE content_id = ?", [contentId]),
      ]);

      const claims = await query(
        `
        SELECT
          c.claim_id,
          c.claim_text,
          c.claim_type,
          c.veracity_score,
          c.confidence_level,
          c.last_verified,
          ${derivedClaimRoleSql("cc")} AS claim_role,
          cc.parent_claim_id,
          ${derivedClaimDepthSql("cc")} AS claim_depth,
          cc.centrality_score,
          cc.verifiability_score,
          cc.claim_order,
          COALESCE(GROUP_CONCAT(DISTINCT cc.relationship_type ORDER BY cc.relationship_type SEPARATOR ', '), '') AS relationship_type
        FROM claims c
        JOIN content_claims cc ON c.claim_id = cc.claim_id
        WHERE cc.content_id = ?
        GROUP BY c.claim_id, c.claim_text, c.claim_type, c.veracity_score, c.confidence_level, c.last_verified,
                 cc.claim_role, cc.claim_depth, cc.relationship_type,
                 cc.parent_claim_id, cc.centrality_score, cc.verifiability_score, cc.claim_order
        ORDER BY
          ${claimRolePrioritySql("cc")},
          COALESCE(cc.claim_order, 999999) ASC,
          c.claim_id
        `,
        [contentId],
      );

      return res.json({
        success: true,
        content: contentRows?.[0] || null,
        claims,
      });
    } catch (err) {
      logger.error("❌ Error loading hierarchy content:", err);
      return res.status(500).json({ error: "Failed to load hierarchy data" });
    }
  });

  router.put("/api/admin/content/:contentId/claims-hierarchy/batch", authenticateToken, async (req, res) => {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({ error: "Access denied. Super admin only." });
    }

    const contentId = Number(req.params.contentId);
    if (!Number.isInteger(contentId)) {
      return res.status(400).json({ error: "Invalid contentId" });
    }

    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    if (updates.length === 0) {
      return res.status(400).json({ error: "No hierarchy updates provided" });
    }

    const validRoles = new Set(["thesis", "pillar", "evidence", "background", null]);
    const normalizedUpdates = [];
    for (const update of updates) {
      const claimId = Number(update?.claim_id);
      if (!Number.isInteger(claimId)) {
        return res.status(400).json({ error: "Invalid claim_id in hierarchy updates" });
      }

      const claimRole = update.claim_role ?? null;
      if (!validRoles.has(claimRole)) {
        return res.status(400).json({ error: `Invalid claim_role for claim ${claimId}` });
      }

      const parentClaimId =
        update.parent_claim_id == null || update.parent_claim_id === ""
          ? null
          : Number(update.parent_claim_id);
      if (parentClaimId != null && !Number.isInteger(parentClaimId)) {
        return res.status(400).json({ error: `Invalid parent_claim_id for claim ${claimId}` });
      }

      normalizedUpdates.push({
        claimId,
        claimRole,
        parentClaimId,
        claimDepth: update.claim_depth == null || update.claim_depth === "" ? null : Number(update.claim_depth),
        centralityScore: update.centrality_score == null || update.centrality_score === "" ? null : Number(update.centrality_score),
        verifiabilityScore: update.verifiability_score == null || update.verifiability_score === "" ? null : Number(update.verifiability_score),
        claimOrder: update.claim_order == null || update.claim_order === "" ? null : Number(update.claim_order),
      });
    }

    try {
      let affectedRows = 0;
      for (const update of normalizedUpdates) {
        const result = await query(
          `
          UPDATE content_claims
          SET claim_role = ?,
              parent_claim_id = ?,
              claim_depth = ?,
              centrality_score = ?,
              verifiability_score = ?,
              claim_order = ?
          WHERE content_id = ? AND claim_id = ?
          `,
          [
            update.claimRole,
            update.parentClaimId,
            update.claimDepth,
            update.centralityScore,
            update.verifiabilityScore,
            update.claimOrder,
            contentId,
            update.claimId,
          ],
        );
        affectedRows += result?.affectedRows ?? 0;
      }

      return res.json({ success: true, updated: normalizedUpdates.length, affectedRows });
    } catch (err) {
      logger.error("❌ Error batch updating claim hierarchy:", err);
      return res.status(500).json({ error: "Failed to batch update claim hierarchy" });
    }
  });

  router.put("/api/admin/content/:contentId/claims/:claimId/hierarchy", authenticateToken, async (req, res) => {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({ error: "Access denied. Super admin only." });
    }

    const contentId = Number(req.params.contentId);
    const claimId = Number(req.params.claimId);
    if (!Number.isInteger(contentId) || !Number.isInteger(claimId)) {
      return res.status(400).json({ error: "Invalid contentId or claimId" });
    }

    const {
      claim_role = null,
      parent_claim_id = null,
      claim_depth = null,
      centrality_score = null,
      verifiability_score = null,
      claim_order = null,
    } = req.body || {};

    try {
      const result = await query(
        `
        UPDATE content_claims
        SET claim_role = ?,
            parent_claim_id = ?,
            claim_depth = ?,
            centrality_score = ?,
            verifiability_score = ?,
            claim_order = ?
        WHERE content_id = ? AND claim_id = ?
        `,
        [
          claim_role,
          parent_claim_id,
          claim_depth,
          centrality_score,
          verifiability_score,
          claim_order,
          contentId,
          claimId,
        ],
      );

      return res.json({ success: true, affectedRows: result?.affectedRows ?? 0 });
    } catch (err) {
      logger.error("❌ Error updating claim hierarchy:", err);
      return res.status(500).json({ error: "Failed to update claim hierarchy" });
    }
  });

  router.post("/api/admin/content/:contentId/claims-hierarchy/suggest", authenticateToken, async (req, res) => {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({ error: "Access denied. Super admin only." });
    }

    const contentId = Number(req.params.contentId);
    if (!Number.isInteger(contentId)) {
      return res.status(400).json({ error: "Invalid contentId" });
    }

    try {
      const contentRows = await query(
        "SELECT content_id, content_name, url, media_source, details FROM content WHERE content_id = ?",
        [contentId],
      );
      const content = contentRows?.[0] || null;
      const claims = await query(
        `
        SELECT
          c.claim_id,
          c.claim_text,
          c.claim_type,
          c.veracity_score,
          c.confidence_level,
          c.last_verified
        FROM claims c
        JOIN content_claims cc ON c.claim_id = cc.claim_id
        WHERE cc.content_id = ?
        ORDER BY c.claim_id ASC
        `,
        [contentId],
      );

      if (!claims.length) {
        return res.json({ success: true, suggestions: [], content });
      }

      const system = [
        "You are helping a super-admin repair claim hierarchy for a fact-checking platform.",
        "Return strict JSON only.",
        "Classify each claim as thesis, pillar, evidence, or background.",
        "Choose a single thesis if the content has one central assertion.",
        "Pillars should directly support the thesis.",
        "Evidence should support a specific pillar.",
        "Background is for context or side details that are not central.",
        "Use claim_id integers from the provided list only.",
      ].join("\n");

      const user = JSON.stringify({
        content,
        claims,
        outputShape: {
          suggestions: [
            {
              claim_id: 123,
              claim_role: "thesis|pillar|evidence|background",
              parent_claim_id: 123,
              claim_depth: 0,
              centrality_score: 0,
              verifiability_score: 0,
              claim_order: 0,
              reason: "short explanation",
            },
          ],
        },
      }, null, 2);

      const suggestion = await openAiLLM.generate({
        system,
        user,
        schemaHint: "{" +
          "\"suggestions\":[{" +
          "\"claim_id\":number,\"claim_role\":\"thesis|pillar|evidence|background\",\"parent_claim_id\":number|null," +
          "\"claim_depth\":number,\"centrality_score\":number,\"verifiability_score\":number,\"claim_order\":number,\"reason\":string" +
          "}]}",
        temperature: 0.2,
        maxRetries: 2,
        timeout: 45000,
      });

      return res.json({ success: true, content, suggestions: suggestion?.suggestions || [] });
    } catch (err) {
      logger.error("❌ Error suggesting claim hierarchy:", err);
      return res.status(500).json({ error: "Failed to generate hierarchy suggestions" });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // PUT /api/admin/users/:userId/role
  // Update a user's role (super_admin only)
  // Body: { role: 'user' | 'admin' | 'super_admin' }
  // ──────────────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────
  // PUT /api/admin/users/:userId/role
  // Update a user's role (super_admin only)
  // Body: { role: 'user' | 'admin' | 'super_admin' }
  // ──────────────────────────────────────────────────────────────────
  router.put(
    "/api/admin/users/:userId/role",
    authenticateToken,
    async (req, res) => {
      const userRole = req.user?.role;

      if (userRole !== "super_admin") {
        return res.status(403).json({
          error: "Access denied. Super admin only.",
        });
      }

      const { userId } = req.params;
      const { role } = req.body;

      // Validate role
      const validRoles = ["user", "admin", "super_admin"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          error: `Invalid role. Must be one of: ${validRoles.join(", ")}`,
        });
      }

      try {
        // Check if user exists
        const users = await query("SELECT * FROM users WHERE user_id = ?", [
          userId,
        ]);

        if (users.length === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        const user = users[0];

        // Prevent super_admin from removing their own super_admin role
        if (req.user.user_id === parseInt(userId) && role !== "super_admin") {
          return res.status(403).json({
            error: "Cannot remove your own super_admin role",
          });
        }

        // Get role_id from roles table
        const roles = await query("SELECT role_id FROM roles WHERE name = ?", [
          role,
        ]);

        if (roles.length === 0) {
          return res.status(400).json({ error: `Role '${role}' not found in database` });
        }

        const roleId = roles[0].role_id;

        // Remove all existing roles for this user
        await query("DELETE FROM user_roles WHERE user_id = ?", [userId]);

        // Add the new role
        await query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [
          userId,
          roleId,
        ]);

        logger.log(
          `✅ Admin: User ${user.username} (ID: ${userId}) role updated to ${role} by ${req.user.username}`,
        );

        res.json({
          success: true,
          message: `User role updated to ${role}`,
          user: {
            user_id: userId,
            username: user.username,
            email: user.email,
            role,
          },
        });
      } catch (err) {
        logger.error("❌ Error updating user role:", err);
        res.status(500).json({ error: "Failed to update user role" });
      }
    },
  );

  // ──────────────────────────────────────────────────────────────────
  // PUT /api/admin/users/:userId/toggle-enabled
  // Toggle user enabled/disabled status (super_admin only)
  // Body: { enabled: true | false }
  // ──────────────────────────────────────────────────────────────────
  router.put(
    "/api/admin/users/:userId/toggle-enabled",
    authenticateToken,
    async (req, res) => {
      const userRole = req.user?.role;

      if (userRole !== "super_admin") {
        return res.status(403).json({
          error: "Access denied. Super admin only.",
        });
      }

      const { userId } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== "boolean") {
        return res.status(400).json({
          error: "Invalid enabled value. Must be true or false.",
        });
      }

      try {
        // Check if user exists
        const users = await query("SELECT * FROM users WHERE user_id = ?", [
          userId,
        ]);

        if (users.length === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        const user = users[0];

        // Update enabled status
        await query("UPDATE users SET enabled = ? WHERE user_id = ?", [
          enabled ? 1 : 0,
          userId,
        ]);

        logger.log(
          `✅ Admin: User ${user.username} ${enabled ? "enabled" : "disabled"}`,
        );

        res.json({
          success: true,
          message: `User ${enabled ? "enabled" : "disabled"} successfully`,
          user: {
            user_id: userId,
            username: user.username,
            enabled,
          },
        });
      } catch (err) {
        logger.error("❌ Error toggling user enabled status:", err);
        res.status(500).json({ error: "Failed to update user status" });
      }
    },
  );

  return router;
}
