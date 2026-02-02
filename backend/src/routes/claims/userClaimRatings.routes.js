// backend/src/routes/claims/userClaimRatings.routes.js
/**
 * Routes for user claim quality ratings and scoring
 */
import { Router } from "express";

export default function createUserClaimRatingsRoutes({ query, pool }) {
  const router = Router();

  /**
   * POST /api/user-claim-rating
   * Submit user's quality rating for a reference claim
   * Body: { userId, referenceClaimId, taskClaimId, userQualityRating }
   */
  router.post("/api/user-claim-rating", async (req, res) => {
    try {
      const { userId, referenceClaimId, taskClaimId, userQualityRating } =
        req.body;

      if (
        !userId ||
        !referenceClaimId ||
        !taskClaimId ||
        userQualityRating === undefined
      ) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Get AI's assessment for comparison
      const aiAssessment = await query(
        `SELECT score, confidence, stance
         FROM reference_claim_task_links
         WHERE reference_claim_id = ? AND task_claim_id = ?`,
        [referenceClaimId, taskClaimId]
      );

      let aiQualityRating = null;
      let aiStance = null;
      let honestyScore = null;

      if (aiAssessment.length > 0) {
        aiQualityRating = aiAssessment[0].score;
        aiStance = aiAssessment[0].stance;

        // Calculate honesty score (how close to AI)
        const gap = Math.abs(userQualityRating - aiQualityRating);
        honestyScore = Math.max(0, 100 - gap);
      }

      // Check if rating already exists
      const existing = await query(
        `SELECT user_claim_rating_id FROM user_claim_ratings
         WHERE user_id = ? AND reference_claim_id = ? AND task_claim_id = ?`,
        [userId, referenceClaimId, taskClaimId]
      );

      if (existing.length > 0) {
        // Update existing rating
        await query(
          `UPDATE user_claim_ratings SET
           user_quality_rating = ?,
           ai_quality_rating = ?,
           ai_stance = ?,
           honesty_score = ?
           WHERE user_claim_rating_id = ?`,
          [
            userQualityRating,
            aiQualityRating,
            aiStance,
            honestyScore,
            existing[0].user_claim_rating_id,
          ]
        );

        return res.json({
          success: true,
          updated: true,
          honestyScore,
        });
      }

      // Insert new rating
      await query(
        `INSERT INTO user_claim_ratings (
          user_id,
          reference_claim_id,
          task_claim_id,
          user_quality_rating,
          ai_quality_rating,
          ai_stance,
          honesty_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          referenceClaimId,
          taskClaimId,
          userQualityRating,
          aiQualityRating,
          aiStance,
          honestyScore,
        ]
      );

      return res.json({
        success: true,
        honestyScore,
        aiQualityRating,
      });
    } catch (err) {
      console.error("❌ /api/user-claim-rating:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/user-claim-ratings/:userId/:taskClaimId
   * Get all user ratings for a task claim session
   */
  router.get("/api/user-claim-ratings/:userId/:taskClaimId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId, 10);
      const taskClaimId = parseInt(req.params.taskClaimId, 10);

      const ratings = await query(
        `SELECT
          user_claim_rating_id,
          reference_claim_id,
          user_quality_rating,
          ai_quality_rating,
          ai_stance,
          honesty_score,
          created_at
         FROM user_claim_ratings
         WHERE user_id = ? AND task_claim_id = ?
         ORDER BY created_at ASC`,
        [userId, taskClaimId]
      );

      return res.json(ratings);
    } catch (err) {
      console.error("❌ /api/user-claim-ratings/:userId/:taskClaimId:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/preponderance/:taskClaimId
   * Calculate what the evidence actually says (preponderance)
   */
  router.get("/api/preponderance/:taskClaimId", async (req, res) => {
    try {
      const taskClaimId = parseInt(req.params.taskClaimId, 10);

      // Get all reference claim links for this task claim
      const links = await query(
        `SELECT
          score,
          confidence,
          stance
         FROM reference_claim_task_links
         WHERE task_claim_id = ?`,
        [taskClaimId]
      );

      if (links.length === 0) {
        return res.json({
          evidenceTruthScore: 50, // Neutral
          totalWeight: 0,
          breakdown: {
            supports: 0,
            refutes: 0,
            nuances: 0,
            insufficient: 0,
          },
        });
      }

      // Calculate preponderance
      let supportWeight = 0;
      let refuteWeight = 0;
      let nuanceWeight = 0;

      const breakdown = {
        supports: 0,
        refutes: 0,
        nuances: 0,
        insufficient: 0,
      };

      links.forEach((link) => {
        const weight = link.score * link.confidence;

        switch (link.stance) {
          case "support":
            supportWeight += weight;
            breakdown.supports++;
            break;
          case "refute":
            refuteWeight += weight;
            breakdown.refutes++;
            break;
          case "nuance":
            nuanceWeight += weight * 0.5;
            breakdown.nuances++;
            break;
          case "insufficient":
            breakdown.insufficient++;
            break;
        }
      });

      const totalWeight = supportWeight + refuteWeight + nuanceWeight;

      // Calculate truth score
      const adjustedSupport = supportWeight + nuanceWeight * 0.5;
      const adjustedRefute = refuteWeight + nuanceWeight * 0.5;

      let evidenceTruthScore = 50;
      if (totalWeight > 0) {
        evidenceTruthScore =
          (adjustedSupport / (adjustedSupport + adjustedRefute)) * 100;
      }

      return res.json({
        evidenceTruthScore: Math.round(evidenceTruthScore),
        totalWeight,
        supportWeight,
        refuteWeight,
        nuanceWeight,
        breakdown,
      });
    } catch (err) {
      console.error("❌ /api/preponderance/:taskClaimId:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/calculate-session-score
   * Calculate user's score for a task claim session
   * Body: { userId, taskClaimId, userFinalRating, priorBelief }
   */
  router.post("/api/calculate-session-score", async (req, res) => {
    try {
      const { userId, taskClaimId, userFinalRating, priorBelief } = req.body;

      // Get preponderance (what evidence says)
      const preponderanceRes = await query(
        `SELECT
          score,
          confidence,
          stance
         FROM reference_claim_task_links
         WHERE task_claim_id = ?`,
        [taskClaimId]
      );

      // Calculate evidence truth score
      let supportWeight = 0;
      let refuteWeight = 0;
      let nuanceWeight = 0;

      preponderanceRes.forEach((link) => {
        const weight = link.score * link.confidence;
        switch (link.stance) {
          case "support":
            supportWeight += weight;
            break;
          case "refute":
            refuteWeight += weight;
            break;
          case "nuance":
            nuanceWeight += weight * 0.5;
            break;
        }
      });

      const adjustedSupport = supportWeight + nuanceWeight * 0.5;
      const adjustedRefute = refuteWeight + nuanceWeight * 0.5;
      const evidenceTruthScore =
        (adjustedSupport / (adjustedSupport + adjustedRefute)) * 100;

      // Get user's honesty ratings
      const userRatings = await query(
        `SELECT user_quality_rating, ai_quality_rating, honesty_score
         FROM user_claim_ratings
         WHERE user_id = ? AND task_claim_id = ?`,
        [userId, taskClaimId]
      );

      // Calculate scores
      const accuracyGap = Math.abs(userFinalRating - evidenceTruthScore);
      const accuracyScore = Math.max(0, 100 - accuracyGap);

      const avgHonesty =
        userRatings.length > 0
          ? userRatings.reduce((sum, r) => sum + r.honesty_score, 0) /
            userRatings.length
          : 0;

      const beliefShift = Math.abs(userFinalRating - priorBelief);
      const movedTowardEvidence =
        Math.abs(userFinalRating - evidenceTruthScore) <
        Math.abs(priorBelief - evidenceTruthScore);

      let mindChangeBonus = 0;
      if (beliefShift > 20) {
        mindChangeBonus = movedTowardEvidence ? 75 : 25;
      }

      const totalScore = accuracyScore + avgHonesty + mindChangeBonus;

      return res.json({
        totalScore: Math.round(totalScore),
        breakdown: {
          accuracyScore: Math.round(accuracyScore),
          honestyScore: Math.round(avgHonesty),
          mindChangeBonus,
        },
        evidenceTruthScore: Math.round(evidenceTruthScore),
        gap: Math.round(accuracyGap),
      });
    } catch (err) {
      console.error("❌ /api/calculate-session-score:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
