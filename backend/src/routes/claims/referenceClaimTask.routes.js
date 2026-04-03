// backend/src/routes/claims/referenceClaimTask.routes.js
/**
 * Routes for reference claim → task claim relevance assessment
 */
import { Router } from "express";
import { assessClaimRelevance } from "../../core/assessClaimRelevance.js";

export default function createReferenceClaimTaskRoutes({ query, pool }) {
  const router = Router();

  /**
   * GET /api/task-claim/reference-links/:taskClaimId
   * Fetch all reference_claim_links (dotted lines) for a specific task claim
   * Returns reference documents that have evidence engine links to this task claim
   */
  router.get("/api/task-claim/reference-links/:taskClaimId", async (req, res) => {
    try {
      const taskClaimId = parseInt(req.params.taskClaimId, 10);

      if (!taskClaimId) {
        return res.status(400).json({ error: "Invalid task claim ID" });
      }

      // Query reference_claim_links to find references with dotted lines
      const links = await query(
        `SELECT
          ref_claim_link_id,
          claim_id,
          reference_content_id,
          stance,
          score,
          rationale,
          evidence_text,
          evidence_offsets,
          created_by_ai,
          verified_by_user_id,
          created_at
         FROM reference_claim_links
         WHERE claim_id = ?`,
        [taskClaimId]
      );

      console.log(`🔗 Found ${links.length} reference document links (dotted lines) for task claim ${taskClaimId}`);

      return res.json(links);
    } catch (err) {
      console.error("❌ /api/task-claim/reference-links/:taskClaimId:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/reference-claim-task-links/:taskClaimId
   * Fetch all reference claim → task claim links for a specific task claim
   * Checks BOTH reference_claim_task_links (AI assessments) AND claim_links (manual links)
   */
  router.get("/api/reference-claim-task-links/:taskClaimId", async (req, res) => {
    try {
      const taskClaimId = parseInt(req.params.taskClaimId, 10);

      if (!taskClaimId) {
        return res.status(400).json({ error: "Invalid task claim ID" });
      }

      // Query both tables and merge results
      // Map claim_links fields to match reference_claim_task_links schema
      // Check BOTH source and target in claim_links (links can be stored either way)
      const links = await query(
        `SELECT
          rctl.reference_claim_task_links_id,
          rctl.reference_claim_id,
          rctl.task_claim_id,
          rctl.stance,
          rctl.score,
          rctl.confidence,
          rctl.support_level,
          rctl.rationale,
          rctl.quote,
          rctl.created_by_ai,
          rctl.verified_by_user_id,
          rctl.created_at,
          'reference_claim_task_links' AS source_table,
          c.claim_text AS reference_claim_text,
          content.media_source AS source_name,
          content.url AS source_url
         FROM reference_claim_task_links rctl
         LEFT JOIN claims c ON rctl.reference_claim_id = c.claim_id
         LEFT JOIN content_claims cc ON c.claim_id = cc.claim_id
         LEFT JOIN content ON cc.content_id = content.content_id
         WHERE rctl.task_claim_id = ?

         UNION ALL

         SELECT
          cl.claim_link_id AS reference_claim_task_links_id,
          cl.source_claim_id AS reference_claim_id,
          cl.target_claim_id AS task_claim_id,
          CASE
            WHEN cl.support_level > 0.5 THEN 'support'
            WHEN cl.support_level < -0.5 THEN 'refute'
            WHEN cl.support_level BETWEEN -0.5 AND 0.5 THEN 'nuance'
            ELSE 'insufficient'
          END AS stance,
          ROUND(ABS(cl.support_level) * 100, 2) AS score,
          COALESCE(cl.confidence, 0.7) AS confidence,
          cl.support_level,
          cl.notes AS rationale,
          NULL AS quote,
          cl.created_by_ai,
          cl.user_id AS verified_by_user_id,
          cl.created_at,
          'claim_links:target' AS source_table,
          c.claim_text AS reference_claim_text,
          content.media_source AS source_name,
          content.url AS source_url
         FROM claim_links cl
         LEFT JOIN claims c ON cl.source_claim_id = c.claim_id
         LEFT JOIN content_claims cc ON c.claim_id = cc.claim_id
         LEFT JOIN content ON cc.content_id = content.content_id
         WHERE cl.target_claim_id = ? AND cl.disabled = 0

         UNION ALL

         SELECT
          cl.claim_link_id AS reference_claim_task_links_id,
          cl.target_claim_id AS reference_claim_id,
          cl.source_claim_id AS task_claim_id,
          CASE
            WHEN cl.support_level > 0.5 THEN 'refute'
            WHEN cl.support_level < -0.5 THEN 'support'
            WHEN cl.support_level BETWEEN -0.5 AND 0.5 THEN 'nuance'
            ELSE 'insufficient'
          END AS stance,
          ROUND(ABS(cl.support_level) * 100, 2) AS score,
          COALESCE(cl.confidence, 0.7) AS confidence,
          -cl.support_level AS support_level,
          cl.notes AS rationale,
          NULL AS quote,
          cl.created_by_ai,
          cl.user_id AS verified_by_user_id,
          cl.created_at,
          'claim_links:source' AS source_table,
          c.claim_text AS reference_claim_text,
          content.media_source AS source_name,
          content.url AS source_url
         FROM claim_links cl
         LEFT JOIN claims c ON cl.target_claim_id = c.claim_id
         LEFT JOIN content_claims cc ON c.claim_id = cc.claim_id
         LEFT JOIN content ON cc.content_id = content.content_id
         WHERE cl.source_claim_id = ? AND cl.disabled = 0`,
        [taskClaimId, taskClaimId, taskClaimId]
      );

      // Debug logging
      const referenceLinks = links.filter(l => l.source_table === 'reference_claim_task_links');
      const claimLinksAsTarget = links.filter(l => l.source_table === 'claim_links:target');
      const claimLinksAsSource = links.filter(l => l.source_table === 'claim_links:source');

      console.log(`🔗 Found ${links.length} total links for task claim ${taskClaimId}:`);
      console.log(`   - ${referenceLinks.length} from reference_claim_task_links`);
      console.log(`   - ${claimLinksAsTarget.length} from claim_links (as target)`);
      console.log(`   - ${claimLinksAsSource.length} from claim_links (as source)`);

      if (links.length > 0) {
        console.log('📋 Sample links:');
        links.slice(0, 3).forEach(link => {
          console.log(`   [${link.source_table}] ref_claim=${link.reference_claim_id} → task=${link.task_claim_id}, stance=${link.stance}, support=${link.support_level}`);
        });
      }

      return res.json(links);
    } catch (err) {
      console.error("❌ /api/reference-claim-task-links/:taskClaimId:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/assess-claim-relevance
   * Assess a single reference claim against a task claim
   * Body: { referenceClaimId, taskClaimId, referenceClaimText, taskClaimText }
   */
  router.post("/api/assess-claim-relevance", async (req, res) => {
    try {
      const {
        referenceClaimId,
        taskClaimId,
        referenceClaimText,
        taskClaimText,
      } = req.body;

      if (!referenceClaimId || !taskClaimId || !referenceClaimText || !taskClaimText) {
        return res.status(400).json({
          error: "Missing required fields",
        });
      }

      console.log(
        `[Assess Claim] Ref claim ${referenceClaimId} → Task claim ${taskClaimId}`
      );

      // Check if assessment already exists
      const existing = await query(
        `SELECT * FROM reference_claim_task_links
         WHERE reference_claim_id = ? AND task_claim_id = ?`,
        [referenceClaimId, taskClaimId]
      );

      if (existing.length > 0) {
        console.log(`[Assess Claim] Using existing assessment`);
        return res.json({ link: existing[0], assessed: false });
      }

      // Run AI assessment
      const assessment = await assessClaimRelevance({
        referenceClaimText,
        taskClaimText,
      });

      // 🎯 FILTER: Don't store irrelevant assessments (insufficient stance with low quality/confidence)
      const isIrrelevant = assessment.stance === 'insufficient' &&
                          (assessment.quality < 0.4 || assessment.confidence < 0.4);

      if (isIrrelevant) {
        console.log(`[Assess Claim] Skipping irrelevant assessment - stance: ${assessment.stance}, quality: ${assessment.quality}, confidence: ${assessment.confidence}`);
        return res.json({
          assessed: true,
          link: null, // No link created - claim is irrelevant
          assessment,
          skipped: true,
          reason: 'insufficient_relevance'
        });
      }

      // Insert into database
      const result = await query(
        `INSERT INTO reference_claim_task_links (
          reference_claim_id,
          task_claim_id,
          stance,
          score,
          confidence,
          support_level,
          rationale,
          quote,
          created_by_ai
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          referenceClaimId,
          taskClaimId,
          assessment.stance,
          Math.round(assessment.quality * 100),
          assessment.confidence,
          assessment.support_level,
          assessment.rationale,
          assessment.quote || null,
          true,
        ]
      );

      // Fetch the created link
      const link = await query(
        `SELECT * FROM reference_claim_task_links
         WHERE reference_claim_task_links_id = ?`,
        [result.insertId]
      );

      console.log(`[Assess Claim] Complete - stance: ${assessment.stance}`);

      return res.json({
        assessed: true,
        link: link[0],
        assessment,
      });
    } catch (err) {
      console.error("❌ /api/assess-claim-relevance:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/reference-claim-links/approve
   * Approve an AI-suggested reference-to-claim link (for Claim Duel)
   * Body: { claim_id, reference_content_id, user_id, stance, support_level }
   */
  router.post("/api/reference-claim-links/approve", async (req, res) => {
    try {
      const { claim_id, reference_content_id, user_id, stance, support_level } = req.body;

      if (!claim_id || !reference_content_id || !user_id) {
        return res.status(400).json({
          error: "Missing required fields: claim_id, reference_content_id, user_id"
        });
      }

      console.log(`[Approve Link] User ${user_id} approving ref ${reference_content_id} → claim ${claim_id} with stance: ${stance}`);

      // Update the existing AI-suggested link to mark it as verified
      const result = await query(
        `UPDATE reference_claim_links
         SET verified_by_user_id = ?,
             stance = COALESCE(?, stance),
             support_level = COALESCE(?, support_level),
             verified_at = NOW()
         WHERE claim_id = ? AND reference_content_id = ?`,
        [user_id, stance, support_level, claim_id, reference_content_id]
      );

      if (result.affectedRows === 0) {
        // No existing link found - create a new one
        await query(
          `INSERT INTO reference_claim_links (
            claim_id,
            reference_content_id,
            stance,
            support_level,
            verified_by_user_id,
            created_by_ai,
            verified_at
          ) VALUES (?, ?, ?, ?, ?, false, NOW())`,
          [claim_id, reference_content_id, stance || 'support', support_level || 1.0, user_id]
        );
        console.log(`[Approve Link] Created new link`);
      } else {
        console.log(`[Approve Link] Updated existing AI link to user-verified`);
      }

      // Fetch the updated/created link
      const link = await query(
        `SELECT * FROM reference_claim_links
         WHERE claim_id = ? AND reference_content_id = ? AND verified_by_user_id = ?`,
        [claim_id, reference_content_id, user_id]
      );

      return res.json({
        success: true,
        link: link[0]
      });
    } catch (err) {
      console.error("❌ /api/reference-claim-links/approve:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/reassess-claim-relevance
   * Delete existing assessment and create new one with optional custom prompts
   * Body: { referenceClaimId, taskClaimId, referenceClaimText, taskClaimText, systemPrompt?, customInstructions? }
   */
  router.post("/api/reassess-claim-relevance", async (req, res) => {
    try {
      const {
        referenceClaimId,
        taskClaimId,
        referenceClaimText,
        taskClaimText,
        systemPrompt,
        customInstructions,
      } = req.body;

      if (!referenceClaimId || !taskClaimId || !referenceClaimText || !taskClaimText) {
        return res.status(400).json({
          error: "Missing required fields",
        });
      }

      console.log(
        `[Reassess Claim] Ref claim ${referenceClaimId} → Task claim ${taskClaimId}`
      );

      // Delete existing assessment
      await query(
        `DELETE FROM reference_claim_task_links
         WHERE reference_claim_id = ? AND task_claim_id = ?`,
        [referenceClaimId, taskClaimId]
      );

      console.log(`[Reassess Claim] Deleted existing assessment`);

      // Run AI assessment with custom prompts if provided
      const assessment = await assessClaimRelevance({
        referenceClaimText,
        taskClaimText,
        systemPrompt,
        customInstructions,
      });

      // Insert new assessment into database
      const result = await query(
        `INSERT INTO reference_claim_task_links (
          reference_claim_id,
          task_claim_id,
          stance,
          score,
          confidence,
          support_level,
          rationale,
          quote,
          created_by_ai
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          referenceClaimId,
          taskClaimId,
          assessment.stance,
          Math.round(assessment.quality * 100),
          assessment.confidence,
          assessment.support_level,
          assessment.rationale,
          assessment.quote || null,
          true,
        ]
      );

      // Fetch the created link
      const link = await query(
        `SELECT * FROM reference_claim_task_links
         WHERE reference_claim_task_links_id = ?`,
        [result.insertId]
      );

      console.log(`[Reassess Claim] Complete - new stance: ${assessment.stance}`);

      return res.json({
        reassessed: true,
        link: link[0],
        assessment,
      });
    } catch (err) {
      console.error("❌ /api/reassess-claim-relevance:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
