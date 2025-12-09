import { Router } from "express";

export default function createScoresRoutes({ query, pool }) {
  const router = Router();

  // NOTE: /api/live-verimeter-score/:claimId is handled by claims.routes.js
  // (removed duplicate to avoid conflicts)

  // GET /api/content/:contentId/scores
  router.get("/api/content/:contentId/scores", async (req, res) => {
    const { contentId } = req.params;
    const { userId } = req.body;

    let [row] = await query(
      "SELECT verimeter_score, trollmeter_score, pro_score, con_score FROM content_scores WHERE content_id = ?",
      [contentId]
    );
    if (!row) {
      // Run your stored procedures to populate the table
      await query("CALL compute_verimeter_for_content(?, ?)", [
        contentId,
        userId,
      ]);

      await query("CALL compute_trollmeter_score(?)", [contentId]);
      // Try again
      [row] = await query(
        "SELECT verimeter_score, trollmeter_score, pro_score, con_score FROM content_scores WHERE content_id = ?",
        [contentId]
      );
      if (!row)
        return res.status(404).json({ error: "Not found, even after compute" });
    }

    res.json(row);
  });

  // POST /api/content/:contentId/scores/recompute
  router.post("/api/content/:contentId/scores/recompute", async (req, res) => {
    const { contentId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    try {
      // Run your stored procedures with userId
      await query("CALL compute_verimeter_for_content(?, ?)", [
        contentId,
        userId,
      ]);

      await query("CALL compute_trollmeter_score(?)", [contentId]);

      res.json({ success: true });
    } catch (err) {
      console.error("Failed to recompute scores:", err);
      res.status(500).json({ error: "Failed to recompute scores" });
    }
  });

  return router;
}
