import { calculateUserContentScore } from "../services/verimeterScoringService.js";

const registerBeaconRoutes = (app, query, pool) => {
  // 🧭 Verimeter core score
  app.get("/api/verimeter/:taskContentId", async (req, res) => {
    const { taskContentId } = req.params;
    const viewerId = req.query.viewerId ? Number(req.query.viewerId) : null;
    try {
      const scores = await calculateUserContentScore(query, Number(taskContentId), viewerId);
      res.json({
        ...scores,
        score: scores.verimeter_score,
        verimeter_score: scores.verimeter_score,
        source: "verimeterScoringService",
      });
    } catch (err) {
      console.error("❌ Verimeter Score Error:", err);
      res.status(500).json({ error: "Failed to compute Verimeter score" });
    }
  });

  // 🍿 Trollmeter crowd sentiment rating
  app.get("/api/trollmeter/:taskContentId", async (req, res) => {
    const { taskContentId } = req.params;
    try {
      const [[result]] = await query(`CALL compute_trollmeter_score(?)`, [
        taskContentId,
      ]);
      res.json(result);
    } catch (err) {
      console.error("❌ Trollmeter Error:", err);
      res.status(500).json({ error: "Failed to compute Trollmeter score" });
    }
  });
};

export default registerBeaconRoutes;
