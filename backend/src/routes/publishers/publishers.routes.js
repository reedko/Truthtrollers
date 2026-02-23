// /backend/src/routes/publishers/publishers.routes.js
import { Router } from "express";

export default function createPublishersRoutes({ query, pool }) {
  const router = Router();

  /**
   * GET /api/content/:publisherId/publisher
   * Get a single publisher by publisherId
   */
  router.get("/api/content/:publisherId/publisher", async (req, res) => {
    const { publisherId } = req.params;
    const sql = `SELECT * FROM  publishers
    WHERE publisher_id = ?`;
    pool.query(sql, publisherId, (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error fetching authors");
      }

      return res.json(rows);
    });
  });

  /**
   * GET /api/content/:taskId/publishers
   * Get all publishers for a specific content/task
   */
  router.get("/api/content/:taskId/publishers", async (req, res) => {
    const { taskId } = req.params;
    const sql = `SELECT * FROM publishers a join content_publishers ta
    on a.publisher_id = ta.publisher_id WHERE content_id = ?`;
    pool.query(sql, taskId, (err, rows) => {
      if (err) {
        console.log(rows, taskId);
        console.error(err);
        return res.status(500).send("Error fetching publishers");
      }

      return res.json(rows);
    });
  });

  /**
   * POST /api/content/:contentId/publishers
   * Add publisher to content
   */
  router.post("/api/content/:contentId/publishers", async (req, res) => {
    const contentId = req.body.contentId;
    const publisher = req.body.publisher; // Expect a single publisher object

    const sql = `CALL InsertOrGetPublisher(?, NULL, NULL, @publisherId)`;

    try {
      const result = await query(sql, [publisher.name]);
      const publisherId = result[0][0].publisherId;

      if (publisherId) {
        const insertTaskPublisher = `INSERT IGNORE INTO content_publishers (content_id, publisher_id) VALUES (?, ?)`;
        await pool.query(insertTaskPublisher, [contentId, publisherId]);
      }
      res.status(200).send("Publisher added successfully");
    } catch (error) {
      console.error("Error inserting publisher:", error);
      res.status(500).send("Error adding publisher");
    }
  });

  /**
   * PUT /api/publishers/:publisherId/bio
   * Update publisher bio/description
   */
  router.put("/api/publishers/:publisherId/bio", async (req, res) => {
    const { publisherId } = req.params;
    const { description } = req.body;

    try {
      await query(
        `UPDATE publishers SET description = ? WHERE publisher_id = ?`,
        [description, publisherId]
      );
      res.send({ success: true });
    } catch (err) {
      console.error("Failed to update publisher bio:", err);
      res.status(500).send({ success: false });
    }
  });

  /**
   * GET /api/publishers/:publisherId/ratings (VIEWER-AWARE)
   * Get all ratings for a publisher filtered by viewer context
   */
  router.get("/api/publishers/:publisherId/ratings", async (req, res) => {
    const { publisherId } = req.params;
    const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;
    const currentUserId = req.user?.user_id || viewerId;

    const sql = `
      SELECT pr.*, t.topic_name
      FROM publisher_ratings pr
      JOIN topics t ON pr.topic_id = t.topic_id
      WHERE pr.publisher_id = ?
        AND (? IS NULL OR pr.user_id = ?)
    `;

    try {
      const userIdForRatings = viewerId !== null ? viewerId : currentUserId;
      const rows = await query(sql, [publisherId, userIdForRatings, userIdForRatings]);

      res.send(rows);
    } catch (err) {
      console.error("❌ Error fetching publisher ratings:", err);
      res.status(500).send({ success: false });
    }
  });

  /**
   * GET /api/publishers/ratings-topics
   * Get all topics in publisher ratings
   */
  router.get("/api/publishers/ratings-topics", async (req, res) => {
    try {
      const rows = await query(
        `SELECT DISTINCT t.topic_id, t.topic_name
         FROM publisher_ratings pr
         JOIN topics t ON pr.topic_id = t.topic_id`
      );
      res.send(rows);
    } catch (err) {
      console.error("Error fetching publisher rating topics:", err);
      res.status(500).send({ success: false });
    }
  });

  /**
   * PUT /api/publishers/:publisherId/ratings
   * Update publisher ratings (bulk replacement) - includes user_id
   */
  router.put("/api/publishers/:publisherId/ratings", async (req, res) => {
    const { publisherId } = req.params;
    const { ratings } = req.body;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    try {
      // Delete only this user's ratings for this publisher
      await new Promise((resolve, reject) => {
        connection.query(
          "DELETE FROM publisher_ratings WHERE publisher_id = ? AND user_id = ?",
          [publisherId, userId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      for (const r of ratings) {
        await new Promise((resolve, reject) => {
          connection.query(
            `INSERT INTO publisher_ratings (publisher_id, user_id, topic_id, source, score, url, last_checked, bias_score, veracity_score)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
            [
              publisherId,
              userId,
              r.topic_id,
              r.source || null,
              r.score || null,
              r.url || null,
              r.bias_score,
              r.veracity_score,
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }

      connection.release();
      res.send({ success: true });
    } catch (err) {
      console.error(err);
      connection.release();
      res.status(500).send({ success: false });
    }
  });

  /**
   * PUT /api/publishers/:publisherRatingId/rating
   * Update a single publisher rating (user can only update their own)
   */
  router.put("/api/publishers/:publisherRatingId/rating", async (req, res) => {
    const { publisherRatingId } = req.params;
    const { topic_id, source, url, bias_score, veracity_score, notes } =
      req.body.rating;
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      // Verify ownership before updating
      const [existing] = await query(
        `SELECT user_id FROM publisher_ratings WHERE publisher_rating_id = ?`,
        [publisherRatingId]
      );

      if (!existing || existing.user_id !== userId) {
        return res.status(403).json({ error: "Cannot update another user's rating" });
      }

      await query(
        `UPDATE publisher_ratings
         SET topic_id = ?, source = ?, url = ?, bias_score = ?, veracity_score = ?, notes = ?, last_checked = NOW()
         WHERE publisher_rating_id = ?`,
        [
          topic_id,
          source,
          url,
          bias_score,
          veracity_score,
          notes || null,
          publisherRatingId,
        ]
      );

      res.send({ success: true });
    } catch (err) {
      console.error("Error updating publisher rating:", err);
      res.status(500).send({ success: false });
    }
  });

  return router;
}
