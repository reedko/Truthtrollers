// /backend/src/routes/authors/authors.routes.js
import { Router } from "express";
import { parseAuthorName } from "../../utils/parseAuthorName.js";

export default function createAuthorsRoutes({ query, pool }) {
  const router = Router();

  /**
   * GET /api/content/:taskId/authors
   * Get all authors for a specific content/task
   */
  router.get("/api/content/:taskId/authors", async (req, res) => {
    const { taskId } = req.params;
    const sql = `SELECT * FROM authors a join content_authors ta
    on a.author_id = ta.author_id WHERE content_id = ?`;
    pool.query(sql, taskId, (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error fetching authors");
      }

      return res.json(rows);
    });
  });

  /**
   * GET /api/content/:authorId/author
   * Get a single author by authorId
   */
  router.get("/api/content/:authorId/author", async (req, res) => {
    const { authorId } = req.params;
    const sql = `SELECT * FROM  authors
    WHERE author_id = ?`;
    pool.query(sql, authorId, (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error fetching authors");
      }

      return res.json(rows);
    });
  });

  /**
   * GET /api/content/:taskId/content_authors
   * Get content_authors junction table entries for a content
   */
  router.get("/api/content/:taskId/content_authors", async (req, res) => {
    const { taskId } = req.params;
    const sql = `SELECT * FROM  content_authors
    WHERE content_id = ?`;
    pool.query(sql, taskId, (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error fetching authors");
      }

      return res.json(rows);
    });
  });

  /**
   * POST /api/content/:contentId/authors
   * Add authors to content (parses names and creates author records)
   */
  router.post("/api/content/:contentId/authors", async (req, res) => {
    const contentId = req.body.contentId;
    const authors = req.body.authors; // Expect an array of authors

    const sql = `CALL InsertOrGetAuthor(?, ?, ?, ?, ?,?,?,?, @authorId)`;

    try {
      for (const author of authors) {
        const parsed = parseAuthorName(author.name);

        const result = await query(sql, [
          parsed.first_name,
          parsed.middle_name,
          parsed.last_name,
          parsed.suffix,
          parsed.title,
          parsed.display_name,
          author.description,
          author.image,
        ]);
        const authorId = result[0][0].authorId;

        if (authorId) {
          const insertTaskAuthor = `INSERT INTO content_authors (content_id, author_id) VALUES (?, ?)`;
          await pool.query(insertTaskAuthor, [contentId, authorId]);
        }
      }
      res.status(200).send("Authors added successfully");
    } catch (error) {
      console.error("Error inserting authors:", error);
      res.status(500).send("Error adding authors");
    }
  });

  /**
   * DELETE /api/content/:contentId/authors/:authorId
   * Remove an author from content (delete from content_authors junction table)
   */
  router.delete("/api/content/:contentId/authors/:authorId", async (req, res) => {
    const { contentId, authorId } = req.params;

    try {
      await query(
        `DELETE FROM content_authors WHERE content_id = ? AND author_id = ?`,
        [contentId, authorId]
      );
      res.status(200).json({ success: true, message: "Author removed from content" });
    } catch (error) {
      console.error("Error removing author from content:", error);
      res.status(500).json({ success: false, message: "Error removing author" });
    }
  });

  /**
   * PUT /api/authors/:authorId/bio
   * Update author bio/description
   */
  router.put("/api/authors/:authorId/bio", async (req, res) => {
    const { authorId } = req.params;
    const { description } = req.body;

    try {
      await query(`UPDATE authors SET description = ? WHERE author_id = ?`, [
        description,
        authorId,
      ]);
      res.send({ success: true });
    } catch (err) {
      console.error("Failed to update author bio:", err);
      res.status(500).send({ success: false });
    }
  });

  /**
   * GET /api/authors/:authorId/ratings
   * Get all ratings for an author
   */
  router.get("/api/authors/:authorId/ratings", async (req, res) => {
    const { authorId } = req.params;
    try {
      const rows = await query(
        `SELECT ar.*, t.topic_name
         FROM author_ratings ar
         JOIN topics t ON ar.topic_id = t.topic_id
         WHERE ar.author_id = ?`,
        [authorId]
      );
      res.send(rows);
    } catch (err) {
      console.error("Failed to fetch author ratings:", err);
      res.status(500).send({ success: false });
    }
  });

  /**
   * PUT /api/authors/:authorId/ratings
   * Update author ratings (bulk replacement)
   */
  router.put("/api/authors/:authorId/ratings", async (req, res) => {
    const { authorId } = req.params;
    const { ratings } = req.body;

    const connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    try {
      await new Promise((resolve, reject) => {
        connection.query("DELETE FROM author_ratings WHERE author_id = ?", [authorId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      for (const r of ratings) {
        await new Promise((resolve, reject) => {
          connection.query(
            `INSERT INTO author_ratings (author_id, topic_id, bias_score, veracity_score) VALUES (?, ?, ?, ?)`,
            [authorId, r.topic_id, r.bias_score, r.veracity_score],
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
   * PUT /api/authors/:authorRatingId/rating
   * Update a single author rating
   */
  router.put("/api/authors/:authorRatingId/rating", async (req, res) => {
    const { authorRatingId } = req.params;
    const { topic_id, source, url, bias_score, veracity_score, notes } =
      req.body.rating;

    try {
      await query(
        `UPDATE author_ratings
         SET topic_id = ?, source = ?, url = ?, bias_score = ?, veracity_score = ?, notes = ?, last_checked = NOW()
         WHERE author_rating_id = ?`,
        [
          topic_id,
          source,
          url,
          bias_score,
          veracity_score,
          notes || null,
          authorRatingId,
        ]
      );

      res.send({ success: true });
    } catch (err) {
      console.error("Error updating author rating:", err);
      res.status(500).send({ success: false });
    }
  });

  /**
   * POST /api/authors/add-rating
   * Add new author rating
   */
  router.post("/api/authors/add-rating", async (req, res) => {
    const { ratings } = req.body;

    if (!ratings || !ratings.author_id || !ratings.topic_id) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    try {
      const result = await query(
        `INSERT INTO author_ratings
          (author_id, topic_id, source, url, notes, bias_score, veracity_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          ratings.author_id,
          ratings.topic_id,
          ratings.source || null,
          ratings.url || null,
          ratings.notes || null,
          ratings.bias_score ?? 0,
          ratings.veracity_score ?? 0,
        ]
      );

      const newId = result.insertId;

      const [newRating] = await query(
        `SELECT ar.*, t.topic_name
         FROM author_ratings ar
         JOIN topics t ON ar.topic_id = t.topic_id
         WHERE ar.author_rating_id = ?`,
        [newId]
      );

      res.json(newRating);
    } catch (err) {
      console.error("Error inserting new author rating:", err);
      res.status(500).json({ success: false, message: "Database error" });
    }
  });

  return router;
}
