// /backend/src/routes/credibility/credibility.routes.js
import { Router } from "express";
import { authenticateToken } from "../../middleware/auth.js";
import { credibilityService } from "../../services/external/index.js";

export default function createCredibilityRoutes({ query, pool }) {
  const router = Router();

  /**
   * POST /api/credibility/author/:authorId/check
   * Check an author's credibility using OpenSanctions
   */
  router.post("/api/credibility/author/:authorId/check", authenticateToken, async (req, res) => {
    const { authorId } = req.params;

    try {
      // Get author details
      const authorResult = await query(
        "SELECT * FROM authors WHERE author_id = ?",
        [authorId]
      );

      if (!authorResult || authorResult.length === 0) {
        return res.status(404).json({ error: "Author not found" });
      }

      const author = authorResult[0];

      // Run credibility check
      const result = await credibilityService.checkAuthor(author, authorId);

      // Store results in database
      if (result.services.opensanctions && !result.services.opensanctions.error) {
        const osData = result.services.opensanctions;
        await query(`
          INSERT INTO author_credibility_checks
          (author_id, source, risk_level, has_matches, match_count, highest_score, risk_reasons, matches, raw_response)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          authorId,
          'opensanctions',
          osData.risk_level || 'unknown',
          osData.has_matches || false,
          osData.match_count || 0,
          osData.highest_score || null,
          JSON.stringify(osData.risk_reasons || []),
          JSON.stringify(osData.matches || []),
          JSON.stringify(osData.raw_data || {})
        ]);
      }

      res.json(result);
    } catch (error) {
      console.error("Error checking author credibility:", error);
      res.status(500).json({ error: "Failed to check author credibility" });
    }
  });

  /**
   * POST /api/credibility/publisher/:publisherId/check
   * Check a publisher's credibility using GDI and OpenSanctions
   */
  router.post("/api/credibility/publisher/:publisherId/check", authenticateToken, async (req, res) => {
    const { publisherId } = req.params;

    try {
      // Get publisher details
      const publisherResult = await query(
        "SELECT * FROM publishers WHERE publisher_id = ?",
        [publisherId]
      );

      if (!publisherResult || publisherResult.length === 0) {
        return res.status(404).json({ error: "Publisher not found" });
      }

      const publisher = publisherResult[0];

      // Run credibility check
      const result = await credibilityService.checkPublisher(publisher, publisherId);

      // Store GDI results
      if (result.services.gdi && !result.services.gdi.error) {
        const gdiData = result.services.gdi;
        await query(`
          INSERT INTO publisher_credibility_checks
          (publisher_id, source, risk_level, score, categories, flags, risk_reasons, raw_response)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          publisherId,
          'gdi',
          gdiData.risk_level || 'unknown',
          gdiData.score || null,
          JSON.stringify(gdiData.categories || []),
          JSON.stringify(gdiData.flags || []),
          JSON.stringify(['GDI score: ' + (gdiData.score || 'N/A')]),
          JSON.stringify(gdiData.raw_data || {})
        ]);
      }

      // Store OpenSanctions results
      if (result.services.opensanctions && !result.services.opensanctions.error) {
        const osData = result.services.opensanctions;
        await query(`
          INSERT INTO publisher_credibility_checks
          (publisher_id, source, risk_level, has_matches, match_count, highest_score, risk_reasons, matches, raw_response)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          publisherId,
          'opensanctions',
          osData.risk_level || 'unknown',
          osData.has_matches || false,
          osData.match_count || 0,
          osData.highest_score || null,
          JSON.stringify(osData.risk_reasons || []),
          JSON.stringify(osData.matches || []),
          JSON.stringify(osData.raw_data || {})
        ]);
      }

      res.json(result);
    } catch (error) {
      console.error("Error checking publisher credibility:", error);
      res.status(500).json({ error: "Failed to check publisher credibility" });
    }
  });

  /**
   * POST /api/credibility/content/:contentId/check
   * Check content URL credibility using GDI
   */
  router.post("/api/credibility/content/:contentId/check", authenticateToken, async (req, res) => {
    const { contentId } = req.params;

    try {
      // Get content details
      const contentResult = await query(
        "SELECT * FROM content WHERE content_id = ?",
        [contentId]
      );

      if (!contentResult || contentResult.length === 0) {
        return res.status(404).json({ error: "Content not found" });
      }

      const content = contentResult[0];

      if (!content.url) {
        return res.status(400).json({ error: "Content URL not available" });
      }

      // Run credibility check
      const result = await credibilityService.checkContent(content.url, contentId);

      // Store results
      if (result.services.gdi && !result.services.gdi.error) {
        const gdiData = result.services.gdi;
        await query(`
          INSERT INTO content_credibility_checks
          (content_id, source, url, risk_level, score, categories, flags, risk_reasons, raw_response)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          contentId,
          'gdi',
          content.url,
          gdiData.risk_level || 'unknown',
          gdiData.score || null,
          JSON.stringify(gdiData.categories || []),
          JSON.stringify(gdiData.flags || []),
          JSON.stringify(['GDI score: ' + (gdiData.score || 'N/A')]),
          JSON.stringify(gdiData.raw_data || {})
        ]);
      }

      res.json(result);
    } catch (error) {
      console.error("Error checking content credibility:", error);
      res.status(500).json({ error: "Failed to check content credibility" });
    }
  });

  /**
   * GET /api/credibility/author/:authorId/history
   * Get credibility check history for an author
   */
  router.get("/api/credibility/author/:authorId/history", authenticateToken, async (req, res) => {
    const { authorId } = req.params;

    try {
      const results = await query(
        `SELECT * FROM author_credibility_checks
         WHERE author_id = ?
         ORDER BY checked_at DESC`,
        [authorId]
      );

      res.json(results);
    } catch (error) {
      console.error("Error fetching author credibility history:", error);
      res.status(500).json({ error: "Failed to fetch credibility history" });
    }
  });

  /**
   * GET /api/credibility/publisher/:publisherId/history
   * Get credibility check history for a publisher
   */
  router.get("/api/credibility/publisher/:publisherId/history", authenticateToken, async (req, res) => {
    const { publisherId } = req.params;

    try {
      const results = await query(
        `SELECT * FROM publisher_credibility_checks
         WHERE publisher_id = ?
         ORDER BY checked_at DESC`,
        [publisherId]
      );

      res.json(results);
    } catch (error) {
      console.error("Error fetching publisher credibility history:", error);
      res.status(500).json({ error: "Failed to fetch credibility history" });
    }
  });

  /**
   * GET /api/credibility/content/:contentId/history
   * Get credibility check history for content
   */
  router.get("/api/credibility/content/:contentId/history", authenticateToken, async (req, res) => {
    const { contentId } = req.params;

    try {
      const results = await query(
        `SELECT * FROM content_credibility_checks
         WHERE content_id = ?
         ORDER BY checked_at DESC`,
        [contentId]
      );

      res.json(results);
    } catch (error) {
      console.error("Error fetching content credibility history:", error);
      res.status(500).json({ error: "Failed to fetch credibility history" });
    }
  });

  /**
   * GET /api/credibility/summary/authors
   * Get credibility summary for all authors with high/critical risk
   */
  router.get("/api/credibility/summary/authors", authenticateToken, async (req, res) => {
    try {
      const results = await query(
        `SELECT * FROM author_credibility_summary
         WHERE overall_risk_score >= 2
         ORDER BY overall_risk_score DESC`
      );

      res.json(results);
    } catch (error) {
      console.error("Error fetching author credibility summary:", error);
      res.status(500).json({ error: "Failed to fetch credibility summary" });
    }
  });

  /**
   * GET /api/credibility/summary/publishers
   * Get credibility summary for all publishers with high/critical risk
   */
  router.get("/api/credibility/summary/publishers", authenticateToken, async (req, res) => {
    try {
      const results = await query(
        `SELECT * FROM publisher_credibility_summary
         WHERE overall_risk_score >= 2
         ORDER BY overall_risk_score DESC`
      );

      res.json(results);
    } catch (error) {
      console.error("Error fetching publisher credibility summary:", error);
      res.status(500).json({ error: "Failed to fetch credibility summary" });
    }
  });

  /**
   * GET /api/credibility/service-status
   * Get status of configured credibility services
   */
  router.get("/api/credibility/service-status", authenticateToken, async (req, res) => {
    try {
      const status = credibilityService.getServiceStatus();
      res.json(status);
    } catch (error) {
      console.error("Error getting service status:", error);
      res.status(500).json({ error: "Failed to get service status" });
    }
  });

  /**
   * POST /api/credibility/batch/authors
   * Batch check multiple authors
   */
  router.post("/api/credibility/batch/authors", authenticateToken, async (req, res) => {
    const { authorIds } = req.body;

    if (!Array.isArray(authorIds) || authorIds.length === 0) {
      return res.status(400).json({ error: "authorIds array is required" });
    }

    try {
      // Get all authors
      const placeholders = authorIds.map(() => '?').join(',');
      const authors = await query(
        `SELECT * FROM authors WHERE author_id IN (${placeholders})`,
        authorIds
      );

      // Run batch check
      const results = await credibilityService.batchCheckAuthors(authors);

      res.json(results);
    } catch (error) {
      console.error("Error batch checking authors:", error);
      res.status(500).json({ error: "Failed to batch check authors" });
    }
  });

  /**
   * POST /api/credibility/batch/publishers
   * Batch check multiple publishers
   */
  router.post("/api/credibility/batch/publishers", authenticateToken, async (req, res) => {
    const { publisherIds } = req.body;

    if (!Array.isArray(publisherIds) || publisherIds.length === 0) {
      return res.status(400).json({ error: "publisherIds array is required" });
    }

    try {
      // Get all publishers
      const placeholders = publisherIds.map(() => '?').join(',');
      const publishers = await query(
        `SELECT * FROM publishers WHERE publisher_id IN (${placeholders})`,
        publisherIds
      );

      // Run batch check
      const results = await credibilityService.batchCheckPublishers(publishers);

      res.json(results);
    } catch (error) {
      console.error("Error batch checking publishers:", error);
      res.status(500).json({ error: "Failed to batch check publishers" });
    }
  });

  return router;
}
