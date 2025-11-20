import getCitationScore from "../utils/getCitationScore.js";

const registerDiscussionRoutes = (app, query, pool) => {
  app.post("/api/discussion", async (req, res) => {
    const { content_id, side, text, citation_url, linked_claim_id, user_id } =
      req.body;

    let citation_score = null;
    if (citation_url) {
      try {
        citation_score = await getCitationScore(citation_url);
      } catch (err) {
        console.warn("⚠️ Citation score fallback:", err);
      }
    }

    try {
      const insertSql = `
        INSERT INTO discussion_entries
        (content_id, side, text, citation_url, citation_score, linked_claim_id, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await query(insertSql, [
        content_id,
        side,
        text,
        citation_url || null,
        citation_score,
        linked_claim_id || null,
        user_id || null,
      ]);

      const [newEntry] = await query(
        `SELECT * FROM discussion_entries WHERE id = ?`,
        [result.insertId]
      );

      res.status(201).json(newEntry);
    } catch (err) {
      console.error("❌ Error creating discussion entry:", err);
      res.status(500).json({ error: "Failed to submit entry" });
    }
  });

  app.get("/api/discussion/:contentId", async (req, res) => {
    const { contentId } = req.params;
    try {
      const sql = `SELECT * FROM discussion_entries WHERE content_id = ? ORDER BY created_at DESC`;
      const entries = await query(sql, [contentId]);

      res.json(entries);
    } catch (err) {
      console.error("❌ Error fetching entries:", err);
      res.status(500).json({ error: "Failed to fetch discussion entries" });
    }
  });
};

export default registerDiscussionRoutes;
