// backend/src/routes/content/content.lookup.routes.js
// ──────────────────────────────────────────────────────────────────
// PASSIVE LOOKUP ROUTES
// - Hash-based lookup for cached/indexed content
// - NO analysis triggered
// - NO URL logging to database
// ──────────────────────────────────────────────────────────────────
import { Router } from "express";
import logger from "../../utils/logger.js";

export default function createContentLookupRoutes({ query, redisClient }) {
  const router = Router();

  /**
   * POST /api/lookup-by-hash
   * Passive lookup by URL hash - does NOT trigger analysis
   * Returns cached result if available
   */
  router.post("/api/lookup-by-hash", async (req, res) => {
    try {
      const { urlHash } = req.body;

      if (!urlHash || typeof urlHash !== 'string') {
        return res.status(400).json({ error: "Missing or invalid urlHash" });
      }

      // Step 1: Check Redis cache (if available)
      if (redisClient) {
        try {
          const cacheKey = `lookup:${urlHash}`;
          const cached = await redisClient.get(cacheKey);

          if (cached) {
            const data = JSON.parse(cached);
            logger.log(`[Lookup] Redis cache HIT for hash ${urlHash.substring(0, 8)}...`);
            return res.json(data);
          }
        } catch (redisErr) {
          logger.error('[Lookup] Redis error (continuing with DB):', redisErr);
        }
      }

      // Step 2: Query database by hash
      const rows = await query(
        `SELECT
          c.content_id,
          c.content_name,
          c.canonical_url,
          c.progress,
          c.verimeter_score
        FROM content c
        WHERE c.canonical_url_hash = ?
        LIMIT 1`,
        [urlHash]
      );

      let responseData;

      if (rows.length > 0) {
        const content = rows[0];
        const isRated = content.verimeter_score != null;

        responseData = {
          exists: true,
          contentId: content.content_id,
          verimeterScore: content.verimeter_score,
          isRated,
          task: {
            content_id: content.content_id,
            content_name: content.content_name,
            canonical_url: content.canonical_url,
            progress: content.progress,
            verimeter_score: content.verimeter_score,
          }
        };

        logger.log(`[Lookup] DB hit for hash ${urlHash.substring(0, 8)}... → content_id ${content.content_id} (${isRated ? 'rated' : 'unrated'})`);
      } else {
        responseData = {
          exists: false
        };

        logger.log(`[Lookup] DB miss for hash ${urlHash.substring(0, 8)}...`);
      }

      // Step 3: Cache in Redis if available
      if (redisClient) {
        try {
          const cacheKey = `lookup:${urlHash}`;

          // TTL based on result type
          let ttl;
          if (responseData.exists && responseData.isRated) {
            ttl = 24 * 60 * 60; // 24 hours for rated content
          } else if (responseData.exists) {
            ttl = 6 * 60 * 60; // 6 hours for unrated content
          } else {
            ttl = 60 * 60; // 1 hour for unknown URLs
          }

          await redisClient.setEx(cacheKey, ttl, JSON.stringify(responseData));
        } catch (redisErr) {
          logger.error('[Lookup] Redis cache write error:', redisErr);
        }
      }

      return res.json(responseData);

    } catch (err) {
      logger.error('[Lookup] Error in lookup-by-hash:', err);
      return res.status(500).json({ error: "Lookup failed" });
    }
  });

  return router;
}
