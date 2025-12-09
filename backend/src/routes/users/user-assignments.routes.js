// /backend/src/routes/users/user-assignments.routes.js
import { Router } from "express";

export default function({ query, pool }) {
  const router = Router();

/**
 * GET /api/content/:taskId/get-users
 * Get users assigned to a task/content
 */
router.get("/api/content/:taskId/get-users", async (req, res) => {
  const { taskId } = req.params;
  const sql = `SELECT u.username, u.user_id
       FROM users u
       JOIN content_users tu ON u.user_id = tu.user_id
       WHERE tu.content_id = ?`;
  pool.query(sql, taskId, (err, rows) => {
    if (err) {
      console.error("Error fetching users for content:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    if (rows && rows[0]) {
      res.json(rows);
    } else {
      res.json([]);
    }
  });
});

/**
 * POST /api/content/:taskId/assign-user
 * Assign a user to a task/content
 */
router.post("/api/content/:taskId/assign-user", async (req, res) => {
  const { taskId } = req.params;
  const { userId } = req.body;
  const sql = `INSERT INTO content_users (content_id, user_id) VALUES (?, ?)`;
  const params = [taskId, userId];
  pool.query(sql, params, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error assigning user to task");
    }
    res.status(200).send("User assigned successfully");
  });
});

/**
 * POST /api/content/:taskId/unassign-user
 * Unassign a user from a task/content
 */
router.post("/api/content/:taskId/unassign-user", async (req, res) => {
  const { taskId } = req.params;
  const { userId } = req.body;
  const sql = `DELETE FROM content_users WHERE content_id = ? AND user_id = ?`;

  pool.query(sql, [taskId, userId], (err) => {
    if (err) return res.status(500).send("Error unassigning user");
    res.send("User unassigned");
  });
});

  return router;
}
