// List all roles and their permissions
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

async function listRolesPermissions() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'truthtrollers',
  });

  try {
    console.log('\n📋 ROLES & PERMISSIONS SYSTEM\n');

    // Get all roles
    const [roles] = await connection.query('SELECT * FROM roles ORDER BY role_id');

    for (const role of roles) {
      console.log(`\n🎭 ${role.name.toUpperCase()} (role_id: ${role.role_id})`);

      // Get permissions for this role
      const [permissions] = await connection.query(`
        SELECT p.name, p.description
        FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.permission_id
        WHERE rp.role_id = ?
        ORDER BY p.name
      `, [role.role_id]);

      if (permissions.length > 0) {
        permissions.forEach(p => {
          console.log(`   ✓ ${p.name}`);
          if (p.description) {
            console.log(`     ${p.description}`);
          }
        });
      } else {
        console.log('   (no permissions)');
      }

      // Count users with this role
      const [userCount] = await connection.query(`
        SELECT COUNT(*) as count
        FROM user_roles
        WHERE role_id = ?
      `, [role.role_id]);

      console.log(`   👥 ${userCount[0].count} user(s) have this role`);
    }

    // List all available permissions
    console.log('\n\n📜 ALL AVAILABLE PERMISSIONS:\n');
    const [allPermissions] = await connection.query('SELECT * FROM permissions ORDER BY name');

    allPermissions.forEach(p => {
      console.log(`   • ${p.name}`);
      if (p.description) {
        console.log(`     ${p.description}`);
      }
    });

    console.log('\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

listRolesPermissions();
