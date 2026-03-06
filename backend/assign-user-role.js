// Helper script to assign roles to users
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

async function assignRole() {
  const userId = process.argv[2];
  const roleName = process.argv[3];

  if (!userId || !roleName) {
    console.error('Usage: node assign-user-role.js <user_id> <role_name>');
    console.error('');
    console.error('Available roles:');
    console.error('  - super_admin  (all permissions)');
    console.error('  - admin        (most permissions)');
    console.error('  - moderator    (moderation permissions)');
    console.error('  - user         (basic user)');
    console.error('');
    console.error('Example: node assign-user-role.js 1 super_admin');
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'truthtrollers',
  });

  try {
    // Check if user exists
    const [users] = await connection.query(
      'SELECT user_id, username FROM users WHERE user_id = ?',
      [userId]
    );

    if (users.length === 0) {
      console.error(`❌ User ${userId} not found`);
      process.exit(1);
    }

    const user = users[0];

    // Get role_id
    const [roles] = await connection.query(
      'SELECT role_id, name FROM roles WHERE name = ?',
      [roleName]
    );

    if (roles.length === 0) {
      console.error(`❌ Role '${roleName}' not found`);
      console.error('Available roles: super_admin, admin, moderator, user');
      process.exit(1);
    }

    const role = roles[0];

    // Check if user already has this role
    const [existing] = await connection.query(
      'SELECT * FROM user_roles WHERE user_id = ? AND role_id = ?',
      [userId, role.role_id]
    );

    if (existing.length > 0) {
      console.log(`ℹ️  User '${user.username}' (${userId}) already has role '${roleName}'`);
      process.exit(0);
    }

    // Assign role
    await connection.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [userId, role.role_id]
    );

    console.log(`✅ Successfully assigned role '${roleName}' to user '${user.username}' (${userId})`);

    // Show user's current roles
    const [userRoles] = await connection.query(`
      SELECT r.name, r.role_id
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.role_id
      WHERE ur.user_id = ?
    `, [userId]);

    console.log(`\nUser '${user.username}' now has these roles:`);
    userRoles.forEach(r => {
      console.log(`  - ${r.name} (role_id: ${r.role_id})`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

assignRole();
