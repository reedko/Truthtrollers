// /backend/src/routes/publishers/publishers.routes.js
import { Router } from "express";
import { resolveSourceIdentity } from "../../../services/sourceIdentityResolver.js";
import { resolveSourceLineage } from "../../../services/sourceLineageResolver.js";
import { assemblePublisherStatusFromSignals, deriveSourceAlignment } from "../../services/ownSiteOrgStatusService.js";
import { linkPublisherRole, unlinkPublisherRole } from "../../storage/persistPublishers.js";

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

function isAutomaticScholarlyOrWikiRow(row) {
  return /^(wikipedia|wikidata|scimago)$/i.test(String(row?.source || row?.provider || ""));
}

function hasDirectRatingSignal(ratings) {
  return ratings.some((rating) =>
    rating.veracity_score != null ||
    rating.bias_score != null ||
    (rating.rating_label && !isAutomaticScholarlyOrWikiRow(rating))
  );
}

function isGenericSocialPublisher(publisher) {
  const name = String(publisher?.publisher_name || "").trim().toLowerCase();
  const domain = String(publisher?.domain || "").trim().toLowerCase();
  return /^(facebook|facebook\.com|twitter\/x|twitter|twitter\.com|x|x\.com|instagram|instagram\.com|tiktok|tiktok\.com)$/.test(name) ||
    /^(facebook|twitter|x|instagram|tiktok)\.com$/.test(domain);
}

