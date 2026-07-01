import { Router } from "express";
import { requirePermission, userHasPermission, userHasRole } from "../../middleware/permissions.js";
import { authenticateToken } from "../../middleware/auth.js";

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

  //get references with claims for a content_id (VIEWER-FILTERED + SCOPE)
  router.get(
    "/api/content/:task_content_id/references-with-claims",
    async (req, res) => {
      const { task_content_id } = req.params;
      const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;
      const scope = req.query.scope || 'user'; // 'user' | 'all' | 'admin'
      const currentUserId = req.user?.user_id || viewerId; // Use JWT user if available

      // 🔍 DEBUG LOGGING
      console.log(`\n🔍 REFERENCES QUERY: task=${task_content_id}, viewerId=${viewerId}, scope=${scope}, currentUserId=${currentUserId}`);
      process.stderr.write(`[${new Date().toISOString()}] 🔍 REFS: task=${task_content_id}, viewer=${viewerId}, scope=${scope}, currUser=${currentUserId}\n`);

      try {
        let whereClause = '';
        let params = [];

        // Build WHERE clause based on scope
        if (scope === 'admin') {
          // Admin: show everything including provenance
          whereClause = `
            WHERE cr.content_id = ?
            -- Admin sees all, including globally_removed
          `;
          params = [task_content_id];
        } else if (scope === 'all') {
          // All Users: global + all_users_added - globally_removed
          whereClause = `
            WHERE cr.content_id = ?
              AND (cr.globally_removed IS NULL OR cr.globally_removed = FALSE)
          `;
          params = [task_content_id];
        } else {
          // User View: global + user_added - user_hidden
          whereClause = `
            WHERE cr.content_id = ?
              AND (
                -- Always show system refs (explicit TRUE or legacy NULL)
                cr.is_system = TRUE
                OR cr.is_system IS NULL
                OR
                -- Show user's own refs
                ${viewerId ? 'cr.added_by_user_id = ?' : '1=1'}
              )
              AND (urv.is_hidden IS NULL OR urv.is_hidden = FALSE)
              AND (cr.globally_removed IS NULL OR cr.globally_removed = FALSE)
          `;
          params = viewerId ? [task_content_id, viewerId] : [task_content_id];
        }

        // Claims are aggregated in a correlated subquery to prevent fan-out duplication
        // when a reference has multiple publishers or authors (each extra join row would
        // otherwise repeat every claim in JSON_ARRAYAGG).
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
          ${scope === 'admin' ? 'cr.globally_removed, urv.is_hidden AS user_hidden,' : ''}
          (SELECT cp_selected.publisher_id
             FROM content_publishers cp_selected
            WHERE cp_selected.content_id = c.content_id
            ORDER BY cp_selected.is_primary DESC, cp_selected.content_publisher_id DESC
            LIMIT 1) AS publisher_id,
          COALESCE(
            (SELECT p_selected.publisher_name
               FROM content_publishers cp_selected
               JOIN publishers p_selected ON p_selected.publisher_id = cp_selected.publisher_id
              WHERE cp_selected.content_id = c.content_id
              ORDER BY cp_selected.is_primary DESC, cp_selected.content_publisher_id DESC
              LIMIT 1),
            NULLIF(c.media_source, 'web'), NULLIF(c.media_source, ''), MIN(c.url)
          ) AS publisher_name,
          AVG(CASE WHEN pr.user_id IS NULL THEN pr.veracity_score ELSE NULL END) AS publisher_veracity,
          SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN pr.user_id IS NULL THEN pr.rating_label ELSE NULL END ORDER BY pr.last_checked DESC SEPARATOR '||'), '||', 1) AS rating_label,
          SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN pr.user_id IS NULL THEN pr.rating_type ELSE NULL END ORDER BY pr.last_checked DESC SEPARATOR '||'), '||', 1) AS rating_type,
          (SELECT pp.source_type FROM publisher_profiles pp
            WHERE pp.publisher_id = (
              SELECT cp5.publisher_id FROM content_publishers cp5
               WHERE cp5.content_id = c.content_id
               ORDER BY cp5.is_primary DESC, cp5.content_publisher_id DESC LIMIT 1
            ) AND pp.source_type IS NOT NULL
            ORDER BY pp.last_checked DESC LIMIT 1) AS source_type,
          CASE WHEN EXISTS (
            SELECT 1 FROM publisher_external_signals pes
             WHERE pes.publisher_id = (
               SELECT cp4.publisher_id FROM content_publishers cp4
                WHERE cp4.content_id = c.content_id
                ORDER BY cp4.is_primary DESC, cp4.content_publisher_id DESC LIMIT 1
             )
               AND pes.provider = 'own_site_org_status'
               AND (pes.expires_at IS NULL OR pes.expires_at > NOW())
               AND JSON_SEARCH(pes.flags, 'one', 'material_industry_interest') IS NOT NULL
          ) THEN 'IND'
          WHEN EXISTS (
            SELECT 1 FROM publisher_external_signals pes
             WHERE pes.publisher_id = (
               SELECT cp5.publisher_id FROM content_publishers cp5
                WHERE cp5.content_id = c.content_id
                ORDER BY cp5.is_primary DESC, cp5.content_publisher_id DESC LIMIT 1
             )
               AND pes.provider = 'own_site_org_status'
               AND (pes.expires_at IS NULL OR pes.expires_at > NOW())
               AND JSON_UNQUOTE(JSON_EXTRACT(pes.raw_value, '$.normalized.publisher_type')) = 'government_organization'
          ) THEN 'GOV'
          ELSE NULL END AS alignment_marker,
          CASE WHEN EXISTS (
            SELECT 1 FROM publisher_external_signals pes
             WHERE pes.publisher_id = (
               SELECT cp5.publisher_id FROM content_publishers cp5
                WHERE cp5.content_id = c.content_id
                ORDER BY cp5.is_primary DESC, cp5.content_publisher_id DESC LIMIT 1
             )
               AND pes.provider = 'own_site_org_status'
               AND (pes.expires_at IS NULL OR pes.expires_at > NOW())
               AND JSON_UNQUOTE(JSON_EXTRACT(pes.raw_value, '$.normalized.publisher_type')) = 'government_organization'
          ) THEN 0 ELSE MAX(pub.conflict_of_interest_score) END AS alignment_risk_score,
          MIN(a.author_id)        AS author_id,
          MIN(CONCAT(a.author_first_name, ' ', COALESCE(a.author_last_name, ''))) AS author_name,
          (
            SELECT COALESCE(
              JSON_ARRAYAGG(
                JSON_OBJECT(
                  'author_id', a2.author_id,
                  'author_first_name', IFNULL(a2.author_first_name, ''),
                  'author_last_name', IFNULL(a2.author_last_name, ''),
                  'author_title', IFNULL(a2.author_title, ''),
                  'author_profile_pic', a2.author_profile_pic
                )
              ),
              JSON_ARRAY()
            )
            FROM content_authors ca2
            JOIN authors a2 ON a2.author_id = ca2.author_id
            WHERE ca2.content_id = c.content_id
          ) AS authors,
          COALESCE(
            (SELECT ae.admiralty_code FROM admiralty_evaluations ae
             WHERE ae.target_type = 'content' AND ae.target_id = c.content_id
               AND (
                 ae.publisher_id IS NULL
                 OR ae.publisher_id IN (
                   SELECT cp3.publisher_id FROM content_publishers cp3 WHERE cp3.content_id = c.content_id
                 )
               )
               AND ae.evaluation_status NOT IN ('insufficient_data')
               AND ae.admiralty_code REGEXP '^[A-E]'
             ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested') LIMIT 1),
            (SELECT ae.admiralty_code FROM admiralty_evaluations ae
             INNER JOIN content_publishers cp2 ON ae.target_id = cp2.publisher_id
             WHERE ae.target_type = 'publisher' AND cp2.content_id = c.content_id
               AND ae.evaluation_status NOT IN ('insufficient_data')
               AND ae.admiralty_code REGEXP '^[A-E]'
             ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested') LIMIT 1)
          ) AS admiralty_code,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM admiralty_evaluations ae
               WHERE ae.target_type = 'content' AND ae.target_id = c.content_id
                 AND (
                   ae.publisher_id IS NULL
                   OR ae.publisher_id IN (
                     SELECT cp3.publisher_id FROM content_publishers cp3 WHERE cp3.content_id = c.content_id
                   )
                 )
                 AND ae.evaluation_status NOT IN ('insufficient_data')
                 AND ae.admiralty_code REGEXP '^[A-E]'
               LIMIT 1
            ) THEN 'content'
            WHEN EXISTS (
              SELECT 1 FROM admiralty_evaluations ae
              INNER JOIN content_publishers cp2 ON ae.target_id = cp2.publisher_id
               WHERE ae.target_type = 'publisher' AND cp2.content_id = c.content_id
                 AND ae.evaluation_status NOT IN ('insufficient_data')
                 AND ae.admiralty_code REGEXP '^[A-E]'
               LIMIT 1
            ) THEN 'publisher_cached'
            ELSE NULL
          END AS admiralty_source,
          (
            SELECT COALESCE(JSON_ARRAYAGG(
              IF((ucv2.is_hidden IS NULL OR ucv2.is_hidden = FALSE) AND cl2.claim_id IS NOT NULL,
                 JSON_OBJECT(
                   'claim_id', cl2.claim_id,
                   'claim_text', cl2.claim_text,
                   'claim_type', cl2.claim_type,
                   'veracity_score', cl2.veracity_score,
                   'confidence_level', cl2.confidence_level,
                   'last_verified', cl2.last_verified,
                   'claim_role', cc2.claim_role,
                   'parent_claim_id', cc2.parent_claim_id,
                   'claim_depth', cc2.claim_depth,
                   'centrality_score', cc2.centrality_score,
                   'verifiability_score', cc2.verifiability_score,
                   'claim_order', cc2.claim_order,
                   'relationship_type', cc2.relationship_type
                 ),
                 NULL)
            ), '[]')
            FROM content_claims cc2
              LEFT JOIN claims cl2 ON cc2.claim_id = cl2.claim_id
              LEFT JOIN user_claim_visibility ucv2 ON cl2.claim_id = ucv2.claim_id AND ucv2.user_id = ?
              WHERE cc2.content_id = c.content_id
          ) AS claims
         FROM content c
        INNER JOIN content_relations cr ON c.content_id = cr.reference_content_id
        LEFT JOIN content_publishers cp_pub ON c.content_id = cp_pub.content_id
        LEFT JOIN publishers pub ON cp_pub.publisher_id = pub.publisher_id
        LEFT JOIN publisher_ratings pr ON pub.publisher_id = pr.publisher_id
        LEFT JOIN content_authors ca ON c.content_id = ca.content_id
        LEFT JOIN authors a ON ca.author_id = a.author_id
        ${scope !== 'all' ? `
        LEFT JOIN user_reference_visibility urv
          ON urv.task_content_id = cr.content_id
          AND urv.reference_content_id = cr.reference_content_id
          AND urv.user_id = ?
        ` : ''}
        ${whereClause}
        GROUP BY c.content_id, c.content_name, c.url, c.thumbnail, c.progress,
                 c.details, c.media_source, c.topic, c.subtopic,
                 cr.added_by_user_id, cr.is_system
                 ${scope === 'admin' ? ', cr.globally_removed, urv.is_hidden' : ''}
        `;

        // Add currentUserId to params for user_claim_visibility and user_reference_visibility joins
        const finalParams = scope !== 'all'
          ? [currentUserId, currentUserId, ...params]  // First for ucv, second for urv
          : [currentUserId, ...params];  // Only ucv for 'all' scope

        const referencesWithClaims = await query(SQL, finalParams);

        if (/^(1|true|yes)$/i.test(process.env.PUBLISHER_REFERENCE_DEBUG || "")) {
          let totalClaimsCount = 0;
          referencesWithClaims.forEach(ref => {
            const claims = Array.isArray(ref.claims)
              ? ref.claims
              : (typeof ref.claims === 'string' ? JSON.parse(ref.claims) : []);
            console.log(`   📦 Ref "${ref.content_name}" has ${claims.length} claims`);
            totalClaimsCount += claims.length;
          });
          console.log(`📊 TOTAL CLAIMS across all references: ${totalClaimsCount}`);
        }
        process.stderr.write(`[${new Date().toISOString()}] ✅ FOUND ${referencesWithClaims.length} refs\n`);

        // Filter out null claims from the arrays (hidden claims)
        const filteredReferences = referencesWithClaims.map(ref => {
          let claims = Array.isArray(ref.claims)
            ? ref.claims
            : (typeof ref.claims === 'string' ? JSON.parse(ref.claims) : []);

          let authors = Array.isArray(ref.authors)
            ? ref.authors
            : (typeof ref.authors === 'string' ? JSON.parse(ref.authors) : []);

          // Remove null entries (hidden claims)
          claims = claims.filter(claim => claim !== null && claim.claim_id !== null);
          authors = authors.filter(author => author !== null && author.author_id !== null);

          return { ...ref, claims, authors };
        });

        res.json(filteredReferences);
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
    // Default to system reference (evidence engine always creates system refs)
    // Only mark as non-system if explicitly set to false
    const isSystemRef = req.body.isSystemRef !== undefined ? req.body.isSystemRef : true;

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

  // Hard-delete references from a task for everyone (super_admin only)
  router.delete("/api/references/permanent", authenticateToken, requirePermission(query, 'delete_system_references'), async (req, res) => {
    const { taskId, referenceIds } = req.body;
    if (!taskId || !Array.isArray(referenceIds) || referenceIds.length === 0) {
      return res.status(400).json({ error: "taskId and referenceIds array required" });
    }

    try {
      const ph = referenceIds.map(() => "?").join(",");
      await query(
        `DELETE FROM user_reference_visibility WHERE task_content_id = ? AND reference_content_id IN (${ph})`,
        [taskId, ...referenceIds],
      );
      await query(
        `DELETE FROM content_relations WHERE content_id = ? AND reference_content_id IN (${ph})`,
        [taskId, ...referenceIds],
      );

      // "Permanent" must not leave an orphaned content row behind. Reusing
      // that row on the next scrape preserves its old claims and metadata,
      // which makes a delete-and-rescrape appear not to have deleted anything.
      // Preserve genuinely shared references that are still linked elsewhere.
      const purgedReferenceIds = [];
      const retainedSharedReferenceIds = [];
      for (const referenceId of referenceIds) {
        const remainingParents = await query(
          `SELECT COUNT(*) AS count
             FROM content_relations
            WHERE reference_content_id = ?`,
          [referenceId],
        );
        if (Number(remainingParents?.[0]?.count || 0) > 0) {
          retainedSharedReferenceIds.push(referenceId);
          continue;
        }

        await query(`CALL delete_content_cascade(?)`, [referenceId]);
        purgedReferenceIds.push(referenceId);
      }

      res.json({
        message: `${referenceIds.length} reference(s) removed; ${purgedReferenceIds.length} orphaned reference(s) fully purged`,
        purgedReferenceIds,
        retainedSharedReferenceIds,
      });
    } catch (err) {
      console.error("Error permanently deleting references:", err);
      res.status(500).json({ error: "Error deleting references" });
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
  router.post("/api/references/hide", authenticateToken, async (req, res) => {
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

  // Admin-only: Hard delete a reference (globally_removed = TRUE)
  router.delete("/api/references/admin-delete", authenticateToken, requirePermission(query, 'delete_system_references'), async (req, res) => {
    const { taskContentId, referenceContentId } = req.body;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!taskContentId || !referenceContentId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // Set globally_removed = TRUE (admin hard-delete)
      const sql = `
        UPDATE content_relations
        SET globally_removed = TRUE
        WHERE content_id = ? AND reference_content_id = ?
      `;
      const result = await query(sql, [taskContentId, referenceContentId]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Reference relation not found" });
      }

      res.json({ message: "Reference permanently removed (admin delete)" });
    } catch (err) {
      console.error("Error admin-deleting reference:", err);
      res.status(500).json({ error: "Error removing reference" });
    }
  });

  // Unhide reference for current user
  router.post("/api/references/unhide", authenticateToken, async (req, res) => {
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
  router.get("/api/user/permissions", authenticateToken, async (req, res) => {
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
