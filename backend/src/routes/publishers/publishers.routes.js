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
   * DELETE /api/content/:contentId/publishers/:publisherId
   * Remove publisher from content
   */
  router.delete("/api/content/:contentId/publishers/:publisherId", async (req, res) => {
    const { contentId, publisherId } = req.params;

    try {
      const sql = `DELETE FROM content_publishers WHERE content_id = ? AND publisher_id = ?`;
      await query(sql, [contentId, publisherId]);
      res.status(200).send("Publisher removed successfully");
    } catch (error) {
      console.error("Error removing publisher:", error);
      res.status(500).send("Error removing publisher");
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
    const currentUserId = req.user?.user_id || viewerId || null;
    const userIdForRatings = viewerId !== null ? viewerId : currentUserId;

    // LEFT JOIN so enrichment rows (topic_id IS NULL) are included.
    // Always return system enrichment rows (user_id IS NULL) plus the
    // requesting user's own rows.
    const sql = `
      SELECT pr.*, t.topic_name
      FROM publisher_ratings pr
      LEFT JOIN topics t ON pr.topic_id = t.topic_id
      WHERE pr.publisher_id = ?
        AND (pr.user_id IS NULL OR pr.user_id = ?)
      ORDER BY pr.user_id IS NULL DESC, pr.last_checked DESC
    `;

    try {
      const rows = await query(sql, [publisherId, userIdForRatings]);
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

  /**
   * GET /api/publishers/:publisherId/enrichment
   * Returns system-generated ratings (AllSides, Ad Fontes) and profiles (Wikipedia)
   * for a publisher.  Shape:
   *   { publisher: {...}, ratings: [...], profiles: [...] }
   */
  router.get("/api/publishers/:publisherId/enrichment", async (req, res) => {
    const { publisherId } = req.params;

    try {
      const [[publisher], ratings, profiles] = await Promise.all([
        query(
          `SELECT publisher_id, publisher_name, domain, publisher_icon, description
           FROM publishers WHERE publisher_id = ? LIMIT 1`,
          [publisherId]
        ),
        query(
          `SELECT publisher_rating_id, source, rating_label, rating_type,
                  bias_score, veracity_score, score, url, last_checked,
                  notes, confidence, extraction_method, evidence_quote
           FROM publisher_ratings
           WHERE publisher_id = ? AND user_id IS NULL
           ORDER BY last_checked DESC`,
          [publisherId]
        ),
        query(
          `SELECT publisher_profile_id, source, profile_url, description,
                  ownership_notes, funding_notes, credibility_notes, political_notes,
                  source_type, country, evidence_quote, confidence,
                  extraction_method, last_checked
           FROM publisher_profiles
           WHERE publisher_id = ?
           ORDER BY last_checked DESC`,
          [publisherId]
        ),
      ]);

      if (!publisher) {
        return res.status(404).json({ error: "Publisher not found" });
      }

      res.json({ publisher, ratings, profiles });
    } catch (err) {
      console.error("Error fetching publisher enrichment:", err);
      res.status(500).json({ error: "Failed to fetch publisher enrichment" });
    }
  });

  /**
   * POST /api/publishers/:publisherId/enrich
   * Trigger on-demand enrichment for a single publisher (admin/debug use).
   * Body: { force?: boolean }
   */
  router.post("/api/publishers/:publisherId/enrich", async (req, res) => {
    const { publisherId } = req.params;
    const { force = false } = req.body;

    try {
      const [publisher] = await query(
        `SELECT publisher_id, publisher_name, domain FROM publishers WHERE publisher_id = ? LIMIT 1`,
        [publisherId]
      );

      if (!publisher) {
        return res.status(404).json({ error: "Publisher not found" });
      }

      const { enrichPublisherIfNeeded } = await import(
        "../../services/publisherEnrichmentService.js"
      );

      const result = await enrichPublisherIfNeeded({
        query,
        publisherId: publisher.publisher_id,
        publisherName: publisher.publisher_name,
        domain: publisher.domain || null,
        force,
        context: "case_content",
      });

      res.json({ success: true, result });
    } catch (err) {
      console.error("Error triggering publisher enrichment:", err);
      res.status(500).json({ error: "Enrichment failed" });
    }
  });

  return router;
}