async function loadNormalizedSourceContext(query, contentId) {
  if (!Number.isFinite(contentId)) {
    return {
      primarySource: null,
      publishingOrganization: null,
      publicationVenue: null,
      distribution: null,
      publishingContext: null,
      identifiers: [],
      authors: [],
      extractionEvidence: {},
    };
  }
  try {
    const [context, entities, authors] = await Promise.all([
      query(
        `SELECT * FROM content_publishing_context
          WHERE content_id = ?
          ORDER BY updated_at DESC, context_id DESC
          LIMIT 1`,
        [contentId],
      ).then((rows) => rows[0] || null),
      query(
        `SELECT p.publisher_id, p.publisher_name, p.entity_type,
                cp.publisher_role, cp.is_primary, cp.identity_confidence,
                cp.extraction_method, cp.evidence_json
           FROM content_publishers cp
           JOIN publishers p ON p.publisher_id = cp.publisher_id
          WHERE cp.content_id = ?
          ORDER BY cp.is_primary DESC, cp.content_publisher_id`,
        [contentId],
      ),
      query(
        `SELECT a.author_id, a.display_name, a.first_name, a.middle_name, a.last_name
           FROM content_authors ca
           JOIN authors a ON a.author_id = ca.author_id
          WHERE ca.content_id = ?
          ORDER BY ca.content_author_id`,
        [contentId],
      ),
    ]);
    const identifiers = context
      ? await query(
          `SELECT identifier_type, identifier_scope, normalized_value, raw_value,
                  extraction_method, extraction_confidence, evidence_quote
             FROM content_publishing_identifiers
            WHERE context_id = ?
            ORDER BY identifier_type, normalized_value`,
          [context.context_id],
        )
      : [];
    const byRole = (role) => entities.find((entity) => entity.publisher_role === role) || null;
    return {
      primarySource: entities.find((entity) => entity.is_primary) || null,
      publishingOrganization: byRole("publishing_organization"),
      publicationVenue: byRole("publication_venue"),
      distribution: byRole("distribution_channel") || byRole("platform"),
      publishingContext: context,
      identifiers,
      authors,
      extractionEvidence: {
        context: context?.extraction_evidence || null,
        entities: entities.map((entity) => ({
          publisherId: entity.publisher_id,
          role: entity.publisher_role,
          method: entity.extraction_method,
          confidence: entity.identity_confidence,
          evidence: entity.evidence_json,
        })),
      },
    };
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
      return loadNormalizedSourceContext(query, Number.NaN);
    }
    throw error;
  }
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
   * Returns the most recently linked publisher and the resolved crest for a content record.
   * Content-level admiralty is authoritative; publisher-level admiralty is fallback.
   */
  router.get("/api/publishers/for-content/:contentId", async (req, res) => {
    const { contentId } = req.params;
    try {
      const normalizedSql =
        `SELECT p.publisher_id, p.publisher_name,
                COALESCE(
                  (SELECT ae.admiralty_code
                     FROM admiralty_evaluations ae
                    WHERE ae.target_type = 'content'
                      AND ae.target_id = cp.content_id
                      AND ae.publisher_id = p.publisher_id
                      AND ae.evaluation_status NOT IN ('insufficient_data')
                      AND ae.admiralty_code REGEXP '^[A-E]'
                    ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested'),
                             ae.updated_at DESC
                    LIMIT 1),
                  (SELECT ae.admiralty_code
                     FROM admiralty_evaluations ae
                    WHERE ae.target_type = 'publisher'
                      AND ae.target_id = p.publisher_id
                      AND ae.evaluation_status NOT IN ('insufficient_data')
                      AND ae.admiralty_code REGEXP '^[A-E]'
                    ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested'),
                             ae.updated_at DESC
                    LIMIT 1)
                ) AS admiralty_code,
                CASE
                  WHEN EXISTS (
                    SELECT 1
                      FROM admiralty_evaluations ae
                     WHERE ae.target_type = 'content'
                       AND ae.target_id = cp.content_id
                       AND ae.publisher_id = p.publisher_id
                       AND ae.evaluation_status NOT IN ('insufficient_data')
                       AND ae.admiralty_code REGEXP '^[A-E]'
                     LIMIT 1
                  ) THEN 'content'
                  WHEN EXISTS (
                    SELECT 1
                      FROM admiralty_evaluations ae
                     WHERE ae.target_type = 'publisher'
                       AND ae.target_id = p.publisher_id
                       AND ae.evaluation_status NOT IN ('insufficient_data')
                       AND ae.admiralty_code REGEXP '^[A-E]'
                     LIMIT 1
                  ) THEN 'publisher'
                  ELSE NULL
                END AS admiralty_source
         FROM content_publishers cp
         JOIN publishers p ON cp.publisher_id = p.publisher_id
         WHERE cp.content_id = ?
         ORDER BY cp.is_primary DESC, cp.content_publisher_id DESC
         LIMIT 1`;
      let rows;
      try {
        rows = await query(normalizedSql, [contentId]);
      } catch (error) {
        if (error?.code !== "ER_BAD_FIELD_ERROR") throw error;
        rows = await query(
          `SELECT p.publisher_id, p.publisher_name,
                  COALESCE(
                    (SELECT ae.admiralty_code FROM admiralty_evaluations ae
                      WHERE ae.target_type = 'publisher' AND ae.target_id = p.publisher_id
                      ORDER BY ae.updated_at DESC LIMIT 1), NULL
                  ) AS admiralty_code,
                  'publisher' AS admiralty_source
             FROM content_publishers cp
             JOIN publishers p ON cp.publisher_id = p.publisher_id
            WHERE cp.content_id = ?
            ORDER BY cp.content_publisher_id DESC LIMIT 1`,
          [contentId],
        );
      }
      if (!rows.length) {
        return res.json({ publisher_id: null, publisher_name: null, admiralty_code: null, admiralty_source: null });
      }
      res.json({
        publisher_id: rows[0].publisher_id,
        publisher_name: rows[0].publisher_name,
        admiralty_code: rows[0].admiralty_code ?? null,
        admiralty_source: rows[0].admiralty_source ?? null,
      });
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
        await linkPublisherRole(query, contentId, {
          publisherId: identity.publisherId,
          role: "primary_source",
          isPrimary: true,
          method: "source_resolver",
        });
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
    const {
      name,
      domain,
      contentId,
      force = false,
      skipExternalSignals = true,
      skipOwnSiteOrgStatus = false,
      maxProviderConcurrency = 1,
    } = req.body;
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

      // 2. Replace only the selected identity role. Venue/platform/linked-source
      // relationships remain intact.
      if (contentId) {
        const role = String(req.body.publisherRole || "primary_source");
        const priorLinks = await query(
          `SELECT publisher_id, publisher_role, is_primary, identity_confidence,
                  extraction_method, evidence_json
             FROM content_publishers WHERE content_id = ?`,
          [contentId],
        );
        await linkPublisherRole(query, contentId, {
          publisherId,
          role,
          isPrimary: true,
          confidence: 1,
          method: "manual",
          evidence: { confirmed_name: name.trim(), source_url: sourceUrl },
          replaceRole: true,
        });
        const [context] = await query(
          `SELECT context_id FROM content_publishing_context WHERE content_id = ? ORDER BY updated_at DESC LIMIT 1`,
          [contentId],
        );
        await query(
          `INSERT INTO source_identity_confirmations
            (content_id, context_id, user_id, prior_identity_json,
             confirmed_identity_json, method, evidence_json)
           VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
          [contentId, context?.context_id || null, req.user?.user_id || null,
            JSON.stringify(priorLinks),
            JSON.stringify({ publisherId, publisherName: name.trim(), publisherRole: role }),
            JSON.stringify({ sourceUrl, confirmedAt: new Date().toISOString() })],
        );
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
        skipExternalSignals,
        skipOwnSiteOrgStatus,
        maxProviderConcurrency,
      });

      // 5. Generate and persist admiralty code from whatever ratings/profiles now exist
      let admiraltyCode = null;
      const admiraltyUpdates = {};
      try {
        const { evaluateAdmiraltyCode, storeEvaluation } = await import("../../../services/admiraltyEvaluator.js");
        const { loadProviderSignals } = await import("../../services/providerSignalPersistenceService.js");
        const [profileRows, ratingRows, providerSignals] = await Promise.all([
          query(`SELECT source, source_type FROM publisher_profiles WHERE publisher_id = ? ORDER BY last_checked DESC LIMIT 1`, [publisherId]),
          query(`SELECT source, rating_label, rating_type, bias_score, veracity_score, score, confidence FROM publisher_ratings WHERE publisher_id = ? AND user_id IS NULL ORDER BY last_checked DESC`, [publisherId]),
          loadProviderSignals(query, publisherId),
        ]);
        const evaluation = await evaluateAdmiraltyCode({
          publisherName: name.trim(),
          sourceIdentity: { sourceType: profileRows[0]?.source_type ?? null, resolutionLevel: ratingRows.length > 0 ? 5 : 3 },
          existingSourceRatings: ratingRows,
          providerResults: buildProviderResultsFromDb(ratingRows, profileRows),
          providerSignals,
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
          ) AS admiralty_code,
          (SELECT pp.source_type FROM publisher_profiles pp
            WHERE pp.publisher_id = a.publisher_id AND pp.source_type IS NOT NULL
            ORDER BY pp.last_checked DESC LIMIT 1) AS source_type,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM publisher_external_signals pes
               WHERE pes.publisher_id = a.publisher_id
                 AND pes.provider = 'own_site_org_status'
                 AND (pes.expires_at IS NULL OR pes.expires_at > NOW())
                 AND JSON_SEARCH(pes.flags, 'one', 'material_industry_interest') IS NOT NULL
            ) THEN 'IND'
            WHEN EXISTS (
              SELECT 1 FROM publisher_external_signals pes
               WHERE pes.publisher_id = a.publisher_id
                 AND pes.provider = 'own_site_org_status'
                 AND (pes.expires_at IS NULL OR pes.expires_at > NOW())
                 AND JSON_UNQUOTE(JSON_EXTRACT(pes.raw_value, '$.normalized.publisher_type')) = 'government_organization'
            ) THEN 'GOV'
            ELSE NULL
          END AS alignment_marker,
          CASE WHEN EXISTS (
            SELECT 1 FROM publisher_external_signals pes
             WHERE pes.publisher_id = a.publisher_id
               AND pes.provider = 'own_site_org_status'
               AND (pes.expires_at IS NULL OR pes.expires_at > NOW())
               AND JSON_UNQUOTE(JSON_EXTRACT(pes.raw_value, '$.normalized.publisher_type')) = 'government_organization'
          ) THEN 0 ELSE a.conflict_of_interest_score END AS alignment_risk_score
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

      await linkPublisherRole(query, contentId, {
        publisherId,
        role: "primary_source",
        isPrimary: true,
        method: "manual",
      });
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
      await unlinkPublisherRole(query, contentId, { publisherId });
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
    const contentId = Number.parseInt(String(req.query.contentId ?? ""), 10);
    const hasContentId = Number.isFinite(contentId);

    try {
      const [[publisher], rawRatings, rawProfiles, rawExternalSignals, enrichmentRuns, [admRow]] = await Promise.all([
        query(
          `SELECT publisher_id, publisher_name, entity_type, domain, publisher_icon, description
           FROM publishers WHERE publisher_id = ? LIMIT 1`,
          [publisherId]
        ).catch((error) => {
          if (error?.code !== "ER_BAD_FIELD_ERROR") throw error;
          return query(
            `SELECT publisher_id, publisher_name, domain, publisher_icon, description
               FROM publishers WHERE publisher_id = ? LIMIT 1`,
            [publisherId],
          );
        }),
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
          `SELECT provider, signal_type, admiralty_effect_type, normalized_score,
                  reliability_bucket, confidence_delta, reliability_delta, cap,
                  cap_reason, flags, matched_name, matched_domain, match_confidence,
                  evidence_url, explanation, retrieved_at, error_status, raw_value
             FROM publisher_external_signals
            WHERE publisher_id = ?
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY retrieved_at DESC, id DESC
            LIMIT 80`,
          [publisherId]
        ).catch((err) => {
          if (err?.code === "ER_NO_SUCH_TABLE") return [];
          throw err;
        }),
        query(
          `SELECT run.provider, run.status, run.candidate_url, run.confidence,
                  run.error_message, run.created_at
             FROM publisher_enrichment_runs run
             JOIN (
               SELECT provider, MAX(enrichment_run_id) AS latest_run_id
                 FROM publisher_enrichment_runs
                WHERE publisher_id = ?
                GROUP BY provider
             ) latest ON latest.latest_run_id = run.enrichment_run_id
            ORDER BY run.created_at DESC`,
          [publisherId]
        ).catch((err) => {
          if (err?.code === "ER_NO_SUCH_TABLE") return [];
          throw err;
        }),
        query(
          `SELECT admiralty_code, evaluation_status FROM admiralty_evaluations
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

      const isSocialDistributionPublisher = isGenericSocialPublisher(publisher);
      const ratings = isSocialDistributionPublisher
        ? rawRatings.filter((row) => !isAutomaticScholarlyOrWikiRow(row))
        : rawRatings;
      const profiles = isSocialDistributionPublisher
        ? rawProfiles.filter((row) => !isAutomaticScholarlyOrWikiRow(row))
        : rawProfiles;
      const externalSignals = isSocialDistributionPublisher
        ? rawExternalSignals.filter((row) => !/^(wikipedia|wikidata|scimago|crossref|openalex)$/i.test(String(row.provider || "")))
        : rawExternalSignals;
      const publisherStatus = assemblePublisherStatusFromSignals(externalSignals);
      const sourceAlignment = deriveSourceAlignment(publisherStatus);
      const normalizedSource = await loadNormalizedSourceContext(query, hasContentId ? contentId : Number.NaN);

      // Auto-evaluate admiralty if no code stored yet but we have rating/profile data.
      // This means the SourceCrest shows a code the moment enrichment data exists —
      // no manual re-enrich required.
      let admiraltyCode = admRow?.admiralty_code ?? null;
      if (hasContentId) {
        const [contentAdmRow] = await query(
          `SELECT admiralty_code, evaluation_status
             FROM admiralty_evaluations
            WHERE target_type = 'content'
              AND target_id = ?
              AND publisher_id = ?
              AND evaluation_status NOT IN ('insufficient_data')
              AND admiralty_code REGEXP '^[A-E]'
            ORDER BY FIELD(evaluation_status,'human_confirmed','community_reviewed','machine_suggested'),
                     updated_at DESC
            LIMIT 1`,
          [contentId, publisherId]
        );
        admiraltyCode = contentAdmRow?.admiralty_code ?? admiraltyCode;
      }
      const canRefreshMachineCode =
        !admRow?.evaluation_status ||
        admRow.evaluation_status === "machine_suggested";
      const hasUsableSignal = hasDirectRatingSignal(ratings);
      if (isSocialDistributionPublisher && !hasUsableSignal && canRefreshMachineCode) {
        admiraltyCode = null;
      }
      if ((!admiraltyCode || (canRefreshMachineCode && admiraltyCode.startsWith("Ø"))) && hasUsableSignal) {
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

      const ratedEntity = {
        publisherId: publisher.publisher_id,
        publisherName: publisher.publisher_name,
        entityType: publisher.entity_type || null,
      };
      res.json({
        publisher,
        ratings: ratings.map((row) => ({ ...row, ratedEntity })),
        profiles: profiles.map((row) => ({ ...row, ratedEntity })),
        externalSignals: externalSignals.map((row) => ({ ...row, ratedEntity })),
        enrichmentRuns,
        publisherStatus,
        sourceAlignment,
        admiraltyCode,
        ...normalizedSource,
      });
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
    const {
      force = false,
      contentId = null,
      sourceUrl: reqSourceUrl = null,
      skipExternalSignals = true,
      skipOwnSiteOrgStatus = false,
      maxProviderConcurrency = 1,
    } = req.body;

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

      let sourceUrl = reqSourceUrl;
      if (!sourceUrl && contentId) {
        const [contentRow] = await query(`SELECT url FROM content WHERE content_id = ? LIMIT 1`, [contentId]);
        sourceUrl = contentRow?.url || null;
      }

      const enrichResult = await enrichPublisherIfNeeded({
        query,
        publisherId: publisher.publisher_id,
        publisherName: publisher.publisher_name,
        domain: publisher.domain || null,
        sourceUrl: sourceUrl || null,
        force,
        context: "case_content",
        skipExternalSignals,
        skipOwnSiteOrgStatus,
        maxProviderConcurrency,
      });

      let admiraltyCode = enrichResult?.admiraltyCode || null;
      const admiraltyUpdates = { ...(enrichResult?.admiraltyUpdates || {}) };
      try {
        const [admRow] = await query(
          `SELECT admiralty_code FROM admiralty_evaluations
            WHERE target_type = 'publisher' AND target_id = ?
              AND evaluation_status NOT IN ('insufficient_data')
            ORDER BY FIELD(evaluation_status,'human_confirmed','community_reviewed','machine_suggested'),
                     updated_at DESC
            LIMIT 1`,
          [publisher.publisher_id]
        );
        admiraltyCode = admiraltyCode || admRow?.admiralty_code || null;
        if (contentId) {
          admiraltyUpdates[contentId] = admiraltyUpdates[contentId] || admiraltyCode;
        }
      } catch (admiraltyErr) {
        console.error("[publishers/enrich] Admiralty lookup after enrichment failed:", admiraltyErr.message);
      }

      // Refresh source-identity cache so "URL only / needs review" clears after enrichment
      if (reqSourceUrl || contentId) {
        let refreshUrl = sourceUrl;
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
