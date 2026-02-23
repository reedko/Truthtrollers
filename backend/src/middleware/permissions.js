// Permission checking middleware

/**
 * Check if user has a specific permission
 * @param {object} query - Database query function
 * @param {number} userId - User ID to check
 * @param {string} permissionName - Permission name (e.g., 'delete_system_references')
 * @returns {Promise<boolean>}
 */
export async function userHasPermission(query, userId, permissionName) {
  if (!userId || !permissionName) return false;

  const sql = `
    SELECT 1
    FROM user_permissions up
    JOIN permissions p ON up.permission_id = p.permission_id
    WHERE up.user_id = ? AND p.name = ?

    UNION

    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.permission_id
    WHERE ur.user_id = ? AND p.name = ?

    LIMIT 1
  `;

  const result = await query(sql, [userId, permissionName, userId, permissionName]);
  return result.length > 0;
}

/**
 * Get all permissions for a user (direct + from roles)
 * @param {object} query - Database query function
 * @param {number} userId - User ID
 * @returns {Promise<string[]>} Array of permission names
 */
export async function getUserPermissions(query, userId) {
  if (!userId) return [];

  const sql = `
    SELECT DISTINCT p.name
    FROM permissions p
    WHERE p.permission_id IN (
      -- Direct permissions
      SELECT permission_id FROM user_permissions WHERE user_id = ?
      UNION
      -- Permissions from roles
      SELECT rp.permission_id
      FROM user_roles ur
      JOIN role_permissions rp ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?
    )
  `;

  const result = await query(sql, [userId, userId]);
  return result.map(row => row.name);
}

/**
 * Check if user has a specific role
 * @param {object} query - Database query function
 * @param {number} userId - User ID
 * @param {string} roleName - Role name (e.g., 'super_admin')
 * @returns {Promise<boolean>}
 */
export async function userHasRole(query, userId, roleName) {
  if (!userId || !roleName) return false;

  const sql = `
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.role_id
    WHERE ur.user_id = ? AND r.name = ?
    LIMIT 1
  `;

  const result = await query(sql, [userId, roleName]);
  return result.length > 0;
}

/**
 * Express middleware: require specific permission
 * Usage: router.delete('/api/references/:id', requirePermission('delete_system_references'), handler)
 */
export function requirePermission(permissionName) {
  return async (req, res, next) => {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const hasPermission = await userHasPermission(req.query, userId, permissionName);

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: permissionName
      });
    }

    next();
  };
}

/**
 * Express middleware: require specific role
 */
export function requireRole(roleName) {
  return async (req, res, next) => {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const hasRole = await userHasRole(req.query, userId, roleName);

    if (!hasRole) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required_role: roleName
      });
    }

    next();
  };
}
