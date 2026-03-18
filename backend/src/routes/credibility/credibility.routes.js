// /backend/src/routes/credibility/credibility.routes.js
import { Router } from "express";
import { authenticateToken } from "../../middleware/auth.js";
import { credibilityService } from "../../services/external/index.js";
import courtListenerService from "../../services/external/courtlistener.service.js";

export default function createCredibilityRoutes({ query, pool }) {
  const router = Router();

  /**
   * POST /api/credibility/author/:authorId/check
   * Check an author's credibility using OpenSanctions
   */
  router.post("/api/credibility/author/:authorId/check", authenticateToken, async (req, res) => {
    const { authorId } = req.params;
    const { force = false } = req.body; // Allow forcing fresh check

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

      // Check cache first (unless force refresh requested)
      if (!force) {
        const cacheResult = await query(`
          SELECT * FROM author_credibility_checks
          WHERE author_id = ?
          AND checked_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
          ORDER BY checked_at DESC
        `, [authorId]);

        if (cacheResult && cacheResult.length > 0) {
          console.log(`✅ [Credibility] Using cached results for author ${authorId}`);

          // Reconstruct result from cache
          const cachedResult = {
            author_id: authorId,
            checked_at: cacheResult[0].checked_at,
            cached: true,
            services: {}
          };

          // Group by source
          for (const row of cacheResult) {
            if (row.source === 'opensanctions') {
              cachedResult.services.opensanctions = {
                source: 'opensanctions',
                risk_level: row.risk_level,
                has_matches: row.has_matches,
                match_count: row.match_count,
                highest_score: row.highest_score,
                risk_reasons: JSON.parse(row.risk_reasons || '[]'),
                matches: JSON.parse(row.matches || '[]')
              };
            } else if (row.source === 'courtlistener') {
              const cases = JSON.parse(row.matches || '[]');
              console.log(`📋 [Cache] CourtListener for author ${authorId}:`, {
                has_matches: row.has_matches,
                match_count: row.match_count,
                matches_length: row.matches ? row.matches.length : 0,
                cases_count: cases.length,
                first_case_name: cases.length > 0 ? cases[0].case_name : null
              });
              cachedResult.services.courtlistener = {
                source: 'courtlistener',
                risk_level: row.risk_level,
                has_cases: row.has_matches,
                case_count: row.match_count,
                cases: cases,
                risk_reasons: JSON.parse(row.risk_reasons || '[]')
              };
            } else if (row.source === 'cfpb') {
              cachedResult.services.cfpb = {
                source: 'cfpb',
                risk_level: row.risk_level,
                has_complaints: row.has_matches,
                complaint_count: row.match_count,
                risk_reasons: JSON.parse(row.risk_reasons || '[]')
              };
            }
          }

          cachedResult.overall_risk = {
            level: Math.max(...Object.values(cachedResult.services).map(s =>
              ['none', 'low', 'medium', 'high', 'critical'].indexOf(s.risk_level || 'none')
            ))
          };

          return res.json(cachedResult);
        }
      }

      // Run fresh credibility check
      console.log(`🔄 [Credibility] Running fresh check for author ${authorId}`);
      const result = await credibilityService.checkAuthor(author, authorId);

      // Store results in database for caching
      const storePromises = [];

      // Store OpenSanctions results
      if (result.services.opensanctions && !result.services.opensanctions.error) {
        const osData = result.services.opensanctions;
        storePromises.push(query(`
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
        ]));
      }

      // Store CourtListener results
      if (result.services.courtlistener && !result.services.courtlistener.error) {
        const clData = result.services.courtlistener;
        storePromises.push(query(`
          INSERT INTO author_credibility_checks
          (author_id, source, risk_level, has_matches, match_count, highest_score, risk_reasons, matches, raw_response)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          authorId,
          'courtlistener',
          clData.risk_level || 'unknown',
          clData.has_cases || false,
          clData.case_count || 0,
          null,
          JSON.stringify(clData.risk_reasons || []),
          JSON.stringify(clData.cases || []),
          JSON.stringify({ entity_name: clData.entity_name, checked_at: clData.checked_at })
        ]));
      }

      // Store CFPB results
      if (result.services.cfpb && !result.services.cfpb.error) {
        const cfpbData = result.services.cfpb;
        storePromises.push(query(`
          INSERT INTO author_credibility_checks
          (author_id, source, risk_level, has_matches, match_count, highest_score, risk_reasons, matches, raw_response)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          authorId,
          'cfpb',
          cfpbData.risk_level || 'unknown',
          cfpbData.has_complaints || false,
          cfpbData.complaint_count || 0,
          null,
          JSON.stringify(cfpbData.risk_reasons || []),
          JSON.stringify(cfpbData.complaints || []),
          JSON.stringify({ entity_name: cfpbData.entity_name, checked_at: cfpbData.checked_at })
        ]));
      }

      // Wait for all stores to complete
      await Promise.all(storePromises);

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
    const { force = false } = req.body; // Allow forcing fresh check

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

      // Check cache first (unless force refresh requested)
      if (!force) {
        const cacheResult = await query(`
          SELECT * FROM publisher_credibility_checks
          WHERE publisher_id = ?
          AND checked_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
          ORDER BY checked_at DESC
        `, [publisherId]);

        if (cacheResult && cacheResult.length > 0) {
          console.log(`✅ [Credibility] Using cached results for publisher ${publisherId}`);

          // Reconstruct result from cache
          const cachedResult = {
            publisher_id: publisherId,
            checked_at: cacheResult[0].checked_at,
            cached: true,
            services: {}
          };

          // Group by source
          for (const row of cacheResult) {
            if (row.source === 'gdi') {
              cachedResult.services.gdi = {
                source: 'gdi',
                risk_level: row.risk_level,
                score: row.score,
                categories: JSON.parse(row.categories || '[]'),
                flags: JSON.parse(row.flags || '[]')
              };
            } else if (row.source === 'opensanctions') {
              cachedResult.services.opensanctions = {
                source: 'opensanctions',
                risk_level: row.risk_level,
                has_matches: row.has_matches,
                match_count: row.match_count,
                highest_score: row.highest_score,
                risk_reasons: JSON.parse(row.risk_reasons || '[]'),
                matches: JSON.parse(row.matches || '[]')
              };
            } else if (row.source === 'courtlistener') {
              const cases = JSON.parse(row.matches || '[]');
              console.log(`📋 [Cache] CourtListener for publisher ${publisherId}:`, {
                has_matches: row.has_matches,
                match_count: row.match_count,
                matches_length: row.matches ? row.matches.length : 0,
                cases_count: cases.length,
                first_case_name: cases.length > 0 ? cases[0].case_name : null
              });
              cachedResult.services.courtlistener = {
                source: 'courtlistener',
                risk_level: row.risk_level,
                has_cases: row.has_matches,
                case_count: row.match_count,
                cases: cases,
                risk_reasons: JSON.parse(row.risk_reasons || '[]')
              };
            } else if (row.source === 'cfpb') {
              cachedResult.services.cfpb = {
                source: 'cfpb',
                risk_level: row.risk_level,
                has_complaints: row.has_matches,
                complaint_count: row.match_count,
                complaints: JSON.parse(row.matches || '[]'),
                risk_reasons: JSON.parse(row.risk_reasons || '[]')
              };
            }
          }

          cachedResult.overall_risk = {
            level: Math.max(...Object.values(cachedResult.services).map(s =>
              ['none', 'low', 'medium', 'high', 'critical'].indexOf(s.risk_level || 'none')
            ))
          };

          return res.json(cachedResult);
        }
      }

      // Run fresh credibility check
      console.log(`🔄 [Credibility] Running fresh check for publisher ${publisherId}`);
      const result = await credibilityService.checkPublisher(publisher, publisherId);

      // Store results in database for caching
      const storePromises = [];

      // Store GDI results
      if (result.services.gdi && !result.services.gdi.error) {
        const gdiData = result.services.gdi;
        storePromises.push(query(`
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
        ]));
      }

      // Store OpenSanctions results
      if (result.services.opensanctions && !result.services.opensanctions.error) {
        const osData = result.services.opensanctions;
        storePromises.push(query(`
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
        ]));
      }

      // Store CourtListener results
      if (result.services.courtlistener && !result.services.courtlistener.error) {
        const clData = result.services.courtlistener;
        storePromises.push(query(`
          INSERT INTO publisher_credibility_checks
          (publisher_id, source, risk_level, has_matches, match_count, highest_score, risk_reasons, matches, raw_response)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          publisherId,
          'courtlistener',
          clData.risk_level || 'unknown',
          clData.has_cases || false,
          clData.case_count || 0,
          null,
          JSON.stringify(clData.risk_reasons || []),
          JSON.stringify(clData.cases || []),
          JSON.stringify({ entity_name: clData.entity_name, checked_at: clData.checked_at })
        ]));
      }

      // Store CFPB results
      if (result.services.cfpb && !result.services.cfpb.error) {
        const cfpbData = result.services.cfpb;
        storePromises.push(query(`
          INSERT INTO publisher_credibility_checks
          (publisher_id, source, risk_level, has_matches, match_count, highest_score, risk_reasons, matches, raw_response)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          publisherId,
          'cfpb',
          cfpbData.risk_level || 'unknown',
          cfpbData.has_complaints || false,
          cfpbData.complaint_count || 0,
          null,
          JSON.stringify(cfpbData.risk_reasons || []),
          JSON.stringify(cfpbData.complaints || []),
          JSON.stringify({ entity_name: cfpbData.entity_name, checked_at: cfpbData.checked_at })
        ]));
      }

      // Wait for all stores to complete
      await Promise.all(storePromises);

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
   * POST /api/credibility/check-custom-author
   * Check credibility for a custom author name (not in database)
   */
  router.post("/api/credibility/check-custom-author", authenticateToken, async (req, res) => {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    try {
      // Create a temporary author object
      const customAuthor = {
        author_first_name: name.split(' ')[0] || name,
        author_last_name: name.split(' ').slice(1).join(' ') || '',
        name: name
      };

      // Run credibility check without database storage
      const result = await credibilityService.checkAuthor(customAuthor, null);

      res.json(result);
    } catch (error) {
      console.error("Error checking custom author:", error);
      res.status(500).json({ error: "Failed to check custom author credibility" });
    }
  });

  /**
   * POST /api/credibility/check-custom-publisher
   * Check credibility for a custom publisher name (not in database)
   */
  router.post("/api/credibility/check-custom-publisher", authenticateToken, async (req, res) => {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    try {
      // Create a temporary publisher object
      const customPublisher = {
        publisher_name: name,
        name: name
      };

      // Run credibility check without database storage
      const result = await credibilityService.checkPublisher(customPublisher, null);

      res.json(result);
    } catch (error) {
      console.error("Error checking custom publisher:", error);
      res.status(500).json({ error: "Failed to check custom publisher credibility" });
    }
  });

  /**
   * GET /api/authors
   * Get all authors
   */
  router.get("/api/authors", authenticateToken, async (req, res) => {
    try {
      const authors = await query("SELECT * FROM authors ORDER BY author_last_name, author_first_name");
      res.json(authors);
    } catch (error) {
      console.error("Error fetching authors:", error);
      res.status(500).json({ error: "Failed to fetch authors" });
    }
  });

  /**
   * GET /api/publishers
   * Get all publishers
   */
  router.get("/api/publishers", authenticateToken, async (req, res) => {
    try {
      const publishers = await query("SELECT * FROM publishers ORDER BY publisher_name");
      res.json(publishers);
    } catch (error) {
      console.error("Error fetching publishers:", error);
      res.status(500).json({ error: "Failed to fetch publishers" });
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

  /**
   * POST /api/credibility/legal-case/details
   * Get detailed information about a legal case from CourtListener
   *
   * Body: { caseUrl: "https://www.courtlistener.com/..." }
   *
   * Returns readable case information including:
   * - For opinions: case summary, decision, who decided, opinion text
   * - For dockets: parties, complaint, verdict, judgment, all filings
   */
  router.post("/api/credibility/legal-case/details", authenticateToken, async (req, res) => {
    const { caseUrl } = req.body;

    if (!caseUrl) {
      return res.status(400).json({ error: "Missing caseUrl in request body" });
    }

    if (!caseUrl.includes('courtlistener.com')) {
      return res.status(400).json({ error: "URL must be from courtlistener.com" });
    }

    try {
      const details = await courtListenerService.getCaseDetails(caseUrl);

      if (details.error) {
        return res.status(500).json(details);
      }

      res.json(details);
    } catch (error) {
      console.error("Error fetching legal case details:", error);
      res.status(500).json({ error: "Failed to fetch case details" });
    }
  });

  return router;
}
