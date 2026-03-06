// /backend/src/routes/content/deleteContent.routes.js
import { Router } from "express";
import { authenticateToken } from "../../middleware/auth.js";

export default function ({ query, pool }) {
  const router = Router();

  /**
   * DELETE /api/delete-content/:contentId
   * Delete content and all related records (super_admin only)
   */
  router.delete('/api/delete-content/:contentId', authenticateToken, async (req, res) => {
    const { contentId } = req.params;
    const userId = req.user?.user_id;

    console.log(`[DELETE CONTENT] Request from user ${userId} to delete content ${contentId}`);

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      // Check if user is super_admin
      const userRoles = await query(`
        SELECT r.name
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.role_id
        WHERE ur.user_id = ?
      `, [userId]);

      const isSuperAdmin = userRoles.some(row => row.name === 'super_admin');

      if (!isSuperAdmin) {
        console.log(`[DELETE CONTENT] User ${userId} is not super_admin`);
        return res.status(403).json({ error: 'Forbidden: Super admin access required' });
      }

      console.log(`[DELETE CONTENT] User ${userId} is super_admin, proceeding with deletion...`);

      // Call stored procedure to delete content and all related records
      await query('CALL delete_content_cascade(?)', [contentId]);

      console.log(`[DELETE CONTENT] Successfully deleted content ${contentId}`);

      res.json({
        success: true,
        message: `Content ${contentId} and all related records deleted successfully`
      });

    } catch (error) {
      console.error('[DELETE CONTENT] Error:', error);
      res.status(500).json({
        error: 'Failed to delete content',
        details: error.message
      });
    }
  });

  return router;
}
