/**
 * Content Rating Evaluation Routes
 *
 * Level 1: Users create content_ratings (evidence chains for content)
 * Level 2: Peer evaluation - 2+ approvals needed to pass
 * Level 3: User reputation aggregates track record
 */

import { Router } from "express";
import { authenticateToken } from "../../middleware/auth.js";

export default function createContentRatingRouter({ query, pool }) {
  const router = Router();

  // Helper: Get user's role level (higher number = more senior)
  const getRoleLevel = async (userId) => {
    const roles = await query(
      `
      SELECT r.name, r.role_id
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.role_id
      WHERE ur.user_id = ?
      ORDER BY r.role_id DESC
      LIMIT 1
    `,
      [userId],
    );

    if (roles.length === 0) return { name: "user", level: 10 };

    const roleHierarchy = {
      super_admin: 100,
      admin: 50,
      moderator: 30,
      trusted: 20,
      user: 10,
      guest: 0,
    };

    return {
      name: roles[0].name,
      level: roleHierarchy[roles[0].name] || 10,
    };
  };

  const isSuperAdminRole = (role) => role?.name === "super_admin";

  /**
   * POST /api/content-rating/submit
   * User submits their evidence chain for approval
   */
  router.post(
    "/api/content-rating/submit",
    authenticateToken,
    async (req, res) => {
      try {
        const userId = req.user.user_id;
        const { content_id, claim_link_ids } = req.body;

        if (!content_id) {
          return res.status(400).json({ error: "content_id required" });
        }

        if (!Array.isArray(claim_link_ids) || claim_link_ids.length === 0) {
          return res.status(400).json({
            error: "claim_link_ids must be a non-empty array",
          });
        }

        const cleanedClaimLinkIds = [
          ...new Set(claim_link_ids.map(Number)),
        ].filter((id) => Number.isInteger(id) && id > 0);

        if (cleanedClaimLinkIds.length === 0) {
          return res.status(400).json({
            error: "No valid claim_link_ids provided",
          });
        }

        const claimLinkPlaceholders = cleanedClaimLinkIds
          .map(() => "?")
          .join(",");

        // Validate that all selected claim links belong to this content
        const claimLinks = await query(
          `
          SELECT COUNT(DISTINCT cl.claim_link_id) AS link_count
          FROM claim_links cl
          JOIN content_claims cc
            ON cc.claim_id = cl.target_claim_id
          WHERE cl.claim_link_id IN (${claimLinkPlaceholders})
            AND cc.content_id = ?
            AND cl.disabled = 0
        `,
          [...cleanedClaimLinkIds, content_id],
        );

        if (claimLinks[0].link_count === 0) {
          return res.status(400).json({
            error: "No evidence chain found. Create claim links first.",
          });
        }

        if (claimLinks[0].link_count !== cleanedClaimLinkIds.length) {
          return res.status(400).json({
            error:
              "One or more selected claim links are invalid for this content.",
          });
        }

        // Create or update content_rating and force insertId to be the content_rating_id
        const upsertResult = await query(
          `
          INSERT INTO content_ratings (
            content_id,
            user_id,
            completed,
            submitted_at,
            approval_status
          )
          VALUES (?, ?, TRUE, NOW(), 'pending')
          ON DUPLICATE KEY UPDATE
            completed = TRUE,
            submitted_at = NOW(),
            approval_status = 'pending',
            content_rating_id = LAST_INSERT_ID(content_rating_id)
        `,
          [content_id, userId],
        );

        const contentRatingId = upsertResult.insertId;

        // Replace lookup rows for this content rating
        await query(
          `
          DELETE FROM content_rating_claim_links
          WHERE content_rating_id = ?
        `,
          [contentRatingId],
        );

        const lookupValues = cleanedClaimLinkIds.map(() => "(?, ?)").join(",");

        await query(
          `
          INSERT INTO content_rating_claim_links (
            content_rating_id,
            claim_link_id
          )
          VALUES ${lookupValues}
        `,
          cleanedClaimLinkIds.flatMap((claimLinkId) => [
            contentRatingId,
            claimLinkId,
          ]),
        );

        res.json({
          success: true,
          message: "Evidence chain submitted for approval",
          data: {
            content_rating_id: contentRatingId,
            claim_link_count: cleanedClaimLinkIds.length,
          },
        });
      } catch (error) {
        console.error("Error submitting content rating:", error);
        res
          .status(500)
          .json({ error: error.message || "Failed to submit content rating" });
      }
    },
  );

  /**
   * GET /api/content-rating/my-rating/:contentId
   * Get current user's content rating for specific content
   */
  router.get(
    "/api/content-rating/my-rating/:contentId",
    authenticateToken,
    async (req, res) => {
      try {
        const userId = req.user.user_id;
        const contentId = parseInt(req.params.contentId);

        if (!contentId) {
          return res.status(400).json({ error: "contentId required" });
        }

        const contentRatings = await query(
          `
        SELECT * FROM content_ratings
        WHERE content_id = ? AND user_id = ?
      `,
          [contentId, userId],
        );

        res.json({
          success: true,
          data: {
            content_rating:
              contentRatings.length > 0 ? contentRatings[0] : null,
          },
        });
      } catch (error) {
        console.error("Error fetching user content rating:", error);
        res
          .status(500)
          .json({ error: error.message || "Failed to fetch rating" });
      }
    },
  );

  /**
   * GET /api/content-rating/pending
   * Get users with pending content ratings (for evaluation)
   * Only shows users with same or lower role level
   */
  router.get(
    "/api/content-rating/pending",
    authenticateToken,
    async (req, res) => {
      try {
        const evaluatorId = req.user.user_id;
        const evaluatorRole = await getRoleLevel(evaluatorId);

        const pendingRatings = await query(
          `
          SELECT
            cr.content_rating_id,
            cr.content_id,
            cr.user_id,
            u.username,
            u.email,
            c.url AS content_url,
            cr.votes_approve,
            cr.votes_reject,
            cr.total_votes,
            cr.avg_evaluation_score,
            cr.submitted_at,
            cr.created_at,
            COUNT(DISTINCT crcl.claim_link_id) AS claim_link_count,
            COALESCE(r.name, 'user') AS user_role,
            COALESCE(ur_rep.veracity_rating, 50) AS user_veracity,
            EXISTS (
              SELECT 1
              FROM content_rating_evaluations cre
              WHERE cre.content_rating_id = cr.content_rating_id
                AND cre.evaluator_user_id = ?
            ) AS already_evaluated
          FROM content_ratings cr
          JOIN users u
            ON cr.user_id = u.user_id
          JOIN content c
            ON cr.content_id = c.content_id
          LEFT JOIN content_rating_claim_links crcl
            ON crcl.content_rating_id = cr.content_rating_id
          LEFT JOIN claim_links cl
            ON cl.claim_link_id = crcl.claim_link_id
          LEFT JOIN user_roles ur
            ON u.user_id = ur.user_id
          LEFT JOIN roles r
            ON ur.role_id = r.role_id
          LEFT JOIN user_reputation ur_rep
            ON u.user_id = ur_rep.user_id
          WHERE cr.completed = TRUE
            AND cr.approval_status = 'pending'
          GROUP BY
            cr.content_rating_id,
            cr.content_id,
            cr.user_id,
            u.username,
            u.email,
            c.url,
            cr.votes_approve,
            cr.votes_reject,
            cr.total_votes,
            cr.avg_evaluation_score,
            cr.submitted_at,
            cr.created_at,
            r.name,
            ur_rep.veracity_rating
          ORDER BY cr.submitted_at ASC
          LIMIT 10
        `,
          [evaluatorId],
        );

        const roleHierarchy = {
          super_admin: 100,
          admin: 50,
          moderator: 30,
          trusted: 20,
          user: 10,
          guest: 0,
        };

        const filteredRatings = pendingRatings
          .map((rating) => ({
            ...rating,
            role_level: roleHierarchy[rating.user_role] || 10,
          }))
          .filter((rating) => rating.role_level <= evaluatorRole.level);

        res.json({
          success: true,
          data: {
            ratings: filteredRatings,
            evaluator_role: evaluatorRole,
          },
        });
      } catch (error) {
        console.error("Error fetching pending ratings:", error);
        res.status(500).json({ error: error.message || "Failed to fetch" });
      }
    },
  );

  /**
   * GET /api/content-rating/:contentRatingId
   * Get detailed evidence chain for evaluation
   */
  router.get(
    "/api/content-rating/:contentRatingId",
    authenticateToken,
    async (req, res) => {
      try {
        const contentRatingId = parseInt(req.params.contentRatingId);
        const evaluatorId = req.user.user_id;

        const contentRatings = await query(
          `
          SELECT
            cr.*,
            u.username,
            u.email,
            c.url AS content_url,
            COALESCE(r.name, 'user') AS user_role
          FROM content_ratings cr
          JOIN users u
            ON cr.user_id = u.user_id
          JOIN content c
            ON cr.content_id = c.content_id
          LEFT JOIN user_roles ur
            ON u.user_id = ur.user_id
          LEFT JOIN roles r
            ON ur.role_id = r.role_id
          WHERE cr.content_rating_id = ?
        `,
          [contentRatingId],
        );

        if (contentRatings.length === 0) {
          return res.status(404).json({ error: "Content rating not found" });
        }

        const contentRating = contentRatings[0];

        const evaluatorRole = await getRoleLevel(evaluatorId);
        const subjectRole = await getRoleLevel(contentRating.user_id);

        if (subjectRole.level > evaluatorRole.level) {
          return res.status(403).json({
            error: "Cannot evaluate users with higher role level",
          });
        }

        const claimLinks = await query(
          `
          SELECT
            cl.*,
            crcl.content_rating_claim_link_id,
            source_claim.claim_text AS source_claim_text,
            target_claim.claim_text AS target_claim_text,

            (
              SELECT c.url
              FROM content_claims cc
              JOIN content c ON cc.content_id = c.content_id
              WHERE cc.claim_id = cl.source_claim_id
              LIMIT 1
            ) AS source_url,

            (
              SELECT TRIM(CONCAT(
                IFNULL(a.author_first_name, ''),
                ' ',
                IFNULL(a.author_last_name, '')
              ))
              FROM content_claims cc
              JOIN content_authors ca ON cc.content_id = ca.content_id
              JOIN authors a ON ca.author_id = a.author_id
              WHERE cc.claim_id = cl.source_claim_id
              LIMIT 1
            ) AS author_name,

            (
              SELECT p.publisher_name
              FROM content_claims cc
              JOIN content_publishers cp ON cc.content_id = cp.content_id
              JOIN publishers p ON cp.publisher_id = p.publisher_id
              WHERE cc.claim_id = cl.source_claim_id
              LIMIT 1
            ) AS publisher_name

          FROM content_rating_claim_links crcl
          JOIN claim_links cl
            ON cl.claim_link_id = crcl.claim_link_id
          JOIN claims source_claim
            ON cl.source_claim_id = source_claim.claim_id
          JOIN claims target_claim
            ON cl.target_claim_id = target_claim.claim_id
          WHERE crcl.content_rating_id = ?
          ORDER BY cl.created_at ASC
        `,
          [contentRatingId],
        );

        const evaluations = await query(
          `
          SELECT
            e.*,
            u.username AS evaluator_username,
            COALESCE(r.name, 'user') AS evaluator_role
          FROM content_rating_evaluations e
          JOIN users u
            ON e.evaluator_user_id = u.user_id
          LEFT JOIN user_roles ur
            ON u.user_id = ur.user_id
          LEFT JOIN roles r
            ON ur.role_id = r.role_id
          WHERE e.content_rating_id = ?
          ORDER BY e.created_at DESC
        `,
          [contentRatingId],
        );

        const canEvaluate =
          isSuperAdminRole(evaluatorRole) || evaluatorId !== contentRating.user_id;

        res.json({
          success: true,
          data: {
            content_rating: contentRating,
            claim_links: claimLinks,
            evaluations: evaluations,
            can_evaluate: canEvaluate,
          },
        });
      } catch (error) {
        console.error("Error fetching content rating details:", error);
        res
          .status(500)
          .json({ error: error.message || "Failed to fetch details" });
      }
    },
  );

  /**
   * POST /api/content-rating/evaluate
   * Submit evaluation for a content rating
   */
  router.post(
    "/api/content-rating/evaluate",
    authenticateToken,
    async (req, res) => {
      try {
        const evaluatorId = req.user.user_id;
        const {
          content_rating_id,
          score, // -99 to +99
          notes,
        } = req.body;

        // Validation
        if (score < -99 || score > 99) {
          return res
            .status(400)
            .json({ error: "Score must be between -99 and +99" });
        }

        // Get content rating
        const contentRatings = await query(
          "SELECT * FROM content_ratings WHERE content_rating_id = ?",
          [content_rating_id],
        );

        if (contentRatings.length === 0) {
          return res.status(404).json({ error: "Content rating not found" });
        }

        const contentRating = contentRatings[0];

        // Check role hierarchy
        const evaluatorRole = await getRoleLevel(evaluatorId);
        const subjectRole = await getRoleLevel(contentRating.user_id);

        // Super admins can evaluate any pending chain, including chains they
        // created while operating the platform.
        if (
          contentRating.user_id === evaluatorId &&
          !isSuperAdminRole(evaluatorRole)
        ) {
          return res
            .status(400)
            .json({ error: "Cannot evaluate your own content rating" });
        }

        if (subjectRole.level > evaluatorRole.level) {
          return res.status(403).json({
            error: "Cannot evaluate users with higher role level",
          });
        }

        // Check if already evaluated
        const existing = await query(
          "SELECT * FROM content_rating_evaluations WHERE content_rating_id = ? AND evaluator_user_id = ?",
          [content_rating_id, evaluatorId],
        );

        if (existing.length > 0) {
          return res
            .status(400)
            .json({ error: "You already evaluated this content rating" });
        }

        // Determine vote from score
        const vote = score >= 0 ? "approve" : "reject";

        // Calculate points
        const evaluatorPoints = 15; // Base points for evaluating
        const subjectPoints = score >= 0 ? Math.min(score, 50) : 0;

        // Insert evaluation
        await query(
          `
        INSERT INTO content_rating_evaluations (
          content_rating_id,
          evaluator_user_id,
          score,
          vote,
          notes,
          evaluator_points,
          subject_points
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
          [
            content_rating_id,
            evaluatorId,
            score,
            vote,
            notes,
            evaluatorPoints,
            subjectPoints,
          ],
        );

        // Get updated content rating status
        const updated = await query(
          "SELECT * FROM content_ratings WHERE content_rating_id = ?",
          [content_rating_id],
        );

        res.json({
          success: true,
          message: "Evaluation submitted successfully",
          data: {
            vote,
            score,
            evaluator_points: evaluatorPoints,
            new_status: updated[0].approval_status,
            votes_approve: updated[0].votes_approve,
            votes_reject: updated[0].votes_reject,
          },
        });
      } catch (error) {
        console.error("Error submitting evaluation:", error);
        res
          .status(500)
          .json({ error: error.message || "Failed to submit evaluation" });
      }
    },
  );

  /**
   * GET /api/content-rating/user/:userId/reputation
   * Get user's reputation and track record
   */
  router.get(
    "/api/content-rating/user/:userId/reputation",
    authenticateToken,
    async (req, res) => {
      try {
        const userId = parseInt(req.params.userId);

        // Get reputation
        const reputation = await query(
          `
        SELECT * FROM user_reputation WHERE user_id = ?
      `,
          [userId],
        );

        // Get recent content ratings
        const recentRatings = await query(
          `
        SELECT
          cr.*,
          c.url as content_url
        FROM content_ratings cr
        JOIN content c ON cr.content_id = c.content_id
        WHERE cr.user_id = ?
        ORDER BY cr.created_at DESC
        LIMIT 10
      `,
          [userId],
        );

        res.json({
          success: true,
          data: {
            reputation: reputation[0] || null,
            recent_ratings: recentRatings,
          },
        });
      } catch (error) {
        console.error("Error fetching user reputation:", error);
        res
          .status(500)
          .json({ error: error.message || "Failed to fetch reputation" });
      }
    },
  );

  /**
   * GET /api/content-rating/leaderboard
   * Get top users by reputation
   */
  router.get(
    "/api/content-rating/leaderboard",
    authenticateToken,
    async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 20;

        const leaderboard = await query(
          `
        SELECT * FROM v_reputation_leaderboard
        LIMIT ?
      `,
          [limit],
        );

        res.json({
          success: true,
          data: {
            leaderboard,
          },
        });
      } catch (error) {
        console.error("Error fetching leaderboard:", error);
        res
          .status(500)
          .json({ error: error.message || "Failed to fetch leaderboard" });
      }
    },
  );

  return router;
}
