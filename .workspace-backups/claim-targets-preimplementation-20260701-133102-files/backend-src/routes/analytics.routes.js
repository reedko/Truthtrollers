import express from "express";

export default function createAnalyticsRouter({ query, pool }) {
  const router = express.Router();

  /**
   * POST /api/track-visit
   * Tracks visitor analytics to the landing page
   */
  router.post("/api/track-visit", async (req, res) => {
    try {
      const { page, referrer, userAgent, screenResolution, language } = req.body;

      // Get IP address (accounting for proxies)
      const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] ||
                        req.socket.remoteAddress ||
                        'unknown';

      // Insert visit record into database
      await query(
        `INSERT INTO page_visits
         (page, referrer, user_agent, screen_resolution, language, ip_address, visited_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [page, referrer, userAgent, screenResolution, language, ipAddress]
      );

      console.log(`📊 Visit tracked: ${page} from ${referrer || 'direct'} (IP: ${ipAddress})`);

      res.json({ success: true, message: "Visit tracked" });
    } catch (error) {
      console.error("Error tracking visit:", error);
      // Don't fail the request if tracking fails
      res.json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/analytics/visits
   * Get visit statistics (protected route - could add auth middleware)
   */
  router.get("/api/analytics/visits", async (req, res) => {
    try {
      const { startDate, endDate, page } = req.query;

      let sql = `
        SELECT
          DATE(visited_at) as date,
          COUNT(*) as visits,
          COUNT(DISTINCT ip_address) as unique_visitors,
          page,
          COUNT(CASE WHEN referrer = 'direct' OR referrer = '' THEN 1 END) as direct_visits,
          COUNT(CASE WHEN referrer != 'direct' AND referrer != '' THEN 1 END) as referral_visits
        FROM page_visits
        WHERE 1=1
      `;

      const params = [];

      if (startDate) {
        sql += ` AND visited_at >= ?`;
        params.push(startDate);
      }

      if (endDate) {
        sql += ` AND visited_at <= ?`;
        params.push(endDate);
      }

      if (page) {
        sql += ` AND page = ?`;
        params.push(page);
      }

      sql += ` GROUP BY DATE(visited_at), page ORDER BY date DESC`;

      const [results] = await query(sql, params);

      res.json({ success: true, data: results });
    } catch (error) {
      console.error("Error fetching analytics:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/analytics/summary
   * Get overall visit summary
   */
  router.get("/api/analytics/summary", async (req, res) => {
    try {
      const [results] = await query(`
        SELECT
          COUNT(*) as total_visits,
          COUNT(DISTINCT ip_address) as unique_visitors,
          COUNT(DISTINCT DATE(visited_at)) as days_tracked,
          MIN(visited_at) as first_visit,
          MAX(visited_at) as last_visit
        FROM page_visits
      `);

      const [pageBreakdown] = await query(`
        SELECT
          page,
          COUNT(*) as visits,
          COUNT(DISTINCT ip_address) as unique_visitors
        FROM page_visits
        GROUP BY page
        ORDER BY visits DESC
      `);

      res.json({
        success: true,
        summary: results[0],
        pageBreakdown
      });
    } catch (error) {
      console.error("Error fetching analytics summary:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
