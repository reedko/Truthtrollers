import { Router } from "express";

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

  //get references with claims for a content_id
  router.get(
    "/api/content/:task_content_id/references-with-claims",
    async (req, res) => {
      console.log("Received request for contentId:", req.params.task_content_id);
      const { task_content_id } = req.params;

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
               COALESCE(JSON_ARRAYAGG(
                 JSON_OBJECT('claim_id', cl.claim_id, 'claim_text', cl.claim_text)
               ), '[]') AS claims
         FROM content c
        INNER JOIN content_relations cr ON c.content_id = cr.reference_content_id
        LEFT JOIN content_claims cc ON c.content_id = cc.content_id
        LEFT JOIN claims cl ON cc.claim_id = cl.claim_id
        WHERE cr.content_id = ?
        GROUP BY c.content_id
        `;

        const params = [task_content_id];
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

  // Add content relation
  router.post("/api/add-content-relation", async (req, res) => {
    const taskContentId = req.body.taskContentId;
    const referenceContentId = req.body.referenceContentId;

    try {
      // Check if this task-reference pair already exists
      const checkExistingTaskRef = `SELECT 1 FROM content_relations WHERE content_id = ? AND reference_content_id = ?`;
      const existingTaskRefs = await query(checkExistingTaskRef, [
        taskContentId,
        referenceContentId,
      ]);

      if (existingTaskRefs.length === 0) {
        // Insert task-reference if it doesn't exist
        await query(
          `INSERT INTO content_relations (content_id, reference_content_id) VALUES (?, ?)`,
          [taskContentId, referenceContentId]
        );
        console.log(
          `Reference ${referenceContentId} linked to task ${taskContentId}`
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

  // Delete content relation
  router.delete("/api/remove-content-relation", async (req, res) => {
    const taskContentId = req.body.taskContentId;
    const referenceContentId = req.body.referenceContentId;
    const sql = `DELETE FROM content_relations WHERE content_id = ? AND reference_content_id =?`;
    pool.query(sql, [taskContentId, referenceContentId], (err) => {
      if (err) return res.status(500).send("Error removing sources");
      res.send("Sources removed");
    });
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

  return router;
}
