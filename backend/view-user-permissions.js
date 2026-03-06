// View user roles and permissions
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

async function viewPermissions() {
  const userId = process.argv[2];

  if (!userId) {
    console.error('Usage: node view-user-permissions.js <user_id>');
    console.error('');
    console.error('Example: node view-user-permissions.js 1');
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'truthtrollers',
  });

  try {
    // Get user info
    const [users] = await connection.query(
      'SELECT user_id, username, email FROM users WHERE user_id = ?',
      [userId]
    );

    if (users.length === 0) {
      console.error(`❌ User ${userId} not found`);
      process.exit(1);
    }

    const user = users[0];

    console.log(`\n👤 User: ${user.username} (${user.email})`);
    console.log(`   ID: ${user.user_id}`);

    // Get user's roles
    const [userRoles] = await connection.query(`
      SELECT r.role_id, r.name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.role_id
      WHERE ur.user_id = ?
    `, [userId]);

    if (userRoles.length === 0) {
      console.log('\n⚠️  User has no roles assigned');
      console.log('   To assign a role, run: node assign-user-role.js <user_id> <role_name>');
      process.exit(0);
    }

    console.log('\n📋 Roles:');
    userRoles.forEach(r => {
      console.log(`   - ${r.name}`);
    });

    // Get permissions from roles
    const [permissions] = await connection.query(`
      SELECT DISTINCT p.name, p.description
      FROM user_roles ur
      JOIN role_permissions rp ON ur.role_id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.permission_id
      WHERE ur.user_id = ?
      ORDER BY p.name
    `, [userId]);

    if (permissions.length > 0) {
      console.log('\n🔐 Permissions:');
      permissions.forEach(p => {
        console.log(`   ✓ ${p.name}`);
        if (p.description) {
          console.log(`     ${p.description}`);
        }
      });
    } else {
      console.log('\n⚠️  User roles have no permissions assigned');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

viewPermissions();
