// backend/src/core/tasks/taskService.js
import { query } from "../../db/pool.js";

/**
 * Fetch a single task by its ID.
 */
export async function getTaskById(taskId) {
  const sql = `
    SELECT 
      content_id AS taskContentId,
      url,
      content_name AS title,
      content AS text,
      created_at,
      updated_at
    FROM content
    WHERE content_id = ? AND content_type = 'task'
    LIMIT 1
  `;

  const rows = await query(sql, [taskId]);
  return rows[0] || null;
}

/**
 * Fetch tasks assigned to a specific user.
 */
export async function getTasksForUser(userId) {
  const sql = `
    SELECT 
      c.content_id AS taskContentId,
      c.url,
      c.content_name AS title,
      c.content AS text,
      c.created_at,
      c.updated_at,
      ua.user_id
    FROM content c
    JOIN user_assignments ua ON ua.task_content_id = c.content_id
    WHERE ua.user_id = ?
      AND c.content_type = 'task'
    ORDER BY c.created_at DESC
  `;

  return query(sql, [userId]);
}

/**
 * Fetch tasks by pivot (task, author, publisher, reference)
 */
export async function getUnifiedTasksByPivot(pivotType, pivotId) {
  let sql = "";
  let params = [];

  switch (pivotType) {
    case "task":
      sql = `
        SELECT 
          content_id AS taskContentId,
          url,
          content_name AS title,
          content AS text,
          created_at,
          updated_at
        FROM content
        WHERE content_id = ?
          AND content_type = 'task'
      `;
      params = [pivotId];
      break;

    case "author":
      sql = `
        SELECT DISTINCT
          c.content_id AS taskContentId,
          c.url,
          c.content_name AS title,
          c.content AS text,
          c.created_at,
          c.updated_at
        FROM content c
        JOIN content_authors ca ON ca.content_id = c.content_id
        WHERE ca.author_id = ?
          AND c.content_type = 'task'
      `;
      params = [pivotId];
      break;

    case "publisher":
      sql = `
        SELECT DISTINCT
          c.content_id AS taskContentId,
          c.url,
          c.content_name AS title,
          c.content AS text,
          c.created_at,
          c.updated_at
        FROM content c
        JOIN content_publishers cp ON cp.content_id = c.content_id
        WHERE cp.publisher_id = ?
          AND c.content_type = 'task'
      `;
      params = [pivotId];
      break;

    case "reference":
      sql = `
        SELECT DISTINCT
          c.content_id AS taskContentId,
          c.url,
          c.content_name AS title,
          c.content AS text,
          c.created_at,
          c.updated_at
        FROM content c
        JOIN content_relations cr ON cr.task_content_id = c.content_id
        WHERE cr.reference_content_id = ?
          AND c.content_type = 'task'
      `;
      params = [pivotId];
      break;

    default:
      return [];
  }

  return query(sql, params);
}
