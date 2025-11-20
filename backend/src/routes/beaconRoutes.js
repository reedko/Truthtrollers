const registerBeaconRoutes = (app, query, pool) => {
  // 🧭 Verimeter core score
  app.get("/api/verimeter/:taskContentId", async (req, res) => {
    const { taskContentId } = req.params;
    try {
      const [[result]] = await query(`CALL compute_verimeter_score(?)`, [
        taskContentId,
      ]);
      res.json(result);
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
