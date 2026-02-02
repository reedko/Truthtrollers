// backend/src/routes/content/content.scrape.routes.js
// ──────────────────────────────────────────────────────────────────
// PROCESS-ONCE-INLINE DESIGN:
// - References are FULLY PROCESSED during evidence fetch (not after)
// - No HTML/text passed between functions
// - Single parse, single metadata extraction, single DB write per URL
// ──────────────────────────────────────────────────────────────────
import { Router } from "express";
import logger from "../../utils/logger.js";

// Single-pass scraping functions
import { scrapeTask } from "../../core/scrapeTask.js";
import { scrapeReference } from "../../core/scrapeReference.js"; // Used by /api/scrape-reference (legacy endpoint)

// Storage helpers
import { persistReferences } from "../../storage/persistReferences.js";
import { persistAIResults } from "../../storage/persistAIResults.js";
import { persistClaims } from "../../storage/persistClaims.js";

// Claims + Evidence engines
import { processTaskClaims } from "../../core/processTaskClaims.js";
import { runEvidenceEngine } from "../../core/runEvidenceEngine.js";

export default function createContentScrapeRoutes({ query }) {
  const router = Router();
  /**
   * Dashboard → request a scrape
   */
  router.post("/api/scrape-request", async (req, res) => {
    const userId = req.user?.user_id;
    const { mode, url, taskContentId } = req.body;

    if (!mode) {
      return res.status(400).json({ error: "Missing scrape mode" });
    }

    // Validate scrape_mode enum
    const validModes = ["scrape_last_viewed", "scrape_specific_url"];
    if (!validModes.includes(mode)) {
      return res.status(400).json({
        error: `Invalid scrape mode. Must be one of: ${validModes.join(", ")}`,
      });
    }

    if (mode === "scrape_specific_url" && !url) {
      return res.status(400).json({ error: "Missing target URL" });
    }

    const result = await query(
      `
    INSERT INTO scrape_jobs (
      requested_by_user_id,
      requested_by_source,
      scrape_mode,
      target_url,
      task_content_id
    ) VALUES (?, 'dashboard', ?, ?, ?)
    `,
      [userId, mode, url || null, taskContentId || null]
    );

    res.json({
      ok: true,
      scrape_job_id: result.insertId,
    });
  });

  /**
   * GET /api/scrape-jobs/pending
   * Extension → get pending scrape jobs
   */
  router.get("/api/scrape-jobs/pending", async (_, res) => {
    try {
      const sql = `
        SELECT
          scrape_job_id,
          requested_by_user_id,
          scrape_mode,
          target_url,
          task_content_id,
          requested_at
        FROM scrape_jobs
        WHERE status = 'pending'
        ORDER BY requested_at ASC
        LIMIT 10
      `;

      const jobs = await query(sql);
      res.json(jobs);
    } catch (err) {
      logger.error("❌ Error fetching pending scrape jobs:", err);
      res.status(500).json({ error: "Failed to fetch pending jobs" });
    }
  });

  /**
   * GET /api/scrape-jobs/:id/status
   * Dashboard → check status of a scrape job
   */
  router.get("/api/scrape-jobs/:id/status", async (req, res) => {
    const { id } = req.params;

    try {
      const sql = `
        SELECT
          scrape_job_id,
          status,
          result_content_id,
          error_message,
          completed_at
        FROM scrape_jobs
        WHERE scrape_job_id = ?
      `;

      const [job] = await query(sql, [id]);

      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      res.json({
        scrape_job_id: job.scrape_job_id,
        status: job.status,
        content_id: job.result_content_id,
        error_message: job.error_message,
        completed_at: job.completed_at
      });
    } catch (err) {
      logger.error(`❌ Error fetching scrape job ${id} status:`, err);
      res.status(500).json({ error: "Failed to fetch job status" });
    }
  });

  /**
   * POST /api/scrape-jobs/:id/claim
   * Extension → claim a scrape job
   */
  router.post("/api/scrape-jobs/:id/claim", async (req, res) => {
    const { id } = req.params;
    const { instance_id } = req.body;

    try {
      const sql = `
        UPDATE scrape_jobs
        SET status = 'claimed',
            claimed_by_instance_id = ?,
            claimed_at = NOW()
        WHERE scrape_job_id = ?
          AND status = 'pending'
      `;

      const result = await query(sql, [instance_id, id]);

      if (result.affectedRows === 0) {
        return res.status(409).json({ error: "Job already claimed or not found" });
      }

      logger.log(`✅ Scrape job ${id} claimed by instance ${instance_id}`);
      res.json({ ok: true });
    } catch (err) {
      logger.error(`❌ Error claiming scrape job ${id}:`, err);
      res.status(500).json({ error: "Failed to claim job" });
    }
  });

  /**
   * POST /api/scrape-jobs/:id/complete
   * Extension → mark scrape job as completed
   */
  router.post("/api/scrape-jobs/:id/complete", async (req, res) => {
    const { id } = req.params;
    const { content_id, instance_id } = req.body;

    try {
      const sql = `
        UPDATE scrape_jobs
        SET status = 'completed',
            result_content_id = ?,
            completed_at = NOW()
        WHERE scrape_job_id = ?
          AND claimed_by_instance_id = ?
          AND status = 'claimed'
      `;

      const result = await query(sql, [content_id, id, instance_id]);

      if (result.affectedRows === 0) {
        return res.status(409).json({
          error: "Job not found, not claimed by this instance, or already completed"
        });
      }

      logger.log(`✅ Scrape job ${id} completed with content_id ${content_id}`);
      res.json({ ok: true, content_id });
    } catch (err) {
      logger.error(`❌ Error completing scrape job ${id}:`, err);
      res.status(500).json({ error: "Failed to complete job" });
    }
  });

  /**
   * POST /api/scrape-jobs/:id/fail
   * Extension → mark scrape job as failed
   */
  router.post("/api/scrape-jobs/:id/fail", async (req, res) => {
    const { id } = req.params;
    const { error_message, instance_id } = req.body;

    try {
      const sql = `
        UPDATE scrape_jobs
        SET status = 'failed',
            error_message = ?,
            completed_at = NOW()
        WHERE scrape_job_id = ?
          AND claimed_by_instance_id = ?
          AND status = 'claimed'
      `;

      const result = await query(sql, [error_message, id, instance_id]);

      if (result.affectedRows === 0) {
        return res.status(409).json({
          error: "Job not found, not claimed by this instance, or already processed"
        });
      }

      logger.log(`⚠️ Scrape job ${id} failed: ${error_message}`);
      res.json({ ok: true });
    } catch (err) {
      logger.error(`❌ Error marking scrape job ${id} as failed:`, err);
      res.status(500).json({ error: "Failed to mark job as failed" });
    }
  });

  // ============================================================
  //  POST /api/scrape-task
  //  Supports TWO modes:
  //  1. NEW: { url, raw_html? } → Single-pass scraping
  //  2. LEGACY/TESTING: Full envelope with raw_text, authors, etc.
  // ============================================================
  router.post("/api/scrape-task", async (req, res) => {
    try {
      const { url, raw_html, raw_text } = req.body;

      if (!url) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: url",
        });
      }

      let taskContentId;
      let text;
      let domRefs = [];
      let inlineRefs = [];

      // ═════════════════════════════════════════════════════════════
      // MODE 1: LEGACY/TESTING - Use provided data (skip scraping)
      // ═════════════════════════════════════════════════════════════
      if (raw_text) {
        logger.log(
          `🧪 [/api/scrape-task] TESTING MODE: Using provided raw_text (${raw_text.length} chars)`
        );

        const {
          content_name,
          media_source,
          topic,
          subtopics,
          authors,
          publisherName,
          thumbnail,
          content, // DOM references
        } = req.body;

        // Import legacy storage helpers
        const { createContentInternal } = await import(
          "../../storage/createContentInternal.js"
        );
        const { persistAuthors } = await import(
          "../../storage/persistAuthors.js"
        );
        const { persistPublishers } = await import(
          "../../storage/persistPublishers.js"
        );

        // Create task content row
        taskContentId = await createContentInternal(query, {
          content_name: content_name || "Test Task",
          url,
          media_source: media_source || "Test",
          topic: topic || "general",
          subtopics: subtopics || [],
          content_type: "task",
          thumbnail: thumbnail || null,
          details: raw_text.slice(0, 500),
        });

        // Persist authors
        if (Array.isArray(authors) && authors.length > 0) {
          await persistAuthors(query, taskContentId, authors);
        }

        // Persist publisher
        if (publisherName) {
          await persistPublishers(query, taskContentId, publisherName);
        }

        // Map provided content to references format
        if (Array.isArray(content)) {
          domRefs = content.map((item) => ({
            url: item.domUrl || item.url,
            content_name: item.textBlock || item.content_name || "Reference",
          }));
        }

        text = raw_text;

        logger.log(
          `✅ [/api/scrape-task] TESTING MODE: Created task content_id=${taskContentId}`
        );
      }
      // ═════════════════════════════════════════════════════════════
      // MODE 2: NEW - Single-pass scraping
      // ═════════════════════════════════════════════════════════════
      else {
        if (raw_html) {
          logger.log(
            `🟦 [/api/scrape-task] NEW MODE: Using provided HTML (${raw_html.length} chars, no fetch needed)`
          );
        } else {
          logger.log(
            `🟦 [/api/scrape-task] NEW MODE: Starting single-pass scrape for: ${url}`
          );
        }

        // Single-pass scraping
        const scrapeResult = await scrapeTask(query, url, raw_html);

        if (!scrapeResult) {
          return res.status(500).json({
            success: false,
            error: "Failed to scrape task content",
          });
        }

        ({ taskContentId, text, domRefs, inlineRefs } = scrapeResult);
      }

      // -----------------------------------------------------------------
      // 2. Persist DOM + inline references
      // -----------------------------------------------------------------
      const allRefs = [...domRefs, ...inlineRefs];
      let persistedDomRefs = [];
      if (allRefs.length > 0) {
        persistedDomRefs = await persistReferences(
          query,
          taskContentId,
          allRefs
        );
      }

      // -----------------------------------------------------------------
      // 3. Extract & store TASK claims → claimIds
      // -----------------------------------------------------------------
      const taskClaims = await processTaskClaims({
        query,
        taskContentId,
        text,
      });

      const claimIds = taskClaims.map((c) => c.id);

      // -----------------------------------------------------------------
      // 4. Run Evidence Engine (AI evidence references)
      //    → References are FULLY PROCESSED during fetch (inline)
      //    → Returns: { aiReferences, failedCandidates, claimConfidenceMap }
      // -----------------------------------------------------------------
      const { aiReferences, failedCandidates, claimConfidenceMap } =
        await runEvidenceEngine({
          taskContentId,
          claimIds,
          readableText: text,
        });

      // -----------------------------------------------------------------
      // 5. Create reference_claim_links (task claims → references)
      // -----------------------------------------------------------------
      const aiRefs = await persistAIResults(query, {
        contentId: taskContentId,
        evidenceRefs: aiReferences,
        claimIds,
        claimConfidenceMap, // Pass confidence map for storing per-claim confidence
      });

      // -----------------------------------------------------------------
      // 6. Extract claims FROM references (reference internal claims)
      //    Process in parallel for speed
      //    For each reference:
      //    a) Create snippet claim FIRST (from search engine snippet)
      //    b) Then extract reference claims (from full text)
      // -----------------------------------------------------------------
      const claimExtractionPromises = aiReferences
        .filter((ref) => ref.referenceContentId)
        .map(async (ref) => {
          try {
            // a) Create snippet claim from search engine snippet
            if (ref.quote) {
              await persistClaims(
                query,
                ref.referenceContentId,
                [ref.quote],
                "snippet", // relationshipType
                "snippet" // claimType
              );
              logger.log(
                `✅ [/api/scrape-task] Created snippet claim for reference ${ref.referenceContentId}`
              );
            }

            // b) Extract reference claims from full text (if available)
            if (ref.cleanText) {
              await processTaskClaims({
                query,
                taskContentId: ref.referenceContentId,
                text: ref.cleanText,
                claimType: "reference",
              });
              logger.log(
                `✅ [/api/scrape-task] Extracted reference claims from reference ${ref.referenceContentId}`
              );
            }
          } catch (err) {
            logger.warn(
              `⚠️  [/api/scrape-task] Failed to extract claims from reference ${ref.referenceContentId}:`,
              err.message
            );
          }
        });

      // Wait for all claim extractions to complete
      await Promise.all(claimExtractionPromises);

      // -----------------------------------------------------------------
      // 7. Return unified reference set to extension
      // -----------------------------------------------------------------
      logger.log(
        `✅ [/api/scrape-task] Complete: content_id=${taskContentId}, ${persistedDomRefs.length} DOM refs, ${aiRefs.length} AI refs`
      );

      return res.json({
        success: true,
        contentId: taskContentId,
        references: {
          dom: persistedDomRefs,
          ai: aiRefs,
        },
        failedCandidates: failedCandidates || [], // URLs that failed to scrape - can be manually added via dashboard
      });
    } catch (err) {
      logger.error("❌ Error in /api/scrape-task:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Internal server error in /api/scrape-task",
      });
    }
  });

  // ============================================================
  //  POST /api/scrape-reference
  //  NEW: Uses scrapeReference with pre-fetched text from evidence engine
  // ============================================================
  router.post("/api/scrape-reference", async (req, res) => {
    try {
      const {
        url,
        taskContentId,
        raw_text,
        raw_html,
        title,
        authors,
        claimIds,
        stance,
        quality,
        summary,
        quote,
        location,
      } = req.body;

      if (!url) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: url",
        });
      }

      logger.log(
        `🟦 [/api/scrape-reference] Processing reference${taskContentId ? ` for task ${taskContentId}` : ''}: ${url}`
      );

      // -----------------------------------------------------------------
      // 1. SCRAPE REFERENCE (using pre-fetched HTML/text if available)
      // -----------------------------------------------------------------
      const scrapeResult = await scrapeReference(query, {
        url,
        raw_text,
        raw_html,
        title,
        authors,
        taskContentId,
      });

      if (!scrapeResult) {
        return res.status(500).json({
          success: false,
          error: "Failed to scrape reference content",
        });
      }

      const { referenceContentId, text } = scrapeResult;

      // -----------------------------------------------------------------
      // 2. Extract & persist REFERENCE claims
      // -----------------------------------------------------------------
      const refClaims = await processTaskClaims({
        query,
        taskContentId: referenceContentId,
        text,
        claimType: "reference",
      });

      const refClaimIds = refClaims.map((c) => c.id);

      // -----------------------------------------------------------------
      // 2.5. Validate and update old snippet_only reference_claim_links
      // (in case this is a re-scrape of a previously failed reference)
      // Extract actual quotes from full text and validate stance
      // -----------------------------------------------------------------
      if (taskContentId && text) {
        // Get existing snippet_only/failed links for this reference
        const existingLinks = await query(
          `SELECT rcl.ref_claim_link_id, rcl.claim_id, rcl.stance as old_stance,
                  rcl.rationale as old_rationale, rcl.evidence_text as old_quote,
                  c.claim_text
           FROM reference_claim_links rcl
           JOIN content_claims cc ON rcl.claim_id = cc.claim_id
           JOIN claims c ON cc.claim_id = c.claim_id
           WHERE rcl.reference_content_id = ?
           AND rcl.scrape_status IN ('snippet_only', 'failed')`,
          [referenceContentId]
        );

        if (existingLinks.length > 0) {
          logger.log(`🔍 [/api/scrape-reference] Validating ${existingLinks.length} snippet-based links with full text`);

          // Import shared quote extraction utility
          const { extractBestQuote } = await import("../../utils/extractQuote.js");

          for (const link of existingLinks) {
            try {
              // Extract actual quote using shared utility
              const validation = await extractBestQuote({
                claimText: link.claim_text,
                fullText: text,
                sourceTitle: scrapeResult.title,
                maxChars: 4000,
              });

              if (validation?.quote) {
                // Update with actual quote and validated stance
                await query(
                  `UPDATE reference_claim_links
                   SET scrape_status = 'full',
                       stance = ?,
                       evidence_text = ?,
                       rationale = ?
                   WHERE ref_claim_link_id = ?`,
                  [
                    validation.stance || link.old_stance,
                    validation.quote,
                    `✓ Validated with full text: ${validation.summary || 'Quote extracted from scraped content'}`,
                    link.ref_claim_link_id
                  ]
                );
                logger.log(`✅ [/api/scrape-reference] Validated link ${link.ref_claim_link_id}: stance=${validation.stance}, extracted quote`);
              } else {
                // No quote found, mark as insufficient
                await query(
                  `UPDATE reference_claim_links
                   SET scrape_status = 'full',
                       stance = 'insufficient',
                       rationale = 'Manually scraped but no relevant quote found in full text'
                   WHERE ref_claim_link_id = ?`,
                  [link.ref_claim_link_id]
                );
                logger.log(`⚠️ [/api/scrape-reference] No quote found for link ${link.ref_claim_link_id}`);
              }
            } catch (err) {
              logger.warn(`⚠️ [/api/scrape-reference] Failed to validate link ${link.ref_claim_link_id}:`, err.message);
              // Fallback: just update scrape_status
              await query(
                `UPDATE reference_claim_links
                 SET scrape_status = 'full',
                     rationale = CONCAT('Manually scraped from loaded page. ', rationale)
                 WHERE ref_claim_link_id = ?`,
                [link.ref_claim_link_id]
              );
            }
          }
        }
      }

      // -----------------------------------------------------------------
      // 3. Create reference_claim_links (link to TASK claims)
      // -----------------------------------------------------------------
      if (Array.isArray(claimIds) && claimIds.length > 0) {
        const referenceClaimLinksToInsert = claimIds.map((taskClaimId) => ({
          claim_id: taskClaimId,
          reference_content_id: referenceContentId,
          stance: stance || "insufficient",
          score: quality ? Math.round(quality * 100) : 0,
          rationale: summary || null,
          evidence_text: quote || null,
          evidence_offsets: location ? JSON.stringify(location) : null,
          created_by_ai: 1,
          verified_by_user_id: null,
        }));

        const { insertReferenceClaimLinksBulk } = await import(
          "../../queries/referenceClaimLinks.js"
        );
        await insertReferenceClaimLinksBulk(query, referenceClaimLinksToInsert);

        logger.log(
          `✅ [scrape-reference] Created ${referenceClaimLinksToInsert.length} reference_claim_links for ${referenceContentId}`
        );
      }

      // -----------------------------------------------------------------
      // 4. Return success - no sub-references for references
      // -----------------------------------------------------------------
      logger.log(
        `✅ [/api/scrape-reference] Complete: reference content_id=${referenceContentId}`
      );

      return res.json({
        success: true,
        contentId: referenceContentId,
        claimsExtracted: refClaimIds.length,
        taskClaimLinksCreated: claimIds?.length || 0,
        references: {
          dom: [],
          ai: [], // References don't create sub-references
        },
      });
    } catch (err) {
      logger.error("❌ Error in /api/scrape-reference:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Internal server error in /api/scrape-reference",
      });
    }
  });

  return router;
}
