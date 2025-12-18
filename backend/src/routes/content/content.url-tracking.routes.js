// /backend/src/routes/content/content.url-tracking.routes.js
import { Router } from "express";
import logger from "../../utils/logger.js";

export default function({ query, pool }) {
  const router = Router();

/**
 * POST /api/store-last-visited-url
 * Store the last visited URL
 */
router.post("/api/store-last-visited-url", async (req, res) => {
  const { url } = req.body;
  try {
    await query(
      "INSERT INTO last_visited (id, url) VALUES (1, ?) ON DUPLICATE KEY UPDATE url = ?",
      [url, url]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error("DB Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/get-last-visited-url
 * Get the last visited URL
 */
router.get("/api/get-last-visited-url", async (req, res) => {
  try {
    const sql = "SELECT url FROM last_visited ORDER BY id DESC LIMIT 1";
    const rows = await query(sql);
    logger.log(rows[0]?.url, ":", Date.now());
    if (!rows || rows.length === 0) {
      return res.status(200).json({ url: null }); // Reference not found
    }
    res.json({ url: rows[0].url || "" });
  } catch (err) {
    logger.error("DB Fetch Error:", err);
    res.status(500).json({ url: "" });
  }
});

  return router;
}
