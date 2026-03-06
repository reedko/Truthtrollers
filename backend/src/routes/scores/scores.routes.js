import { Router } from "express";

export default function createScoresRoutes({ query, pool }) {
  const router = Router();

  // NOTE: /api/live-verimeter-score/:claimId is handled by claims.routes.js
  // (removed duplicate to avoid conflicts)

  // GET /api/content/:contentId/scores (SPLIT SCORES: personal + global)
  router.get("/api/content/:contentId/scores", async (req, res) => {
    const { contentId } = req.params;
    const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;
    const currentUserId = req.user?.user_id || viewerId;
    const scope = req.query.scope || 'user';

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

      // Phase 4: Compute BOTH personal and global scores
      const userIdForPersonal = viewerId !== null ? viewerId : currentUserId;

      // Compute personal score (for this user)
      try {
        await query("CALL compute_verimeter_for_content(?, ?)", [
          contentId,
          userIdForPersonal,
        ]);
      } catch (err) {
        console.error(`❌ Error computing personal score:`, err.message);
      }

      // Get personal score
      let [personalRow] = await query(
        "SELECT verimeter_score, trollmeter_score, pro_score, con_score FROM content_scores WHERE content_id = ?",
        [contentId]
      );

      // Compute global score (all users - pass NULL)
      let globalRow = null;
      try {
        await query("CALL compute_verimeter_for_content(?, ?)", [
          contentId,
          null, // NULL = all users
        ]);

        // Store global score temporarily
        [globalRow] = await query(
          "SELECT verimeter_score FROM content_scores WHERE content_id = ?",
          [contentId]
        );
      } catch (err) {
        console.error(`❌ Error computing global score:`, err.message);
      }

      // Restore personal score (so content_scores table shows user's score)
      if (personalRow) {
        await query(
          "UPDATE content_scores SET verimeter_score = ?, trollmeter_score = ?, pro_score = ?, con_score = ? WHERE content_id = ?",
          [
            personalRow.verimeter_score,
            personalRow.trollmeter_score,
            personalRow.pro_score,
            personalRow.con_score,
            contentId,
          ]
        );
      }

      if (!personalRow) {
        return res.status(404).json({ error: "Failed to compute scores" });
      }

      const personalScore = personalRow.verimeter_score || 0;
      const globalScore = globalRow?.verimeter_score || personalScore;
      const delta = personalScore - globalScore;
      const deltaPercent = globalScore !== 0 ? ((delta / Math.abs(globalScore)) * 100) : 0;

      res.json({
        // Personal scores
        verimeter_score: personalScore,
        trollmeter_score: personalRow.trollmeter_score,
        pro_score: personalRow.pro_score,
        con_score: personalRow.con_score,

        // Phase 4: Split scores
        personal_verimeter: personalScore,
        global_verimeter: globalScore,
        delta: delta,
        delta_percent: Math.round(deltaPercent),

        // Sentiment description
        sentiment: delta > 0.15
          ? 'more_truthy'
          : delta < -0.15
            ? 'more_skeptical'
            : 'aligned',

        computedFor: viewerId !== null ? `user_${viewerId}` : 'all_users',
      });
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
