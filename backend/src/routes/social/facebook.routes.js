// backend/src/routes/social/facebook.routes.js
// ──────────────────────────────────────────────────────────────────
// Facebook scraping endpoints
// ──────────────────────────────────────────────────────────────────

import { Router } from "express";
import logger from "../../utils/logger.js";
import { scrapeFacebookPost, cleanFacebookPostText } from "../../scrapers/facebookScraper.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function createFacebookRoutes({ query }) {
  const router = Router();

  /**
   * POST /api/scrape-facebook-post
   * Scrape a Facebook post and optionally create content entry
   */
  router.post("/api/scrape-facebook-post", async (req, res) => {
    try {
      const {
        url,
        createContent = false,
        taskContentId,
        screenshot = false,
        raw_text,  // From extension
        title,     // From extension
        authors,   // From extension
        images,    // From extension
        timestamp, // From extension
        reactionsCount, // From extension
        commentsCount,  // From extension
        sharesCount     // From extension
      } = req.body;

      if (!url) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: url",
        });
      }

      // Validate URL is from Facebook
      if (!url.includes("facebook.com") && !url.includes("fb.com")) {
        return res.status(400).json({
          success: false,
          error: "URL must be from facebook.com",
        });
      }

      logger.log(`🔵 [/api/scrape-facebook-post] Scraping: ${url}`);

      let result;

      // If raw_text provided (from extension), skip Puppeteer scraping
      if (raw_text) {
        logger.log(`✅ [/api/scrape-facebook-post] Using data from extension (no Puppeteer needed)`);
        logger.log(`   📊 Extension data received:`, {
          postTextLength: raw_text?.length || 0,
          authorName: authors?.[0] ? `${authors[0].author_first_name} ${authors[0].author_last_name}`.trim() : 'NONE',
          imagesCount: images?.length || 0,
          firstImage: images?.[0] || 'NONE',
          timestamp: timestamp || 'NONE',
          reactions: reactionsCount || 0,
          comments: commentsCount || 0,
          shares: sharesCount || 0,
        });

        result = {
          success: true,
          url,
          postText: raw_text,
          authorName: authors?.[0] ? `${authors[0].author_first_name} ${authors[0].author_last_name}`.trim() : null,
          timestamp: timestamp || null,
          images: images || [],
          reactionsCount: reactionsCount || 0,
          commentsCount: commentsCount || 0,
          sharesCount: sharesCount || 0,
          scrapedAt: new Date().toISOString(),
        };
      } else {
        // Path to cookies file (if it exists)
        const cookiesPath = path.join(__dirname, "../../../config/facebook-cookies.json");

        // Scrape the post with Puppeteer
        result = await scrapeFacebookPost(url, {
          cookiesPath,
          screenshot,
        });

        if (!result.success) {
          return res.status(500).json({
            success: false,
            error: result.error || "Failed to scrape Facebook post",
          });
        }
      }

      // Clean the post text
      if (result.postText) {
        result.postText = cleanFacebookPostText(result.postText);
      }

      // If requested, create a content entry and run full claims/evidence pipeline
      let contentId = null;
      if (createContent && result.postText) {
        const { createContentInternal } = await import("../../storage/createContentInternal.js");

        contentId = await createContentInternal(query, {
          content_name: result.postText.substring(0, 100) || "Facebook Post",
          url: url,
          media_source: "Facebook",
          topic: "social_media",
          subtopics: ["facebook"],
          content_type: "task",
          thumbnail: result.images?.[0] || null,
          details: result.postText,
        });

        // If we have an author, create author entry
        if (result.authorName) {
          const { persistAuthors } = await import("../../storage/persistAuthors.js");
          await persistAuthors(query, contentId, [
            {
              author_first_name: result.authorName.split(" ")[0] || "",
              author_last_name: result.authorName.split(" ").slice(1).join(" ") || "",
            },
          ]);
        }

        // Link to task if taskContentId provided
        if (taskContentId) {
          await query(
            `INSERT INTO reference_content (task_content_id, reference_content_id, created_at)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE created_at = NOW()`,
            [taskContentId, contentId]
          );
          logger.log(`🔗 [/api/scrape-facebook-post] Linked to task ${taskContentId}`);
        }

        logger.log(`✅ [/api/scrape-facebook-post] Created content_id=${contentId}`);

        // ═════════════════════════════════════════════════════════════════
        // Run FULL claims and evidence pipeline (same as /api/scrape-task)
        // ═════════════════════════════════════════════════════════════════

        try {
          logger.log(`🔵 [/api/scrape-facebook-post] Extracting claims from post text...`);
          logger.log(`   Text length: ${result.postText.length} chars`);

          // Import pipeline functions
          const { processTaskClaims } = await import("../../core/processTaskClaims.js");
          const { runEvidenceEngine } = await import("../../core/runEvidenceEngine.js");
          const { persistAIResults } = await import("../../storage/persistAIResults.js");

          // 1. Extract & store TASK claims
          const taskClaims = await processTaskClaims({
            query,
            taskContentId: contentId,
            text: result.postText,
          });

          const claimIds = taskClaims.map((c) => c.id);
          logger.log(`✅ [/api/scrape-facebook-post] Extracted ${claimIds.length} claims`);

          // 2. Run Evidence Engine (find supporting/contradicting evidence)
          if (claimIds.length > 0) {
            logger.log(`🔵 [/api/scrape-facebook-post] Running evidence engine...`);

            const { aiReferences, failedCandidates, claimConfidenceMap } =
              await runEvidenceEngine({
                taskContentId: contentId,
                claimIds,
                readableText: result.postText,
              });

            logger.log(`✅ [/api/scrape-facebook-post] Found ${aiReferences.length} evidence references`);

            // 3. Persist AI evidence results
            await persistAIResults(query, {
              contentId: contentId,
              evidenceRefs: aiReferences,
              claimIds,
              claimConfidenceMap,
            });

            logger.log(`✅ [/api/scrape-facebook-post] Evidence engine complete!`);
          } else {
            logger.log(`⚠️ [/api/scrape-facebook-post] No claims extracted, skipping evidence engine`);
          }
        } catch (claimsError) {
          logger.error(`❌ [/api/scrape-facebook-post] Claims/evidence pipeline failed:`, claimsError);
          // Don't fail the whole request - content was still created
        }
      }

      return res.json({
        success: true,
        contentId,
        post: {
          text: result.postText,
          author: result.authorName,
          timestamp: result.timestamp,
          images: result.images,
          reactions: result.reactionsCount,
          comments: result.commentsCount,
          shares: result.sharesCount,
          scrapedAt: result.scrapedAt,
        },
      });
    } catch (error) {
      logger.error("❌ Error in /api/scrape-facebook-post:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error",
      });
    }
  });

  /**
   * GET /api/facebook/test
   * Test endpoint to verify Facebook scraper is working
   */
  router.get("/api/facebook/test", async (req, res) => {
    res.json({
      success: true,
      message: "Facebook scraper endpoints are active",
      endpoints: {
        scrapePost: "POST /api/scrape-facebook-post",
      },
      note: "To use authenticated scraping, save cookies using: npm run save-fb-cookies",
    });
  });

  return router;
}
