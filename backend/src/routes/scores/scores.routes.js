import { Router } from "express";

export default function createScoresRoutes({ query, pool }) {
  const router = Router();

  // NOTE: /api/live-verimeter-score/:claimId is handled by claims.routes.js
  // (removed duplicate to avoid conflicts)

  // GET /api/content/:contentId/scores
  router.get("/api/content/:contentId/scores", async (req, res) => {
    const { contentId } = req.params;
    const { userId } = req.body;

    try {
      // First check if content exists
      const contentExists = await query(
        "SELECT content_id FROM content WHERE content_id = ?",
        [contentId]
      );

      if (!contentExists || contentExists.length === 0) {
        return res.status(404).json({
          error: "Content not found",
          message: `Content ID ${contentId} does not exist`
        });
      }

      let [row] = await query(
        "SELECT verimeter_score, trollmeter_score, pro_score, con_score FROM content_scores WHERE content_id = ?",
        [contentId]
      );

      if (!row) {
        // Run your stored procedures to populate the table
        try {
          await query("CALL compute_verimeter_for_content(?, ?)", [
            contentId,
            userId,
          ]);

          await query("CALL compute_trollmeter_score(?)", [contentId]);
        } catch (err) {
          console.error(`❌ Error computing scores for content ${contentId}:`, err.message);
          return res.status(500).json({
            error: "Failed to compute scores",
            message: err.message
          });
        }

        // Try again
        [row] = await query(
          "SELECT verimeter_score, trollmeter_score, pro_score, con_score FROM content_scores WHERE content_id = ?",
          [contentId]
        );

        if (!row) {
          return res.status(404).json({ error: "Not found, even after compute" });
        }
      }

      res.json(row);
    } catch (err) {
      console.error(`❌ Error fetching scores for content ${contentId}:`, err.message);
      res.status(500).json({
        error: "Internal server error",
        message: err.message
      });
    }
  });

  // POST /api/content/:contentId/scores/recompute
  router.post("/api/content/:contentId/scores/recompute", async (req, res) => {
    const { contentId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    try {
      // First check if content exists
      const contentExists = await query(
        "SELECT content_id FROM content WHERE content_id = ?",
        [contentId]
      );

      if (!contentExists || contentExists.length === 0) {
        return res.status(404).json({
          error: "Content not found",
          message: `Content ID ${contentId} does not exist`
        });
      }

      // Run your stored procedures with userId
      await query("CALL compute_verimeter_for_content(?, ?)", [
        contentId,
        userId,
      ]);

      await query("CALL compute_trollmeter_score(?)", [contentId]);

      res.json({ success: true });
    } catch (err) {
      console.error(`❌ Failed to recompute scores for content ${contentId}:`, err.message);
      res.status(500).json({
        error: "Failed to recompute scores",
        message: err.message
      });
    }
  });

  return router;
}
