// backend/src/utils/logUserActivity.js
// Utility to log user activities for engagement tracking

/**
 * Log a user activity to the user_activities table
 * @param {Function} query - Database query function
 * @param {Object} params
 * @param {number} params.userId - User ID (optional for guests)
 * @param {string} params.username - Username fallback for guests
 * @param {string} params.activityType - One of: evidence_run, claim_link_add, claim_link_evaluate, task_view, discussion_post
 * @param {number} params.contentId - Content/task ID
 * @param {number} params.claimId - Claim ID (optional)
 * @param {number} params.linkId - Link ID (optional)
 * @param {Object} params.metadata - Additional context (optional)
 */
export async function logUserActivity(query, {
  userId = null,
  username = null,
  activityType,
  contentId = null,
  claimId = null,
  linkId = null,
  metadata = null
}) {
  try {
    const sql = `
      INSERT INTO user_activities
      (user_id, username, activity_type, content_id, claim_id, link_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    await query(sql, [
      userId,
      username,
      activityType,
      contentId,
      claimId,
      linkId,
      metadata ? JSON.stringify(metadata) : null
    ]);

    console.log(`✅ [Activity] Logged ${activityType} for user ${userId || username || 'guest'}`);
  } catch (err) {
    // Don't fail the request if activity logging fails
    console.warn(`⚠️ [Activity] Failed to log ${activityType}:`, err.message);
  }
}
