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
import { matchClaimsToTaskClaims } from "../../core/matchClaims.js";
import { openAiLLM } from "../../core/openAiLLM.js";

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
   * Also auto-resets abandoned jobs stuck in 'claimed' status for > 5 minutes
   */
  router.get("/api/scrape-jobs/pending", async (_, res) => {
    try {
      // First, check for and log any stuck jobs
      const stuckJobsSql = `
        SELECT scrape_job_id, claimed_by_instance_id, claimed_at, scrape_mode, target_url
        FROM scrape_jobs
        WHERE status = 'claimed'
          AND claimed_at IS NOT NULL
          AND TIMESTAMPDIFF(MINUTE, claimed_at, NOW()) > 5
      `;

      const stuckJobs = await query(stuckJobsSql);
      if (stuckJobs.length > 0) {
        logger.log(`⚠️ [SCRAPE RECOVERY] Found ${stuckJobs.length} abandoned job(s) stuck in 'claimed' status:`);
        stuckJobs.forEach(job => {
          const minutesStuck = Math.floor((Date.now() - new Date(job.claimed_at).getTime()) / 60000);
          logger.log(`  - Job ${job.scrape_job_id}: claimed ${minutesStuck}min ago by ${job.claimed_by_instance_id}, mode=${job.scrape_mode}, url=${job.target_url || 'N/A'}`);
        });
      }

      // Reset any jobs that have been 'claimed' for more than 5 minutes
      // This prevents jobs from getting stuck if extension crashes
      const resetSql = `
        UPDATE scrape_jobs
        SET status = 'pending',
            claimed_by_instance_id = NULL,
            claimed_at = NULL
        WHERE status = 'claimed'
          AND claimed_at IS NOT NULL
          AND TIMESTAMPDIFF(MINUTE, claimed_at, NOW()) > 5
      `;

      const resetResult = await query(resetSql);
      if (resetResult.affectedRows > 0) {
        logger.log(`✅ [SCRAPE RECOVERY] Reset ${resetResult.affectedRows} abandoned job(s) back to pending`);
      }

      // Now fetch pending jobs
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

      // Log if we have pending jobs waiting to be processed
      if (jobs.length > 0) {
        logger.log(`📋 [SCRAPE JOBS] ${jobs.length} pending job(s) available for processing`);
      }

      res.json(jobs);
    } catch (err) {
      logger.error("❌ [SCRAPE JOBS] Error fetching pending scrape jobs:", err);
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
      // First check the current state of the job
      const checkSql = `SELECT scrape_job_id, status, claimed_by_instance_id FROM scrape_jobs WHERE scrape_job_id = ?`;
      const [currentJob] = await query(checkSql, [id]);

      if (!currentJob) {
        logger.log(`⚠️ [SCRAPE CLAIM] Job ${id} not found (instance: ${instance_id})`);
        return res.status(404).json({ error: "Job not found" });
      }

      if (currentJob.status !== 'pending') {
        logger.log(`⚠️ [SCRAPE CLAIM] Job ${id} cannot be claimed - status is '${currentJob.status}' (already claimed by: ${currentJob.claimed_by_instance_id || 'unknown'})`);
        return res.status(409).json({ error: "Job already claimed or not found" });
      }

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
        logger.log(`⚠️ [SCRAPE CLAIM] Job ${id} claim race condition - another instance claimed it first`);
        return res.status(409).json({ error: "Job already claimed or not found" });
      }

      logger.log(`✅ [SCRAPE CLAIM] Job ${id} claimed by instance ${instance_id}`);
      res.json({ ok: true });
    } catch (err) {
      logger.error(`❌ [SCRAPE CLAIM] Error claiming scrape job ${id}:`, err);
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
      // Check current state before updating
      const checkSql = `SELECT scrape_job_id, status, claimed_by_instance_id, scrape_mode, target_url FROM scrape_jobs WHERE scrape_job_id = ?`;
      const [currentJob] = await query(checkSql, [id]);

      if (!currentJob) {
        logger.log(`⚠️ [SCRAPE COMPLETE] Job ${id} not found when trying to mark complete (instance: ${instance_id})`);
        return res.status(404).json({ error: "Job not found" });
      }

      if (currentJob.status !== 'claimed') {
        logger.log(`⚠️ [SCRAPE COMPLETE] Job ${id} cannot be completed - status is '${currentJob.status}' (instance: ${instance_id})`);
        return res.status(409).json({ error: "Job not in claimed state" });
      }

      if (currentJob.claimed_by_instance_id !== instance_id) {
        logger.log(`⚠️ [SCRAPE COMPLETE] Job ${id} claimed by different instance (claimed by: ${currentJob.claimed_by_instance_id}, trying to complete: ${instance_id})`);
        return res.status(409).json({ error: "Job not claimed by this instance" });
      }

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
        logger.log(`⚠️ [SCRAPE COMPLETE] Job ${id} could not be updated to completed (race condition?)`);
        return res.status(409).json({
          error: "Job not found, not claimed by this instance, or already completed"
        });
      }

      logger.log(`✅ [SCRAPE COMPLETE] Job ${id} completed successfully by ${instance_id}, content_id=${content_id}, mode=${currentJob.scrape_mode}, url=${currentJob.target_url || 'N/A'}`);
      res.json({ ok: true, content_id });
    } catch (err) {
      logger.error(`❌ [SCRAPE COMPLETE] Error completing scrape job ${id}:`, err);
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
      // Check current state before updating
      const checkSql = `SELECT scrape_job_id, status, claimed_by_instance_id, scrape_mode, target_url FROM scrape_jobs WHERE scrape_job_id = ?`;
      const [currentJob] = await query(checkSql, [id]);

      if (!currentJob) {
        logger.log(`⚠️ [SCRAPE FAIL] Job ${id} not found when trying to mark failed (instance: ${instance_id}, error: ${error_message})`);
        return res.status(404).json({ error: "Job not found" });
      }

      if (currentJob.status !== 'claimed') {
        logger.log(`⚠️ [SCRAPE FAIL] Job ${id} cannot be marked failed - status is '${currentJob.status}' (instance: ${instance_id}, error: ${error_message})`);
        return res.status(409).json({ error: "Job not in claimed state" });
      }

      if (currentJob.claimed_by_instance_id !== instance_id) {
        logger.log(`⚠️ [SCRAPE FAIL] Job ${id} claimed by different instance (claimed by: ${currentJob.claimed_by_instance_id}, trying to fail: ${instance_id})`);
        return res.status(409).json({ error: "Job not claimed by this instance" });
      }

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
        logger.log(`⚠️ [SCRAPE FAIL] Job ${id} could not be updated to failed (race condition?)`);
        return res.status(409).json({
          error: "Job not found, not claimed by this instance, or already processed"
        });
      }

      logger.log(`❌ [SCRAPE FAIL] Job ${id} marked as failed by ${instance_id}, mode=${currentJob.scrape_mode}, url=${currentJob.target_url || 'N/A'}, error: ${error_message}`);
      res.json({ ok: true });
    } catch (err) {
      logger.error(`❌ [SCRAPE FAIL] Error marking scrape job ${id} as failed:`, err);
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
      const { url, raw_html, raw_text, force, media_source, authors: providedAuthors } = req.body;

      logger.log(`\n${'='.repeat(80)}`);
      logger.log(`🔵 [/api/scrape-task] RECEIVED REQUEST`);
      logger.log(`🔵 URL: ${url}`);
      logger.log(`🔵 Media source: ${media_source || 'not provided'}`);
      logger.log(`🔵 Force: ${force}`);
      logger.log(`🔵 Has raw_html: ${!!raw_html} (${raw_html?.length || 0} chars)`);
      logger.log(`🔵 Has raw_text: ${!!raw_text}`);
      logger.log(`🔵 Provided authors: ${providedAuthors?.length || 0}`);
      logger.log(`${'='.repeat(80)}\n`);

      if (!url) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: url",
        });
      }

      // Check if URL already exists (unless force=true)
      if (!force) {
        const existing = await query(
          "SELECT content_id, content_name FROM content WHERE url = ? LIMIT 1",
          [url]
        );

        if (existing.length > 0) {
          return res.status(409).json({
            success: false,
            error: "URL already exists",
            duplicate: true,
            existing_content_id: existing[0].content_id,
            existing_content_name: existing[0].content_name,
            message: `This URL already exists as "${existing[0].content_name}". Set force=true to create anyway.`
          });
        }
      }

      // ═════════════════════════════════════════════════════════════
      // EARLY VALIDATION: Check OpenAI API accessibility BEFORE any DB writes
      // ═════════════════════════════════════════════════════════════
      logger.log("🔍 [/api/scrape-task] Checking OpenAI API accessibility...");
      const { openAiLLM } = await import("../../core/openAiLLM.js");
      const apiCheck = await openAiLLM.testConnection();

      if (!apiCheck.accessible) {
        logger.error("❌ [/api/scrape-task] OpenAI API not accessible:", apiCheck.error);
        return res.status(503).json({
          success: false,
          error: "AI_SERVICE_UNAVAILABLE",
          message: apiCheck.userMessage,
          technicalError: apiCheck.error,
        });
      }
      logger.log("✅ [/api/scrape-task] OpenAI API is accessible");

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

        logger.log(`🧪 [/api/scrape-task] TESTING MODE data:`, {
          content_name: content_name?.substring(0, 50) + '...' || 'NONE',
          media_source,
          thumbnail: thumbnail ? `${thumbnail.substring(0, 60)}...` : 'NONE',
          authorsCount: authors?.length || 0,
        });

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
        const scrapeResult = await scrapeTask(query, url, raw_html, media_source, providedAuthors);

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
      //    Process in batches to prevent connection pool exhaustion
      //    For each reference:
      //    a) Create snippet claim FIRST (from search engine snippet)
      //    b) Then extract reference claims (from full text)
      // -----------------------------------------------------------------

      // Filter valid references (exclude self-references and short text)
      const validReferences = aiReferences.filter((ref) => {
        // Filter out references without content_id
        if (!ref.referenceContentId) return false;

        // Filter out self-references (reference is same as task)
        if (ref.referenceContentId === taskContentId) {
          logger.log(
            `⏭️  [/api/scrape-task] Skipping self-reference: reference ${ref.referenceContentId} is the same as task ${taskContentId}`
          );
          return false;
        }

        // Filter out references with insufficient text (<500 chars)
        // These rarely extract useful claims and waste LLM calls
        if (ref.cleanText && ref.cleanText.length < 500) {
          logger.log(
            `⏭️  [/api/scrape-task] Skipping reference with insufficient text (${ref.cleanText.length} chars): ${ref.url}`
          );
          return false;
        }

        return true;
      });

      logger.log(`🔄 [/api/scrape-task] Processing ${validReferences.length} references in batches of 3 for optimal performance`);

      // Track processing stats
      let processedSuccessfully = 0;
      let failedReferences = [];

      // Process references in BATCHES OF 3 to balance speed vs resource usage:
      // - Database pool: 10 connections, 3 refs × 3 connections/ref = 9 connections (safe)
      // - OpenAI rate limit: 3 refs × 3 LLM calls/ref = 9 RPM (well under typical 60-90 RPM limit)
      // - 3× faster than sequential, but prevents pool exhaustion
      const BATCH_SIZE = 3;

      // Helper function to process a single reference
      const processReference = async (ref) => {
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
            //    Pass task claim texts so the LLM also pulls statements that
            //    directly respond to / contradict / support those claims.
            if (ref.cleanText) {
              const extractedClaims = await processTaskClaims({
                query,
                taskContentId: ref.referenceContentId,
                text: ref.cleanText,
                claimType: "reference",
                taskClaimsContext: taskClaims.map((c) => c.text),
              });

              if (extractedClaims.length === 0) {
                logger.warn(
                  `⚠️  [/api/scrape-task] WARNING: NO claims extracted from reference ${ref.referenceContentId}`
                );
                logger.warn(`   URL: ${ref.url}`);
                logger.warn(`   Text length: ${ref.cleanText.length} chars`);
                logger.warn(`   This may indicate extraction prompt issues or non-claim-worthy content`);
              } else {
                logger.log(
                  `✅ [/api/scrape-task] Extracted ${extractedClaims.length} reference claims from ${ref.referenceContentId}`
                );

                // c) Auto-generate claim_links (reference claims → task claims with veracity scores)
                try {
                  logger.log(`🔗 [/api/scrape-task] Calling matchClaimsToTaskClaims for reference ${ref.referenceContentId}...`);
                  logger.log(`   Reference claims: ${extractedClaims.length}, Task claims: ${taskClaims.length}`);

                  const claimMatches = await matchClaimsToTaskClaims({
                    referenceClaims: extractedClaims,
                    taskClaims: taskClaims,
                    llm: openAiLLM
                  });

                  logger.log(`🔗 [/api/scrape-task] matchClaimsToTaskClaims returned ${claimMatches.length} matches`);

                  // ⚡ OPTIMIZATION: Batch insert AI-suggested links instead of sequential inserts
                  if (claimMatches.length > 0) {
                    const values = claimMatches.map(match => {
                      // Map stance values: 'supports' -> 'support', 'refutes' -> 'refute', 'related' -> 'nuance'
                      let mappedStance = match.stance;
                      if (match.stance === 'supports') mappedStance = 'support';
                      else if (match.stance === 'refutes') mappedStance = 'refute';
                      else if (match.stance === 'related') mappedStance = 'nuance';

                      return [
                        match.referenceClaimId,
                        match.taskClaimId,
                        mappedStance,
                        Math.round((match.veracityScore || 0.5) * 100), // score: 0-100
                        match.confidence, // 0.15-0.98
                        match.supportLevel, // -1.2 to +1.2
                        match.rationale,
                        null, // quote
                        1 // created_by_ai
                      ];
                    });

                    // Batch insert all AI-suggested links at once
                    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
                    const flatValues = values.flat();

                    await query(
                      `INSERT INTO reference_claim_task_links
                       (reference_claim_id, task_claim_id, stance, score, confidence, support_level, rationale, quote, created_by_ai)
                       VALUES ${placeholders}`,
                      flatValues
                    );

                    logger.log(
                      `✅ [/api/scrape-task] Batch created ${claimMatches.length} AI-suggested links (reference_claim_task_links) for reference ${ref.referenceContentId}`
                    );
                  } else {
                    logger.warn(
                      `⚠️  [/api/scrape-task] No AI-suggested links created for reference ${ref.referenceContentId} (0 matches from LLM)`
                    );
                  }
                } catch (linkErr) {
                  logger.error(
                    `❌ [/api/scrape-task] Failed to create claim_links for reference ${ref.referenceContentId}:`,
                    linkErr.message
                  );
                  logger.error(`   Stack:`, linkErr.stack);
                  failedReferences.push({
                    url: ref.url,
                    contentId: ref.referenceContentId,
                    error: `Failed to create claim links: ${linkErr.message}`,
                  });
                }
              }
            }

          // Mark as successfully processed
          processedSuccessfully++;
          return { success: true };

        } catch (err) {
          logger.error(
            `❌ [/api/scrape-task] Failed to process reference ${ref.referenceContentId}:`,
            err.message
          );
          logger.error(`   URL: ${ref.url}`);
          logger.error(`   Error type: ${err.name}`);
          logger.error(`   Stack:`, err.stack);

          failedReferences.push({
            url: ref.url,
            contentId: ref.referenceContentId,
            error: err.message,
          });
          return { success: false, error: err.message };
        }
      };

      // Process references in batches
      for (let i = 0; i < validReferences.length; i += BATCH_SIZE) {
        const batch = validReferences.slice(i, i + BATCH_SIZE);
        logger.log(`📦 [/api/scrape-task] Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} references)`);

        // Process batch in parallel
        await Promise.all(batch.map(ref => processReference(ref)));

        logger.log(`✅ [/api/scrape-task] Batch ${Math.floor(i / BATCH_SIZE) + 1} complete`);
      }

      logger.log(`\n${'='.repeat(80)}`);
      logger.log(`📊 [/api/scrape-task] REFERENCE PROCESSING SUMMARY`);
      logger.log(`   Total references: ${validReferences.length}`);
      logger.log(`   Successfully processed: ${processedSuccessfully}`);
      logger.log(`   Failed: ${failedReferences.length}`);
      if (failedReferences.length > 0) {
        logger.log(`\n   Failed references:`);
        failedReferences.forEach((failed, i) => {
          logger.log(`   ${i + 1}. ${failed.url}`);
          logger.log(`      Error: ${failed.error}`);
        });
      }
      logger.log(`${'='.repeat(80)}\n`);

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

      // Special handling for region blocks and other user-facing errors
      if (err.code === "REGION_BLOCKED" || err.userMessage) {
        return res.status(503).json({
          success: false,
          error: "AI_SERVICE_UNAVAILABLE",
          message: err.userMessage || err.message,
          technicalError: err.message,
        });
      }

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
    const startTime = Date.now();
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
        `🟦 [/api/scrape-reference] START Processing reference${taskContentId ? ` for task ${taskContentId}` : ''}: ${url}`
      );

      // -----------------------------------------------------------------
      // 0. CHECK FOR DUPLICATE URL
      // If reference already exists, reuse it and ensure content_relations link
      // -----------------------------------------------------------------
      const existing = await query(
        "SELECT content_id, content_name FROM content WHERE url = ? LIMIT 1",
        [url]
      );

      if (existing.length > 0) {
        const existingContentId = existing[0].content_id;
        logger.log(
          `♻️  [/api/scrape-reference] Reference already exists: content_id=${existingContentId} ("${existing[0].content_name}")`
        );

        // Ensure content_relations link exists (if taskContentId provided)
        if (taskContentId) {
          const relationCheck = await query(
            `SELECT 1 FROM content_relations WHERE content_id = ? AND reference_content_id = ?`,
            [taskContentId, existingContentId]
          );

          if (relationCheck.length === 0) {
            await query(
              `INSERT INTO content_relations (content_id, reference_content_id, added_by_user_id, is_system) VALUES (?, ?, ?, ?)`,
              [taskContentId, existingContentId, null, 1]
            );
            logger.log(
              `🔗 [/api/scrape-reference] Created content_relations: task ${taskContentId} → reference ${existingContentId}`
            );
          } else {
            logger.log(
              `✓ [/api/scrape-reference] Content_relations already exists: task ${taskContentId} → reference ${existingContentId}`
            );
          }
        }

        // Return existing reference immediately (skip scraping and claim extraction)
        return res.json({
          success: true,
          contentId: existingContentId,
          duplicate: true,
          message: `Reference already exists as "${existing[0].content_name}"`,
          duration: Date.now() - startTime,
        });
      }

      // -----------------------------------------------------------------
      // 1. SCRAPE REFERENCE (using pre-fetched HTML/text if available)
      // -----------------------------------------------------------------
      logger.log(`  ⏱️  [1/5] Scraping reference...`);
      const scrapeResult = await scrapeReference(query, {
        url,
        raw_text,
        raw_html,
        title,
        authors,
        taskContentId,
      });
      logger.log(`  ✅ [1/5] Scrape complete (${Date.now() - startTime}ms)`);

      if (!scrapeResult) {
        return res.status(500).json({
          success: false,
          error: "Failed to scrape reference content",
        });
      }

      const { referenceContentId, text } = scrapeResult;

      // -----------------------------------------------------------------
      // 2. Extract & persist REFERENCE claims
      //    If claimIds provided, use those for context.
      //    Otherwise, if taskContentId provided, use ALL task claims for context.
      //    This ensures context-aware extraction for manual dashboard scrapes.
      // -----------------------------------------------------------------
      logger.log(`  ⏱️  [2/5] Fetching task claims for context...`);
      let taskClaimsContext = null;
      if (claimIds && Array.isArray(claimIds) && claimIds.length > 0) {
        // Specific claims provided (e.g., from claim detail page)
        const claimRows = await query(
          `SELECT claim_text FROM claims WHERE claim_id IN (?)`,
          [claimIds]
        );
        taskClaimsContext = claimRows.map(row => row.claim_text);
        logger.log(`  ✅ [2/5] Using ${taskClaimsContext.length} specific claims for context (${Date.now() - startTime}ms)`);
      } else if (taskContentId) {
        // No specific claims, but we have a task — use ALL task claims as context
        const taskClaimRows = await query(
          `SELECT c.claim_text
           FROM content_claims cc
           JOIN claims c ON cc.claim_id = c.claim_id
           WHERE cc.content_id = ?
           AND cc.relationship_type IN ('task', 'content')`,
          [taskContentId]
        );
        if (taskClaimRows.length > 0) {
          taskClaimsContext = taskClaimRows.map(row => row.claim_text);
          logger.log(`  ✅ [2/5] Fetched ${taskClaimsContext.length} task claims from content_id=${taskContentId} for context (${Date.now() - startTime}ms)`);
        } else {
          logger.log(`  ⚠️  [2/5] No task claims found for content_id=${taskContentId}`);
        }
      }

      logger.log(`  ⏱️  [3/5] Extracting reference claims via OpenAI (this may take 30-60s)...`);
      const refClaims = await processTaskClaims({
        query,
        taskContentId: referenceContentId,
        text,
        claimType: "reference",
        taskClaimsContext,
      });
      logger.log(`  ✅ [3/5] Extracted ${refClaims.length} reference claims (${Date.now() - startTime}ms)`);

      const refClaimIds = refClaims.map((c) => c.id);

      // PROACTIVE DETECTION: Warn if manual scrape extracted no claims
      if (refClaimIds.length === 0) {
        logger.warn(
          `⚠️  [/api/scrape-reference] WARNING: Manual scrape extracted NO claims from ${url}`
        );
        logger.warn(`   Reference content_id: ${referenceContentId}`);
        logger.warn(`   Text length: ${text.length} chars`);
        logger.warn(`   Task claims context: ${taskClaimsContext ? taskClaimsContext.length : 0} claims`);
      } else if (taskContentId && claimIds && claimIds.length > 0) {
        // Auto-generate claim_links for manual scrapes with task context
        try {
            logger.log(`  ⏱️  [4/5] Matching reference claims to task claims via AI...`);
            // Fetch task claims
            const taskClaimRows = await query(
              `SELECT c.claim_id, c.claim_text
               FROM content_claims cc
               JOIN claims c ON cc.claim_id = c.claim_id
               WHERE cc.content_id = ?
               AND cc.relationship_type IN ('task', 'content')`,
              [taskContentId]
            );

            if (taskClaimRows.length > 0) {
              const taskClaimsForMatching = taskClaimRows.map(row => ({
                id: row.claim_id,
                text: row.claim_text
              }));

              logger.log(`  ⏱️  Calling matchClaimsToTaskClaims with ${refClaims.length} ref claims and ${taskClaimsForMatching.length} task claims...`);
              const claimMatches = await matchClaimsToTaskClaims({
                referenceClaims: refClaims,
                taskClaims: taskClaimsForMatching,
                llm: openAiLLM
              });
            logger.log(`  ✅ [4/5] Matched ${claimMatches.length} claims (${Date.now() - startTime}ms)`);

            // Insert into reference_claim_task_links (AI-suggested links)
            for (const match of claimMatches) {
              // Map stance values: 'supports' -> 'support', 'refutes' -> 'refute', 'related' -> 'nuance'
              let mappedStance = match.stance;
              if (match.stance === 'supports') mappedStance = 'support';
              else if (match.stance === 'refutes') mappedStance = 'refute';
              else if (match.stance === 'related') mappedStance = 'nuance';

              await query(
                `INSERT INTO reference_claim_task_links
                 (reference_claim_id, task_claim_id, stance, score, confidence, support_level, rationale, quote, created_by_ai)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [
                  match.referenceClaimId,
                  match.taskClaimId,
                  mappedStance,
                  Math.round((match.veracityScore || 0.5) * 100),
                  match.confidence,
                  match.supportLevel,
                  match.rationale,
                  null
                ]
              );
            }

            if (claimMatches.length > 0) {
              logger.log(
                `✅ [/api/scrape-reference] Created ${claimMatches.length} claim_links for manual scrape ${referenceContentId}`
              );
            }
          }
        } catch (linkErr) {
          logger.warn(
            `⚠️  [/api/scrape-reference] Failed to create claim_links:`,
            linkErr.message
          );
        }
      }

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
      const totalTime = Date.now() - startTime;
      logger.log(
        `✅ [/api/scrape-reference] COMPLETE: reference content_id=${referenceContentId} (total time: ${totalTime}ms / ${(totalTime/1000).toFixed(1)}s)`
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
      const elapsed = Date.now() - startTime;
      logger.error(`❌ [SCRAPE REFERENCE ERROR] Failed after ${elapsed}ms`);
      logger.error(`   URL: ${req.body.url}`);
      logger.error(`   Task ID: ${req.body.taskContentId || 'N/A'}`);
      logger.error(`   Error: ${err.message}`);
      logger.error(`   Stack: ${err.stack}`);

      return res.status(500).json({
        success: false,
        error: err.message || "Internal server error in /api/scrape-reference",
      });
    }
  });

  return router;
}
