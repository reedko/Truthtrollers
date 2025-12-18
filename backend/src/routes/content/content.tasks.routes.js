// /backend/src/routes/content/content.tasks.routes.js
import { Router } from "express";
import logger from "../../utils/logger.js";

export default function({ query, pool }) {
  const router = Router();

/**
 * GET /api/tasks/:id
 * Get single task by ID
 */
router.get("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const SQL = "SELECT * FROM content WHERE content_id = ?";
    const result = await query(SQL, [id]);
    res.json(result[0] || {});
  } catch (err) {
    logger.error("Error fetching task by ID:", err);
    res.status(500).json({ error: "Database error" });
  }
});

/**
 * GET /api/user-tasks/:user_id
 * Get tasks for a specific user
 */
router.get("/api/user-tasks/:user_id", async (req, res) => {
  const { user_id } = req.params;
  const sql = `
    SELECT
      t.*,
      (
        SELECT topic_name
        FROM topics tt
        JOIN content_topics ct ON tt.topic_id = ct.topic_id
        WHERE ct.content_id = t.content_id
        ORDER BY ct.topic_order ASC
        LIMIT 1
      ) AS topic,
   (
    SELECT JSON_ARRAYAGG(
             JSON_OBJECT(
               'author_id', a.author_id,
               'author_first_name', IFNULL(a.author_first_name, ''),
               'author_last_name', IFNULL(a.author_last_name, ''),
               'author_title', IFNULL(a.author_title, ''),
               'author_profile_pic', a.author_profile_pic,
               'description', a.description
             )
           )
    FROM content_authors ca
    JOIN authors a ON ca.author_id = a.author_id
    WHERE ca.content_id = t.content_id
  ) AS authors,

 (
    SELECT JSON_ARRAYAGG(
             JSON_OBJECT(
               'publisher_id', p.publisher_id,
               'publisher_name', p.publisher_name,
               'publisher_icon', p.publisher_icon,
               'description', p.description
             )
           )
    FROM content_publishers cp
    JOIN publishers p ON cp.publisher_id = p.publisher_id
    WHERE cp.content_id = t.content_id
  ) AS publishers

    FROM content t
    JOIN content_users cu ON t.content_id = cu.content_id
    WHERE cu.user_id = ? AND t.content_type = 'task'
    GROUP BY t.content_id
  `;
  pool.query(sql, [user_id], (err, results) => {
    if (err) {
      logger.error("❌ Error fetching user tasks:", err);
      return res.status(500).json({ error: "Query failed" });
    }
    res.json(results);
  });
});

/**
 * GET /api/unified-tasks/:pivotType/:pivotId
 * Get tasks by pivot (task, author, publisher, reference)
 */
router.get("/api/unified-tasks/:pivotType/:pivotId", (req, res) => {
  const { pivotType, pivotId } = req.params;

  let sql = "";
  let params = [pivotId];

  if (pivotType === "task") {
    sql = `SELECT ... FROM content t WHERE t.content_id = ?`;
  } else if (pivotType === "author") {
    sql = `
      SELECT ...
      FROM content t
      JOIN content_authors ca ON t.content_id = ca.content_id
      WHERE ca.author_id = ?`;
  } else if (pivotType === "publisher") {
    sql = `
      SELECT ...
      FROM content t
      JOIN content_publishers cp ON t.content_id = cp.content_id
      WHERE cp.publisher_id = ?`;
  } else if (pivotType === "reference") {
    sql = `
      SELECT ...
      FROM content t
      JOIN content_relations cr ON cr.task_content_id = t.content_id
      WHERE cr.reference_content_id = ?`;
  } else {
    return res.status(400).json({ error: "Invalid pivot type" });
  }

  // Append your JSON subqueries for authors, publishers, users, topic here 👇
  sql = sql.replace(
    "SELECT ...",
    `
    SELECT DISTINCT
      t.*,
      (
        SELECT topic_name
        FROM topics tt
        JOIN content_topics ct ON tt.topic_id = ct.topic_id
        WHERE ct.content_id = t.content_id
        ORDER BY ct.topic_order ASC
        LIMIT 1
      ) AS topic,

      (
        SELECT JSON_ARRAYAGG(
                 JSON_OBJECT(
                               'author_id', a.author_id,
              'author_first_name', IFNULL(a.author_first_name, ''),
              'author_last_name', IFNULL(a.author_last_name, ''),
              'author_title', IFNULL(a.author_title, ''),
              'author_profile_pic', a.author_profile_pic,
              'description', a.description
                 )
               )
        FROM content_authors ca
        JOIN authors a ON ca.author_id = a.author_id
        WHERE ca.content_id = t.content_id
      ) AS authors,

      (
        SELECT JSON_ARRAYAGG(
                 JSON_OBJECT(
                   'publisher_id', p.publisher_id,
                   'publisher_name', p.publisher_name,
                   'publisher_icon', p.publisher_icon,
                   'description', p.description
                 )
               )
        FROM content_publishers cp
        JOIN publishers p ON cp.publisher_id = p.publisher_id
        WHERE cp.content_id = t.content_id
      ) AS publishers,

      (
        SELECT JSON_ARRAYAGG(
                 JSON_OBJECT(
                   'user_id', u.user_id,
                   'username', u.username,
                   'email', u.email
                 )
               )
        FROM content_users cu
        JOIN users u ON cu.user_id = u.user_id
        WHERE cu.content_id = t.content_id
      ) AS users
  `
  );

  pool.query(sql, params, (err, results) => {
    if (err) {
      logger.error("Pivot query failed:", err);
      // Return empty array instead of error to prevent dashboard crashes
      // This handles cases where content was deleted but dashboard still references it
      return res.json([]);
    }
    res.json(results);
  });
});

  return router;
}
