// /backend/src/routes/publishers/publishers.routes.js
import { Router } from "express";
import { resolveSourceIdentity } from "../../../services/sourceIdentityResolver.js";
import { resolveSourceLineage } from "../../../services/sourceLineageResolver.js";

// Reject localhost, loopback, and RFC-1918 URLs — these are dev-server or API
// self-references that should never be treated as article source URLs.
function sanitizeSourceUrl(raw) {
  if (!raw) return null;
  try {
    const { hostname } = new URL(raw);
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) return null;
    return raw;
  } catch {
    return null;
  }
}

// Build lightweight providerResults from already-fetched DB rows (no network calls).
// Used by auto-evaluation in GET enrichment so no extra latency on first display.
function buildProviderResultsFromDb(ratings, profiles) {
  const results = [];
  for (const r of ratings) {
    const src = (r.source ?? "").toLowerCase();
    if (src.includes("allsides")) {
      results.push({ providerName: "allsides", matchFound: true, status: "found",
        normalized: { biasLabel: r.rating_label, biasScore: r.bias_score } });
    } else if (src.includes("ad fontes") || src.includes("adfont")) {
      const score = r.veracity_score;
      const reliability = score == null ? null
        : score >= 60 ? "high" : score >= 40 ? "medium" : score >= 30 ? "mixed" : "low";
      results.push({ providerName: "adfontes", matchFound: true, status: "found",
        normalized: { reliability, veracityScore: score, biasScore: r.bias_score } });
    } else if (src.includes("mbfc") || src.includes("media bias")) {
      const score = r.veracity_score;
      const reliability = score == null ? null : score >= 60 ? "high" : score >= 40 ? "medium" : "low";
      results.push({ providerName: "mbfc", matchFound: true, status: "found",
        normalized: { reliability } });
    }
  }
  for (const p of profiles) {
    const src = (p.source ?? "").toLowerCase();
    if (src.includes("wikipedia"))
      results.push({ providerName: "wikipedia", matchFound: true, status: "found" });
    if (src.includes("wikidata"))
      results.push({ providerName: "wikidata", matchFound: true, status: "found" });
  }
  return results;
}

