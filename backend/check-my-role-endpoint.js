// Temporary debug endpoint - add this to server.js to check your role

// Add this to your server.js routes section:
/*

app.get('/api/debug/my-role', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.user_id;

    if (!userId) {
      return res.json({
        error: 'No user_id in token',
        token_data: req.user
      });
    }

    // Get user info
    const users = await query(
      'SELECT user_id, username, email FROM users WHERE user_id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.json({ error: 'User not found', user_id: userId });
    }

    // Get roles
    const userRoles = await query(
      `SELECT r.role_id, r.name, r.description
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.role_id
       WHERE ur.user_id = ?`,
      [userId]
    );

    res.json({
      user: users[0],
      roles: userRoles,
      token_data: req.user,
      has_super_admin: userRoles.some(r => r.name === 'super_admin')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

*/

// Instructions:
// 1. Add the above code to backend/server.js (after the auth routes)
// 2. Restart the backend
// 3. Visit https://truthtrollers.com/api/debug/my-role while logged in
// 4. Check the response to see your current role
