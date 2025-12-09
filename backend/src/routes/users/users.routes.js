// /backend/src/routes/users/users.routes.js
import { Router } from "express";
import bcrypt from "bcrypt";
import { authenticateToken } from "../../middleware/auth.js";

export default function createUsersRoutes({ query, pool }) {
  const router = Router();

/**
 * GET /api/all-users
 * Get all users
 */
router.get("/api/all-users", async (req, res) => {
  const sql = "SELECT * FROM users";
  pool.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching users:", err);
      return res.status(500).json({ error: "Database query failed" });
    }
    res.json(results);
  });
});

/**
 * POST /api/change-email
 * Change user email (requires authentication)
 */
router.post("/api/change-email", authenticateToken, (req, res) => {
  const { newEmail, password } = req.body;
  const userId = req.user.id;

  if (!newEmail || !password)
    return res.status(400).json({ error: "Missing fields." });

  pool.query("SELECT * FROM users WHERE id = ?", [userId], (err, results) => {
    if (err || results.length === 0)
      return res.status(400).json({ error: "User not found." });

    const user = results[0];
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid password." });
    }

    pool.query(
      "UPDATE users SET email = ? WHERE id = ?",
      [newEmail, userId],
      (err2) => {
        if (err2) return res.status(500).json({ error: "Update failed." });
        res.status(200).json({ message: "Email updated successfully." });
      }
    );
  });
});

/**
 * POST /api/change-password
 * Change user password (requires authentication)
 */
router.post("/api/change-password", authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Missing fields." });

  pool.query("SELECT * FROM users WHERE id = ?", [userId], (err, results) => {
    if (err || results.length === 0)
      return res.status(400).json({ error: "User not found." });

    const user = results[0];
    if (!bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(401).json({ error: "Current password incorrect." });
    }

    const hashedNew = bcrypt.hashSync(newPassword, 10);
    pool.query(
      "UPDATE users SET password = ? WHERE id = ?",
      [hashedNew, userId],
      (err2) => {
        if (err2)
          return res.status(500).json({ error: "Password update failed." });
        res.status(200).json({ message: "Password changed successfully." });
      }
    );
  });
});

  return router;
}
