// backend/src/routes/content/content.scrape.routes.js
import { Router } from "express";

// Core content creation helpers
import { createContentInternal } from "../../storage/createContentInternal.js";
import { persistAuthors } from "../../storage/persistAuthors.js";
import { persistPublishers } from "../../storage/persistPublishers.js";
import { persistReferences } from "../../storage/persistReferences.js";
import { persistAIResults } from "../../storage/persistAIResults.js";

// Claims + Evidence engines
import { processTaskClaims } from "../../core/processTaskClaims.js";
import { runEvidenceEngine } from "../../core/runEvidenceEngine.js";

export default function createContentScrapeRoutes({ query }) {
  const router = Router();

  // ============================================================
  //  POST /api/scrape-task
  // ============================================================
  router.post("/api/scrape-task", async (req, res) => {
    try {
      const envelope = req.body;

      if (!envelope || !envelope.url || !envelope.raw_text) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: url or raw_text",
        });
      }

      // -----------------------------------------------------------------
      // 1. Create TASK content row (stored procedure + thumbnail handling)
      // -----------------------------------------------------------------
      const taskContentId = await createContentInternal(query, {
        content_name: envelope.content_name,
        url: envelope.url,
        media_source: envelope.media_source,
        topic: envelope.topic,
        subtopics: envelope.subtopics,
        content_type: "task",
        taskContentId: null,
        authors: [], // inserted separately below
        publisher: null, // inserted separately below
        thumbnail: envelope.thumbnail,
        raw_text: envelope.raw_text, // save text immediately
      });

      // -----------------------------------------------------------------
      // 2. Persist authors & publisher
      // -----------------------------------------------------------------
      if (Array.isArray(envelope.authors) && envelope.authors.length > 0) {
        await persistAuthors(query, taskContentId, envelope.authors);
      }

      if (envelope.publisherName) {
        await persistPublishers(query, taskContentId, envelope.publisherName);
      }

      // -----------------------------------------------------------------
      // 3. Persist inline DOM references
      // -----------------------------------------------------------------
      let domRefs = [];
      if (Array.isArray(envelope.content)) {
        domRefs = await persistReferences(
          query,
          taskContentId,
          envelope.content
        );
      }

      // -----------------------------------------------------------------
      // 4. Extract & store TASK claims → claimIds
      // -----------------------------------------------------------------
      const taskClaims = await processTaskClaims({
        query,
        taskContentId,
        text: envelope.raw_text,
      });

      const claimIds = taskClaims.map((c) => c.id);

      // -----------------------------------------------------------------
      // 5. Run Evidence Engine (AI evidence references)
      // -----------------------------------------------------------------
      const aiReferences = await runEvidenceEngine({
        taskContentId,
        claimIds,
        readableText: envelope.raw_text,
      });

      // -----------------------------------------------------------------
      // 6. Persist AI evidence references & evidence rows
      // -----------------------------------------------------------------
      const aiRefs = await persistAIResults(query, {
        contentId: taskContentId,
        evidenceRefs: aiReferences,
        claimIds,
      });

      // -----------------------------------------------------------------
      // 7. Return unified reference set to extension
      // -----------------------------------------------------------------
      return res.json({
        success: true,
        contentId: taskContentId,
        references: {
          dom: domRefs,
          ai: aiRefs,
        },
      });
    } catch (err) {
      console.error("❌ Error in /api/scrape-task:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error in /api/scrape-task",
      });
    }
  });

  // ============================================================
  //  POST /api/scrape-reference
  // ============================================================
  router.post("/api/scrape-reference", async (req, res) => {
    try {
      const envelope = req.body;

      if (
        !envelope ||
        !envelope.url ||
        !envelope.raw_text ||
        !envelope.taskContentId
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: url, raw_text, or taskContentId (parent task)",
        });
      }

      // -----------------------------------------------------------------
      // 1. Create REFERENCE content row
      // -----------------------------------------------------------------
      const referenceContentId = await createContentInternal(query, {
        content_name: envelope.content_name || "Reference",
        url: envelope.url,
        media_source: envelope.media_source || "Web",
        topic: null,
        subtopics: [],
        content_type: "reference",
        taskContentId: envelope.taskContentId,
        authors: [],
        publisher: null,
        thumbnail: envelope.thumbnail,
        raw_text: envelope.raw_text,
      });

      // -----------------------------------------------------------------
      // 2. Persist authors & publisher (if provided)
      // -----------------------------------------------------------------
      if (Array.isArray(envelope.authors) && envelope.authors.length > 0) {
        await persistAuthors(query, referenceContentId, envelope.authors);
      }

      if (envelope.publisherName) {
        await persistPublishers(
          query,
          referenceContentId,
          envelope.publisherName
        );
      }

      // -----------------------------------------------------------------
      // 3. Persist nested DOM references inside this reference
      // -----------------------------------------------------------------
      let domRefs = [];
      if (Array.isArray(envelope.content)) {
        domRefs = await persistReferences(
          query,
          referenceContentId,
          envelope.content
        );
      }

      // -----------------------------------------------------------------
      // 4. Extract & persist REFERENCE claims
      // -----------------------------------------------------------------
      const refClaims = await processTaskClaims({
        query,
        taskContentId: referenceContentId,
        text: envelope.raw_text,
      });

      const claimIds = refClaims.map((c) => c.id);

      // -----------------------------------------------------------------
      // 5. Create reference_claim_links (link to TASK claims, not ref claims)
      // -----------------------------------------------------------------
      if (Array.isArray(envelope.claimIds) && envelope.claimIds.length > 0) {
        const referenceClaimLinksToInsert = envelope.claimIds.map(
          (taskClaimId) => ({
            claim_id: taskClaimId,
            reference_content_id: referenceContentId,
            stance: envelope.stance || "insufficient",
            score: envelope.quality ? Math.round(envelope.quality * 100) : 0,
            rationale: envelope.summary || null,
            evidence_text: envelope.quote || null,
            evidence_offsets: envelope.location
              ? JSON.stringify(envelope.location)
              : null,
            created_by_ai: 1,
            verified_by_user_id: null,
          })
        );

        const { insertReferenceClaimLinksBulk } = await import(
          "../queries/referenceClaimLinks.js"
        );
        await insertReferenceClaimLinksBulk(query, referenceClaimLinksToInsert);

        console.log(
          `✅ [scrape-reference] Created ${referenceClaimLinksToInsert.length} reference_claim_links for ${referenceContentId}`
        );
      }

      // -----------------------------------------------------------------
      // 6. Return success - no sub-references for references
      // -----------------------------------------------------------------
      return res.json({
        success: true,
        contentId: referenceContentId,
        claimsExtracted: claimIds.length,
        taskClaimLinksCreated: envelope.claimIds?.length || 0,
        references: {
          dom: domRefs,
          ai: [], // References don't create sub-references
        },
      });
    } catch (err) {
      console.error("❌ Error in /api/scrape-reference:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error in /api/scrape-reference",
      });
    }
  });

  return router;
}
