/**
 * Rating Evaluation Routes - Hierarchical peer review system
 * Users can evaluate ratings from users with same or lower role level
 */

import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';

export default function createEvaluationRouter({ query, pool }) {
  const router = Router();

  // Helper: Get user's role level (higher number = more senior)
  const getRoleLevel = async (userId) => {
    const roles = await query(`
      SELECT r.name, r.role_id
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.role_id
      WHERE ur.user_id = ?
      ORDER BY r.role_id DESC
      LIMIT 1
    `, [userId]);

    if (roles.length === 0) return { name: 'user', level: 10 };

    // Define role hierarchy (higher = more senior)
    const roleHierarchy = {
      'super_admin': 100,
      'admin': 50,
      'moderator': 30,
      'trusted': 20,
      'user': 10,
      'guest': 0
    };

    return {
      name: roles[0].name,
      level: roleHierarchy[roles[0].name] || 10
    };
  };

  /**
   * GET /api/evaluation/users-with-ratings
   * Get top 5 users with pending ratings (unapproved on top)
   * Only shows users with same or lower role level
   */
  router.get('/api/evaluation/users-with-ratings', authenticateToken, async (req, res) => {
    try {
      const evaluatorId = req.user.user_id;
      const evaluatorRole = await getRoleLevel(evaluatorId);

      // Get all users with their role levels and pending rating counts
      const usersWithRatings = await query(`
        SELECT
          u.user_id,
          u.username,
          u.email,
          COALESCE(r.name, 'user') as role_name,
          COUNT(DISTINCT ucr.user_claim_rating_id) as pending_count,
          COUNT(DISTINCT ucr2.user_claim_rating_id) as total_count,
          AVG(ucr.honesty_score) as avg_honesty_score
        FROM users u
        LEFT JOIN user_roles ur ON u.user_id = ur.user_id
        LEFT JOIN roles r ON ur.role_id = r.role_id
        LEFT JOIN user_claim_ratings ucr ON u.user_id = ucr.user_id
          AND ucr.approval_status = 'pending'
        LEFT JOIN user_claim_ratings ucr2 ON u.user_id = ucr2.user_id
        WHERE u.user_id != ?
        GROUP BY u.user_id, u.username, u.email, r.name
        HAVING pending_count > 0
        ORDER BY pending_count DESC, avg_honesty_score ASC
        LIMIT 5
      `, [evaluatorId]);

      // Filter by role level and add role hierarchy info
      const roleHierarchy = {
        'super_admin': 100,
        'admin': 50,
        'moderator': 30,
        'trusted': 20,
        'user': 10,
        'guest': 0
      };

      const filteredUsers = usersWithRatings
        .map(user => ({
          ...user,
          role_level: roleHierarchy[user.role_name] || 10
        }))
        .filter(user => user.role_level <= evaluatorRole.level);

      res.json({
        success: true,
        data: {
          users: filteredUsers,
          evaluator_role: evaluatorRole
        }
      });

    } catch (error) {
      console.error('Error fetching users with ratings:', error);
      res.status(500).json({
        error: error.message || 'Failed to fetch users'
      });
    }
  });

  /**
   * GET /api/evaluation/user-ratings/:userId
   * Get all ratings by a specific user (pending first)
   */
  router.get('/api/evaluation/user-ratings/:userId', authenticateToken, async (req, res) => {
    try {
      const targetUserId = parseInt(req.params.userId);
      const evaluatorId = req.user.user_id;

      // Check role hierarchy
      const evaluatorRole = await getRoleLevel(evaluatorId);
      const targetRole = await getRoleLevel(targetUserId);

      if (targetRole.level > evaluatorRole.level) {
        return res.status(403).json({
          error: 'Cannot evaluate ratings from users with higher role level',
          your_role: evaluatorRole.name,
          their_role: targetRole.name
        });
      }

      // Get user info
      const users = await query(
        'SELECT user_id, username, email, registered_at FROM users WHERE user_id = ?',
        [targetUserId]
      );

      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get claim ratings (pending first)
      const claimRatings = await query(`
        SELECT
          ucr.*,
          rc.claim_text as reference_claim_text,
          tc.claim_text as task_claim_text,
          c.title as content_title,
          c.url as content_url
        FROM user_claim_ratings ucr
        LEFT JOIN claims rc ON ucr.reference_claim_id = rc.claim_id
        LEFT JOIN claims tc ON ucr.task_claim_id = tc.claim_id
        LEFT JOIN content_claims cc ON tc.claim_id = cc.claim_id
        LEFT JOIN content c ON cc.content_id = c.content_id
        WHERE ucr.user_id = ?
        ORDER BY
          CASE ucr.approval_status
            WHEN 'pending' THEN 0
            WHEN 'approved' THEN 1
            WHEN 'rejected' THEN 2
          END,
          ucr.created_at DESC
        LIMIT 50
      `, [targetUserId]);

      // Calculate stats
      const pendingCount = claimRatings.filter(r => r.approval_status === 'pending').length;
      const approvedCount = claimRatings.filter(r => r.approval_status === 'approved').length;
      const rejectedCount = claimRatings.filter(r => r.approval_status === 'rejected').length;
      const avgHonestyScore = claimRatings.length > 0
        ? claimRatings.reduce((sum, r) => sum + (r.honesty_score || 0), 0) / claimRatings.length
        : 0;

      res.json({
        success: true,
        data: {
          user: {
            ...users[0],
            role_name: targetRole.name,
            role_level: targetRole.level
          },
          ratings: claimRatings,
          stats: {
            total_ratings: claimRatings.length,
            pending_count: pendingCount,
            approved_count: approvedCount,
            rejected_count: rejectedCount,
            average_honesty_score: avgHonestyScore.toFixed(2)
          }
        }
      });

    } catch (error) {
      console.error('Error fetching user ratings:', error);
      res.status(500).json({
        error: error.message || 'Failed to fetch user ratings'
      });
    }
  });

  /**
   * POST /api/evaluation/submit-evaluation
   * Submit evaluation for a rating (-99 to +99 with notes)
   */
  router.post('/api/evaluation/submit-evaluation', authenticateToken, async (req, res) => {
    try {
      const {
        rating_id,
        evaluation_score, // -99 to +99
        notes
      } = req.body;

      const evaluatorId = req.user.user_id;

      // Validate score
      if (evaluation_score < -99 || evaluation_score > 99) {
        return res.status(400).json({ error: 'Score must be between -99 and +99' });
      }

      // Get the rating
      const ratings = await query(
        'SELECT * FROM user_claim_ratings WHERE user_claim_rating_id = ?',
        [rating_id]
      );

      if (ratings.length === 0) {
        return res.status(404).json({ error: 'Rating not found' });
      }

      const rating = ratings[0];

      // Check role hierarchy
      const evaluatorRole = await getRoleLevel(evaluatorId);
      const targetRole = await getRoleLevel(rating.user_id);

      if (targetRole.level > evaluatorRole.level) {
        return res.status(403).json({
          error: 'Cannot evaluate ratings from users with higher role level'
        });
      }

      // Update rating with evaluation
      const newStatus = evaluation_score >= 0 ? 'approved' : 'rejected';
      const userPoints = evaluation_score >= 0 ? Math.min(evaluation_score, 50) : 0;

      await query(`
        UPDATE user_claim_ratings
        SET
          approval_status = ?,
          user_points = ?,
          reviewed_by_user_id = ?,
          reviewed_at = NOW(),
          reviewer_notes = ?
        WHERE user_claim_rating_id = ?
      `, [newStatus, userPoints, evaluatorId, notes, rating_id]);

      // Award points to evaluator
      const evaluatorPoints = 15; // Base points for doing evaluation

      res.json({
        success: true,
        data: {
          rating_id,
          new_status: newStatus,
          user_points: userPoints,
          evaluator_points: evaluatorPoints,
          evaluation_score
        }
      });

    } catch (error) {
      console.error('Error submitting evaluation:', error);
      res.status(500).json({
        error: error.message || 'Failed to submit evaluation'
      });
    }
  });

  /**
   * GET /api/evaluation/user-performance/:userId
   * Get user's past performance for evaluation
   */
  router.get('/api/evaluation/user-performance/:userId', authenticateToken, async (req, res) => {
    try {
      const targetUserId = parseInt(req.params.userId);

      // Get overall stats
      const stats = await query(`
        SELECT
          COUNT(*) as total_ratings,
          AVG(honesty_score) as avg_honesty_score,
          SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) as approved_count,
          SUM(CASE WHEN approval_status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
          SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
          SUM(user_points) as total_points_earned
        FROM user_claim_ratings
        WHERE user_id = ?
      `, [targetUserId]);

      // Get recent evaluations
      const recentEvals = await query(`
        SELECT
          ucr.user_claim_rating_id,
          ucr.honesty_score,
          ucr.approval_status,
          ucr.user_points,
          ucr.reviewer_notes,
          ucr.reviewed_at,
          u.username as reviewer_username
        FROM user_claim_ratings ucr
        LEFT JOIN users u ON ucr.reviewed_by_user_id = u.user_id
        WHERE ucr.user_id = ?
        AND ucr.approval_status != 'pending'
        ORDER BY ucr.reviewed_at DESC
        LIMIT 10
      `, [targetUserId]);

      res.json({
        success: true,
        data: {
          stats: stats[0],
          recent_evaluations: recentEvals
        }
      });

    } catch (error) {
      console.error('Error fetching user performance:', error);
      res.status(500).json({
        error: error.message || 'Failed to fetch user performance'
      });
    }
  });

  return router;
}
