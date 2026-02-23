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
    const { viewerId } = req.query;

    try {
      let sql, params;

      if (viewerId && viewerId !== 'null') {
        // User-specific view: only show discussions this user participated in
        sql = `
          SELECT * FROM discussion_entries
          WHERE content_id = ? AND user_id = ?
          ORDER BY created_at DESC
        `;
        params = [contentId, viewerId];
      } else {
        // View All: show all discussions
        sql = `SELECT * FROM discussion_entries WHERE content_id = ? ORDER BY created_at DESC`;
        params = [contentId];
      }

      const entries = await query(sql, params);
      res.json(entries);
    } catch (err) {
      console.error("❌ Error fetching entries:", err);
      res.status(500).json({ error: "Failed to fetch discussion entries" });
    }
  });

  // Get top contributors (by number of posts, platform-wide)
  app.get("/api/discussion/top-contributors", async (req, res) => {
    try {
      const sql = `
        SELECT
          COALESCE(u.username, de.user, 'Anonymous') as user,
          COUNT(*) as contributionCount,
          MAX(de.created_at) as lastContribution
        FROM discussion_entries de
        LEFT JOIN users u ON de.user_id = u.user_id
        GROUP BY COALESCE(u.username, de.user, 'Anonymous')
        ORDER BY contributionCount DESC, lastContribution DESC
        LIMIT 3
      `;
      let contributors = await query(sql);

      // If we don't have enough real contributors, add sample data
      if (contributors.length < 3) {
        const sampleContributors = [
          { user: "FactChecker", contributionCount: 42, lastContribution: new Date().toISOString() },
          { user: "TruthSeeker", contributionCount: 27, lastContribution: new Date(Date.now() - 3600000).toISOString() },
          { user: "LogicLover", contributionCount: 15, lastContribution: new Date(Date.now() - 7200000).toISOString() },
        ];

        // Merge real data with samples, taking only what we need to reach 3
        contributors = [...contributors, ...sampleContributors].slice(0, 3);
      }

      res.json(contributors);
    } catch (err) {
      console.error("❌ Error fetching top contributors:", err);
      res.status(500).json({ error: "Failed to fetch top contributors" });
    }
  });

  // Get hot topics (tasks with most discussion activity)
  app.get("/api/discussion/hot-topics", async (req, res) => {
    try {
      const sql = `
        SELECT
          c.content_id,
          c.content_name as task_title,
          COUNT(*) as discussion_count,
          SUM(CASE WHEN de.side = 'pro' THEN 1 ELSE 0 END) as pro_count,
          SUM(CASE WHEN de.side = 'con' THEN 1 ELSE 0 END) as con_count
        FROM discussion_entries de
        JOIN content c ON de.content_id = c.content_id
        GROUP BY c.content_id, c.content_name
        HAVING discussion_count > 0
        ORDER BY discussion_count DESC, MAX(de.created_at) DESC
        LIMIT 3
      `;
      let topics = await query(sql);

      // If we don't have enough real topics, add sample data
      if (topics.length < 3) {
        const sampleTopics = [
          {
            content_id: 9999,
            task_title: "Climate Change Evidence Analysis",
            discussion_count: 34,
            pro_count: 21,
            con_count: 13,
          },
          {
            content_id: 9998,
            task_title: "Social Media Impact Study",
            discussion_count: 28,
            pro_count: 15,
            con_count: 13,
          },
          {
            content_id: 9997,
            task_title: "AI Safety Research Review",
            discussion_count: 19,
            pro_count: 12,
            con_count: 7,
          },
        ];

        // Merge real data with samples, taking only what we need to reach 3
        topics = [...topics, ...sampleTopics].slice(0, 3);
      }

      res.json(topics);
    } catch (err) {
      console.error("❌ Error fetching hot topics:", err);
      res.status(500).json({ error: "Failed to fetch hot topics" });
    }
  });
};

export default registerDiscussionRoutes;