export default function createPublishersRoutes({ query, pool }) {
  const router = Router();

  /**
   * GET /api/source-identity?url=<encoded>&force=1
   * Resolve a source URL to a SourceIdentity object.
   * Used by SourceDetailModal and any UI that needs publisher/source metadata.
   */
  router.get("/api/source-identity", async (req, res) => {
    const { url, force } = req.query;
    if (!url) return res.status(400).json({ error: "url query param required" });
    const safeUrl = sanitizeSourceUrl(url);
    if (!safeUrl) return res.status(400).json({ error: "url must be a public external URL" });
    try {
      const identity = await resolveSourceIdentity(safeUrl, {
        query,
        force: force === "1" || force === "true",
      });
      res.json(identity);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/source-identity/debug-report
   * Returns counts for resolution states across source_identity_cache.
   */
  router.get("/api/source-identity/debug-report", async (req, res) => {
    try {
      const [total]     = await query(`SELECT COUNT(*) AS n FROM source_identity_cache`);
      const byLevel     = await query(
        `SELECT resolution_level, COUNT(*) AS n FROM source_identity_cache GROUP BY resolution_level ORDER BY resolution_level`
      );
      const byStatus    = await query(
        `SELECT resolution_status, COUNT(*) AS n FROM source_identity_cache GROUP BY resolution_status`
      );
      const byKind      = await query(
        `SELECT source_identity_kind, COUNT(*) AS n FROM source_identity_cache GROUP BY source_identity_kind`
      );
      const needsReview = await query(
        `SELECT COUNT(*) AS n FROM source_identity_cache WHERE needs_human_review = 1`
      );
      const withPublisher = await query(
        `SELECT COUNT(*) AS n FROM source_identity_cache WHERE publisher_id IS NOT NULL`
      );
      res.json({
        total:              total[0]?.n ?? 0,
        withPublisher:      withPublisher[0]?.n ?? 0,
        needsHumanReview:   needsReview[0]?.n ?? 0,
        byResolutionLevel:  byLevel,
        byResolutionStatus: byStatus,
        byKind,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/source-lineage?url=<encoded>&force=1
   * Detect whether a URL is an original article, excerpt, repost, pointer, archive, or syndication.
   * Follows the upstream chain up to 3 hops.
   */
  router.get("/api/source-lineage", async (req, res) => {
    const { url, force } = req.query;
    if (!url) return res.status(400).json({ error: "url query param required" });
    const safeUrl = sanitizeSourceUrl(url);
    if (!safeUrl) return res.status(400).json({ error: "url must be a public external URL" });
    try {
      const lineage = await resolveSourceLineage(safeUrl, {
        query,
        force: force === "1" || force === "true",
      });
      res.json(lineage);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/publishers/for-content/:contentId
   * Returns the most recently linked publisher for a content record.
   * Used by the modal after a scrape job completes to find what the extension stored.
   */
  router.get("/api/publishers/for-content/:contentId", async (req, res) => {
    const { contentId } = req.params;
    try {
      const rows = await query(
        `SELECT p.publisher_id, p.publisher_name
         FROM content_publishers cp
         JOIN publishers p ON cp.publisher_id = p.publisher_id
         WHERE cp.content_id = ?
         ORDER BY cp.content_publisher_id DESC
         LIMIT 1`,
        [contentId]
      );
      if (!rows.length) return res.json({ publisher_id: null, publisher_name: null });
      res.json({ publisher_id: rows[0].publisher_id, publisher_name: rows[0].publisher_name });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/source-identity/resolve-and-link
   * Re-resolve a source URL (force-refresh), then optionally link the result to a content record.
   * Used by SourceDetailModal "fetch & resolve" flow.
   * Body: { url: string, contentId?: number }
   * Returns: SourceIdentity object (with candidates + optional publisherId if matched in DB)
   */
  router.post("/api/source-identity/resolve-and-link", async (req, res) => {
    const { url, contentId } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });
    const safeUrl = sanitizeSourceUrl(url);
    if (!safeUrl) return res.status(400).json({ error: "url must be a public external URL" });
    try {
      const identity = await resolveSourceIdentity(safeUrl, { query, force: true });
      // If we matched a publisher and have a contentId, link them
      if (identity.publisherId && contentId) {
        await query(
          `INSERT IGNORE INTO content_publishers (content_id, publisher_id) VALUES (?, ?)`,
          [contentId, identity.publisherId]
        );
      }
      res.json(identity);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/publishers/enrich-and-link
   * Atomic: create/find publisher → run enrichment → link to content.
   * Body: { name: string, domain?: string, contentId?: number, sourceUrl?: string, force?: boolean }
   * Returns: { publisherId, publisherName, enrichResult }
   */
  router.post("/api/publishers/enrich-and-link", async (req, res) => {
    const { name, domain, contentId, force = false } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name required" });

    try {
      const sourceUrl = sanitizeSourceUrl(req.body.sourceUrl ?? null);

      // 1. Create or find publisher (owner/icon slots are NULL — domain used only for enrichment)
      const rows = await query(
        `CALL InsertOrGetPublisher(?, NULL, NULL, @publisherId)`,
        [name.trim()]
      );
      const publisherId = rows[0]?.[0]?.publisherId;
      if (!publisherId) {
        return res.status(500).json({ error: "InsertOrGetPublisher returned no ID" });
      }

      // 2. Replace any existing publisher link for this content (re-link replaces, not appends)
      if (contentId) {
        await query(`DELETE FROM content_publishers WHERE content_id = ?`, [contentId]);
        await query(`INSERT INTO content_publishers (content_id, publisher_id) VALUES (?, ?)`, [contentId, publisherId]);
      }

      // 3. Update source_identity_cache with the confirmed publisher name + real article URL
      if (sourceUrl) {
        resolveSourceIdentity(sourceUrl, { query, hintName: name.trim(), force: true }).catch(() => {});
      }

      // 4. Run enrichment (awaited — user wants results now)
      const { enrichPublisherIfNeeded } = await import("../../services/publisherEnrichmentService.js");
      const enrichResult = await enrichPublisherIfNeeded({
        query,
        publisherId,
        publisherName: name.trim(),
        domain: domain ?? null,
        sourceUrl: sourceUrl ?? null,
        force,
        context: "case_content",
      });

      // 5. Generate and persist admiralty code from whatever ratings/profiles now exist
      let admiraltyCode = null;
      const admiraltyUpdates = {};
      try {
        const { evaluateAdmiraltyCode, storeEvaluation } = await import("../../../services/admiraltyEvaluator.js");
        const [profileRows, ratingRows] = await Promise.all([
          query(`SELECT source, source_type FROM publisher_profiles WHERE publisher_id = ? ORDER BY last_checked DESC LIMIT 1`, [publisherId]),
          query(`SELECT source, rating_label, rating_type, bias_score, veracity_score, score, confidence FROM publisher_ratings WHERE publisher_id = ? AND user_id IS NULL ORDER BY last_checked DESC`, [publisherId]),
        ]);
        const evaluation = await evaluateAdmiraltyCode({
          publisherName: name.trim(),
          sourceIdentity: { sourceType: profileRows[0]?.source_type ?? null, resolutionLevel: ratingRows.length > 0 ? 5 : 3 },
          existingSourceRatings: ratingRows,
          providerResults: buildProviderResultsFromDb(ratingRows, profileRows),
        });
        if (evaluation.sourceReliabilityLetter && evaluation.sourceReliabilityLetter !== "Ø") {
          admiraltyCode = evaluation.admiraltyCode;
          await storeEvaluation(query, {
            targetType: "publisher", targetId: publisherId,
            sourceUrl: sourceUrl ?? null, publisherId,
            evaluation,
          });
          if (contentId) {
            await storeEvaluation(query, {
              targetType: "content", targetId: contentId,
              sourceUrl: sourceUrl ?? null, publisherId,
              evaluation,
            });
            admiraltyUpdates[contentId] = admiraltyCode;
          }
        }
      } catch (e) {
        console.error("[enrich-and-link] Admiralty evaluation failed:", e.message);
      }

      res.json({ publisherId, publisherName: name.trim(), enrichResult: { ...enrichResult, admiraltyCode, admiraltyUpdates } });
    } catch (err) {
      console.error("Error in enrich-and-link:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/content/:publisherId/publisher
   * Get a single publisher by publisherId
   */
  router.get("/api/content/:publisherId/publisher", async (req, res) => {
    const { publisherId } = req.params;
    const sql = `
      SELECT p.*,
        (SELECT ae.admiralty_code FROM admiralty_evaluations ae
         WHERE ae.target_type = 'publisher' AND ae.target_id = p.publisher_id
           AND ae.evaluation_status NOT IN ('insufficient_data')
         ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested'),
                  ae.updated_at DESC
         LIMIT 1) AS admiralty_code
      FROM publishers p
      WHERE p.publisher_id = ?`;
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
    try {
      const rows = await query(
        `SELECT a.*, ta.*,
          COALESCE(
            (SELECT ae.admiralty_code FROM admiralty_evaluations ae
             WHERE ae.target_type = 'content' AND ae.target_id = ta.content_id
               AND ae.evaluation_status NOT IN ('insufficient_data')
             ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested'),
                      ae.updated_at DESC
             LIMIT 1),
            (SELECT ae.admiralty_code FROM admiralty_evaluations ae
             WHERE ae.target_type = 'publisher' AND ae.target_id = a.publisher_id
               AND ae.evaluation_status NOT IN ('insufficient_data')
             ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested'),
                      ae.updated_at DESC
             LIMIT 1)
          ) AS admiralty_code
        FROM publishers a
        JOIN content_publishers ta ON a.publisher_id = ta.publisher_id
        WHERE ta.content_id = ?`,
        [taskId]
      );

      console.log(`[publishers/${taskId}] rows returned: ${rows.length}, codes: ${rows.map(r => r.publisher_name + ':' + r.admiralty_code).join(', ')}`);

      // Auto-evaluate any publisher missing a code but with existing ratings/profiles.
      const missing = rows.filter(r => !r.admiralty_code);
      console.log(`[publishers/${taskId}] missing codes: ${missing.map(r => r.publisher_name).join(', ') || 'none'}`);
      if (missing.length > 0) {
        try {
          const { evaluateAdmiraltyCode, storeEvaluation } = await import("../../../services/admiraltyEvaluator.js");
          await Promise.all(missing.map(async (pub) => {
            const [ratings, profiles] = await Promise.all([
              query(
                `SELECT source, rating_label, rating_type, bias_score, veracity_score, score, confidence
                 FROM publisher_ratings WHERE publisher_id = ? AND user_id IS NULL ORDER BY last_checked DESC`,
                [pub.publisher_id]
              ),
              query(
                `SELECT source, source_type FROM publisher_profiles WHERE publisher_id = ? ORDER BY last_checked DESC LIMIT 1`,
                [pub.publisher_id]
              ),
            ]);
            console.log(`[publishers/${taskId}] ${pub.publisher_name}: ratings=${ratings.length}, profiles=${profiles.length}, sourceType=${profiles[0]?.source_type}`);
            if (ratings.length === 0 && profiles.length === 0) return;
            const evaluation = await evaluateAdmiraltyCode({
              publisherName: pub.publisher_name,
              sourceIdentity: { sourceType: profiles[0]?.source_type ?? null, resolutionLevel: ratings.length > 0 ? 5 : 3 },
              existingSourceRatings: ratings,
              providerResults: buildProviderResultsFromDb(ratings, profiles),
            });
            console.log(`[publishers/${taskId}] ${pub.publisher_name}: evaluated → ${evaluation.admiraltyCode} (letter=${evaluation.sourceReliabilityLetter})`);
            if (evaluation.sourceReliabilityLetter && evaluation.sourceReliabilityLetter !== "Ø") {
              pub.admiralty_code = evaluation.admiraltyCode;
              await storeEvaluation(query, {
                targetType: "publisher", targetId: pub.publisher_id,
                sourceUrl: null, publisherId: pub.publisher_id,
                evaluation,
              });
              console.log(`[publishers/${taskId}] ${pub.publisher_name}: stored ${evaluation.admiraltyCode}`);
            }
          }));
        } catch (e) {
          console.error("[publishers list] Auto-admiralty failed:", e.message, e.stack);
        }
      }

      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).send("Error fetching publishers");
    }
  });

  /**
   * POST /api/content/:contentId/publishers
   * Add publisher to content
   */
  router.post("/api/content/:contentId/publishers", async (req, res) => {
    // contentId comes from the URL param (req.body.contentId was a bug — body may not have it)
    const contentId = req.params.contentId || req.body.contentId;
    const publisher = req.body.publisher; // Expect a single publisher object

    if (!contentId || !publisher?.name) {
      return res.status(400).json({ error: "contentId and publisher.name are required" });
    }

    try {
      const result = await query(`CALL InsertOrGetPublisher(?, NULL, NULL, @publisherId)`, [publisher.name]);
      const publisherId = result[0][0].publisherId;

      if (!publisherId) {
        return res.status(500).json({ error: "InsertOrGetPublisher returned no ID" });
      }

      await query(`INSERT IGNORE INTO content_publishers (content_id, publisher_id) VALUES (?, ?)`, [contentId, publisherId]);
      res.status(200).json({ publisherId, message: "Publisher linked successfully" });
    } catch (error) {
      console.error("Error inserting publisher:", error);
      res.status(500).json({ error: "Error adding publisher" });
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
      const [[publisher], ratings, profiles, [admRow]] = await Promise.all([
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
        query(
          `SELECT admiralty_code FROM admiralty_evaluations
           WHERE target_type = 'publisher' AND target_id = ?
             AND evaluation_status NOT IN ('insufficient_data')
           ORDER BY FIELD(evaluation_status,'human_confirmed','community_reviewed','machine_suggested'),
                    updated_at DESC
           LIMIT 1`,
          [publisherId]
        ),
      ]);

      if (!publisher) {
        return res.status(404).json({ error: "Publisher not found" });
      }

      // Auto-evaluate admiralty if no code stored yet but we have rating/profile data.
      // This means the SourceCrest shows a code the moment enrichment data exists —
      // no manual re-enrich required.
      let admiraltyCode = admRow?.admiralty_code ?? null;
      if (!admiraltyCode && (ratings.length > 0 || profiles.length > 0)) {
        try {
          const { evaluateAdmiraltyCode, storeEvaluation } = await import("../../../services/admiraltyEvaluator.js");
          const evaluation = await evaluateAdmiraltyCode({
            publisherName: publisher.publisher_name,
            sourceIdentity: {
              sourceType: profiles[0]?.source_type ?? null,
              resolutionLevel: ratings.length > 0 ? 5 : 3,
            },
            existingSourceRatings: ratings,
            providerResults: buildProviderResultsFromDb(ratings, profiles),
          });
          if (evaluation.sourceReliabilityLetter && evaluation.sourceReliabilityLetter !== "Ø") {
            await storeEvaluation(query, {
              targetType: "publisher", targetId: parseInt(publisherId),
              sourceUrl: null, publisherId: parseInt(publisherId),
              evaluation,
            });
            admiraltyCode = evaluation.admiraltyCode;
          }
        } catch (e) {
          console.error("[publishers/enrichment] Auto-admiralty failed:", e.message);
        }
      }

      res.json({ publisher, ratings, profiles, admiraltyCode });
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
    const { force = false, contentId = null, sourceUrl: reqSourceUrl = null } = req.body;

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

      const enrichResult = await enrichPublisherIfNeeded({
        query,
        publisherId: publisher.publisher_id,
        publisherName: publisher.publisher_name,
        domain: publisher.domain || null,
        force,
        context: "case_content",
      });

      // After enrichment, run admiralty evaluation and store it
      let admiraltyCode = null;
      const admiraltyUpdates = {};
      try {
        const { evaluateAdmiraltyCode, storeEvaluation } = await import("../../../services/admiraltyEvaluator.js");
        const { lookupPublisherAllProviders } = await import("../../../services/sourceProviders/sourceProviderRegistry.js");

        // Resolve source URL from request or from the content row
        let sourceUrl = reqSourceUrl;
        if (!sourceUrl && contentId) {
          const [contentRow] = await query(`SELECT url FROM content WHERE content_id = ? LIMIT 1`, [contentId]);
          sourceUrl = contentRow?.url || null;
        }

        const [profileRows, ratingRows] = await Promise.all([
          query(`SELECT source_type FROM publisher_profiles WHERE publisher_id = ? ORDER BY last_checked DESC LIMIT 1`, [publisher.publisher_id]),
          query(`SELECT source, rating_label, rating_type, bias_score, veracity_score, score, confidence FROM publisher_ratings WHERE publisher_id = ? AND user_id IS NULL ORDER BY last_checked DESC`, [publisher.publisher_id]),
        ]);

        const providerResults = await lookupPublisherAllProviders({
          sourceUrl: sourceUrl || undefined,
          publisherName: publisher.publisher_name,
        });

        const evaluation = await evaluateAdmiraltyCode({
          sourceUrl: sourceUrl || undefined,
          publisherName: publisher.publisher_name,
          sourceIdentity: { sourceType: profileRows[0]?.source_type || undefined, resolutionLevel: 3 },
          existingSourceRatings: ratingRows,
          providerResults,
        });

        admiraltyCode = evaluation.admiraltyCode;

        // Store at publisher level — cascades to all content on next lookup via COALESCE fallback
        await storeEvaluation(query, {
          targetType: "publisher", targetId: publisher.publisher_id,
          sourceUrl: sourceUrl || null, publisherId: publisher.publisher_id,
          evaluation,
        });

        // Also store at content level for the specific content being viewed right now
        if (contentId) {
          await storeEvaluation(query, {
            targetType: "content", targetId: contentId,
            sourceUrl: sourceUrl || null, publisherId: publisher.publisher_id,
            evaluation,
          });
          admiraltyUpdates[contentId] = admiraltyCode;
        }
      } catch (admiraltyErr) {
        console.error("[publishers/enrich] Admiralty evaluation failed:", admiraltyErr.message);
      }

      // Refresh source-identity cache so "URL only / needs review" clears after enrichment
      if (reqSourceUrl || contentId) {
        let refreshUrl = reqSourceUrl;
        if (!refreshUrl && contentId) {
          try {
            const [c] = await query(`SELECT url FROM content WHERE content_id = ? LIMIT 1`, [contentId]);
            refreshUrl = c?.url;
          } catch {}
        }
        if (refreshUrl) {
          resolveSourceIdentity(refreshUrl, { query, force: true, hintName: publisher.publisher_name }).catch(() => {});
        }
      }

      res.json({ success: true, result: { ...enrichResult, admiraltyCode, admiraltyUpdates } });
    } catch (err) {
      console.error("Error triggering publisher enrichment:", err);
      res.status(500).json({ error: "Enrichment failed" });
    }
  });

  return router;
}
