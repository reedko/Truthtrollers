import { Router } from "express";
import { userHasPermission, userHasRole } from "../../middleware/permissions.js";

export default function createReferencesRoutes({ query, pool }) {
  const router = Router();

  //Get auth_references
  router.get("/api/content/:taskId/auth_references", async (req, res) => {
    const { taskId } = req.params;
    const sql = `
    select * from auth_references where
    (author_id in (select author_id from content_authors where content_id=?))
    or
    (reference_content_id in
    (select reference_content_id from content_relations where content_id=?))
  `;
    pool.query(sql, taskId, (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error auth_references");
      }

      return res.json(rows);
    });
  });

  //get references with claims for a content_id (VIEWER-FILTERED)
  router.get(
    "/api/content/:task_content_id/references-with-claims",
    async (req, res) => {
      const { task_content_id } = req.params;
      const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;
      const currentUserId = req.user?.user_id || viewerId; // Use JWT user if available

      try {
        const SQL = `
        SELECT  c.content_id AS reference_content_id,
          c.content_name,
          c.url,
          c.thumbnail,
          c.progress,
          c.details,
          c.media_source,
          c.topic,
          c.subtopic,
          cr.added_by_user_id,
          cr.is_system,
               COALESCE(JSON_ARRAYAGG(
                 JSON_OBJECT('claim_id', cl.claim_id, 'claim_text', cl.claim_text, 'claim_type', cl.claim_type)
               ), '[]') AS claims
         FROM content c
        INNER JOIN content_relations cr ON c.content_id = cr.reference_content_id
        LEFT JOIN content_claims cc ON c.content_id = cc.content_id
        LEFT JOIN claims cl ON cc.claim_id = cl.claim_id
        LEFT JOIN user_reference_visibility urv
          ON urv.task_content_id = cr.content_id
          AND urv.reference_content_id = cr.reference_content_id
          AND urv.user_id = ?
        WHERE cr.content_id = ?
          AND (
            -- Always show system refs
            cr.is_system = TRUE
            OR
            -- Show user-added refs based on viewer context
            ${viewerId === null
              ? '1=1' // View All: show all user refs
              : 'cr.added_by_user_id = ?'} -- Specific viewer: only their refs
          )
          AND (urv.is_hidden IS NULL OR urv.is_hidden = FALSE) -- Not hidden by this user
        GROUP BY c.content_id
        `;

        const params = viewerId === null
          ? [currentUserId, task_content_id]
          : [currentUserId, task_content_id, viewerId];
        const referencesWithClaims = await query(SQL, params);

        res.json(referencesWithClaims);
      } catch (err) {
        console.error("Error fetching references with claims:", err);
        res.status(500).json({ error: "Database error" });
      }
    }
  );

  //Get References, aka source because reference is a reserved word
  router.get("/api/content/:taskId/source-references", async (req, res) => {
    const { taskId } = req.params;
    const sql = `SELECT * FROM content c join content_relations cr
    on c.content_id = cr.reference_content_id WHERE cr.content_id =?`;
    pool.query(sql, taskId, (err, rows) => {
      if (err) {
        //(rows, taskId);
        console.error(err);
        return res.status(500).send("Error fetching references");
      }

      return res.json(rows);
    });
  });

  // Get References with Optional Search Term
  router.get("/api/references/:searchTerm?", async (req, res) => {
    let { searchTerm } = req.params;
    let { page = 1 } = req.query; // 🔥 Extract page number (default = 1)
    const limit = 50;
    const offset = (page - 1) * limit; // 🔥 Calculate offset

    let sql = `SELECT content_id, content_name, url FROM content`;

    if (searchTerm && searchTerm !== "all") {
      sql += ` WHERE content_name LIKE ?`;
      searchTerm = `%${searchTerm}%`;
    }

    sql += ` LIMIT ? OFFSET ?`; // ✅ Now supports pagination

    pool.query(
      sql,
      searchTerm && searchTerm !== "all"
        ? [searchTerm, limit, offset]
        : [limit, offset],
      (err, rows) => {
        if (err) {
          console.error("❌ Error fetching references:", err);
          return res.status(500).send("Error fetching references");
        }

        return res.json(rows);
      }
    );
  });

  // Update reference title
  router.put("/api/updateReference", async (req, res) => {
    const { content_id, title } = req.body; // Extract from request body

    if (!title || !content_id) {
      return res.status(400).json({ error: "Missing required parameters." });
    }

    const sql = "UPDATE content SET content_name = ? WHERE content_id = ?";
    const params = [title, content_id];

    console.log("Updating content_name for content_id:", content_id);

    pool.query(sql, params, (err, results) => {
      if (err) {
        console.error("❌ Error updating references:", err);
        return res.status(500).json({ error: "Database query failed" });
      }
      res.json({ message: "Reference updated successfully", results });
    });
  });

  // Get content_relations for a task
  router.get("/api/content/:taskId/content_relations", async (req, res) => {
    const { taskId } = req.params;
    const sql = `SELECT * FROM  content_relations ta
    WHERE content_id = ?`;
    pool.query(sql, taskId, (err, rows) => {
      if (err) {
        console.log(rows, taskId);
        console.error(err);
        return res.status(500).send("Error fetching references");
      }

      return res.json(rows);
    });
  });

  // Add content relation (tracks who added it)
  router.post("/api/add-content-relation", async (req, res) => {
    const taskContentId = req.body.taskContentId;
    const referenceContentId = req.body.referenceContentId;
    const userId = req.user?.user_id; // From JWT
    const isSystemRef = req.body.isSystemRef || false; // Evidence engine sets this

    try {
      // Check if this task-reference pair already exists
      const checkExistingTaskRef = `SELECT 1 FROM content_relations WHERE content_id = ? AND reference_content_id = ?`;
      const existingTaskRefs = await query(checkExistingTaskRef, [
        taskContentId,
        referenceContentId,
      ]);

      if (existingTaskRefs.length === 0) {
        // Insert task-reference with user tracking
        await query(
          `INSERT INTO content_relations (content_id, reference_content_id, added_by_user_id, is_system) VALUES (?, ?, ?, ?)`,
          [taskContentId, referenceContentId, isSystemRef ? null : userId, isSystemRef]
        );
        console.log(
          `Reference ${referenceContentId} linked to task ${taskContentId} by ${isSystemRef ? 'system' : `user ${userId}`}`
        );
      } else {
        console.log(
          `Reference ${referenceContentId} already linked to task ${taskContentId}, skipping insert.`
        );
      }

      res.status(200).json({
        message: "Reference relation added successfully",
        referenceContentId,
      });
    } catch (error) {
      console.error("Error inserting references:", error);
      res.status(500).json({ error: "Error adding references" });
    }
  });

  // Delete content relation (WITH PERMISSION CHECK)
  router.delete("/api/remove-content-relation", async (req, res) => {
    const taskContentId = req.body.taskContentId;
    const referenceContentId = req.body.referenceContentId;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      // Check what kind of reference this is
      const checkSql = `SELECT added_by_user_id, is_system FROM content_relations WHERE content_id = ? AND reference_content_id = ?`;
      const [refData] = await query(checkSql, [taskContentId, referenceContentId]);

      if (!refData) {
        return res.status(404).json({ error: "Reference relation not found" });
      }

      // Permission check
      const canDeleteSystemRefs = await userHasPermission(query, userId, 'delete_system_references');
      const canDeleteAnyUserRef = await userHasPermission(query, userId, 'delete_any_user_reference');
      const isOwnRef = refData.added_by_user_id === userId;

      if (refData.is_system && !canDeleteSystemRefs) {
        return res.status(403).json({
          error: "Cannot delete system references. You can hide them instead.",
          canHide: true
        });
      }

      if (!refData.is_system && !isOwnRef && !canDeleteAnyUserRef) {
        return res.status(403).json({
          error: "Cannot delete references added by other users",
        });
      }

      // Permission granted - delete
      const sql = `DELETE FROM content_relations WHERE content_id = ? AND reference_content_id = ?`;
      await query(sql, [taskContentId, referenceContentId]);

      res.json({ message: "Reference removed successfully" });
    } catch (err) {
      console.error("Error removing reference:", err);
      return res.status(500).json({ error: "Error removing reference" });
    }
  });

  router.get("/api/check-reference", async (req, res) => {
    const { url } = req.body;

    if (!url) return res.status(400).json({ error: "Missing URL" });

    try {
      const sql = "SELECT content_id FROM content WHERE url = ?";
      const [result] = await query(sql, [url]);

      if (!result || result.length === 0) {
        return res.status(200).json({ id: null }); // Reference not found
      }

      return res.status(200).json({ content_id: result.content_id });
    } catch (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Database lookup failed" });
    }
  });

  // Hide reference for current user (soft-delete per user)
  router.post("/api/references/hide", async (req, res) => {
    const { taskContentId, referenceContentId } = req.body;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!taskContentId || !referenceContentId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const sql = `
        INSERT INTO user_reference_visibility
          (user_id, task_content_id, reference_content_id, is_hidden, hidden_at)
        VALUES (?, ?, ?, TRUE, NOW())
        ON DUPLICATE KEY UPDATE
          is_hidden = TRUE,
          hidden_at = NOW()
      `;
      await query(sql, [userId, taskContentId, referenceContentId]);

      res.json({ message: "Reference hidden successfully" });
    } catch (err) {
      console.error("Error hiding reference:", err);
      res.status(500).json({ error: "Error hiding reference" });
    }
  });

  // Unhide reference for current user
  router.post("/api/references/unhide", async (req, res) => {
    const { taskContentId, referenceContentId } = req.body;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!taskContentId || !referenceContentId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const sql = `
        INSERT INTO user_reference_visibility
          (user_id, task_content_id, reference_content_id, is_hidden)
        VALUES (?, ?, ?, FALSE)
        ON DUPLICATE KEY UPDATE
          is_hidden = FALSE,
          hidden_at = NULL
      `;
      await query(sql, [userId, taskContentId, referenceContentId]);

      res.json({ message: "Reference unhidden successfully" });
    } catch (err) {
      console.error("Error unhiding reference:", err);
      res.status(500).json({ error: "Error unhiding reference" });
    }
  });

  // Get user permissions (for frontend)
  router.get("/api/user/permissions", async (req, res) => {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      // Get all permissions
      const permSql = `
        SELECT DISTINCT p.name
        FROM permissions p
        WHERE p.permission_id IN (
          SELECT permission_id FROM user_permissions WHERE user_id = ?
          UNION
          SELECT rp.permission_id
          FROM user_roles ur
          JOIN role_permissions rp ON ur.role_id = rp.role_id
          WHERE ur.user_id = ?
        )
      `;
      const perms = await query(permSql, [userId, userId]);

      // Get all roles
      const roleSql = `
        SELECT r.name
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        WHERE ur.user_id = ?
      `;
      const roles = await query(roleSql, [userId]);

      res.json({
        permissions: perms.map(p => p.name),
        roles: roles.map(r => r.name),
      });
    } catch (err) {
      console.error("Error fetching user permissions:", err);
      res.status(500).json({ error: "Error fetching permissions" });
    }
  });

  return router;
}
