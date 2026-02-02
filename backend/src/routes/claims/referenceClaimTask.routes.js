// backend/src/routes/claims/referenceClaimTask.routes.js
/**
 * Routes for reference claim → task claim relevance assessment
 */
import { Router } from "express";
import { assessClaimRelevance } from "../../core/assessClaimRelevance.js";

export default function createReferenceClaimTaskRoutes({ query, pool }) {
  const router = Router();

  /**
   * GET /api/reference-claim-task-links/:taskClaimId
   * Fetch all reference claim → task claim links for a specific task claim
   */
  router.get("/api/reference-claim-task-links/:taskClaimId", async (req, res) => {
    try {
      const taskClaimId = parseInt(req.params.taskClaimId, 10);

      if (!taskClaimId) {
        return res.status(400).json({ error: "Invalid task claim ID" });
      }

      const links = await query(
        `SELECT
          reference_claim_task_links_id,
          reference_claim_id,
          task_claim_id,
          stance,
          score,
          confidence,
          support_level,
          rationale,
          quote,
          created_by_ai,
          verified_by_user_id,
          created_at
         FROM reference_claim_task_links
         WHERE task_claim_id = ?`,
        [taskClaimId]
      );

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
