// Check and grant super_admin role to a user
import mysql from 'mysql';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

const query = promisify(pool.query).bind(pool);

async function checkAndGrantSuperAdmin(usernameOrEmail) {
  try {
    // Find the user
    const users = await query(
      'SELECT user_id, username, email FROM users WHERE username = ? OR email = ?',
      [usernameOrEmail, usernameOrEmail]
    );

    if (users.length === 0) {
      console.error(`❌ User not found: ${usernameOrEmail}`);
      process.exit(1);
    }

    const user = users[0];
    console.log(`\n✅ Found user: ${user.username} (${user.email}) [ID: ${user.user_id}]`);

    // Check if super_admin role exists
    const roles = await query('SELECT role_id, name FROM roles WHERE name = ?', ['super_admin']);

    let superAdminRoleId;
    if (roles.length === 0) {
      console.log('⚠️  super_admin role does not exist. Creating it...');
      const result = await query('INSERT INTO roles (name, description) VALUES (?, ?)', [
        'super_admin',
        'Super Administrator with full access'
      ]);
      superAdminRoleId = result.insertId;
      console.log(`✅ Created super_admin role (ID: ${superAdminRoleId})`);
    } else {
      superAdminRoleId = roles[0].role_id;
      console.log(`✅ super_admin role exists (ID: ${superAdminRoleId})`);
    }

    // Check if user already has the role
    const existingRoles = await query(
      `SELECT ur.user_role_id, r.name
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.role_id
       WHERE ur.user_id = ?`,
      [user.user_id]
    );

    console.log(`\nCurrent roles for ${user.username}:`);
    if (existingRoles.length === 0) {
      console.log('  (none)');
    } else {
      existingRoles.forEach(r => console.log(`  - ${r.name}`));
    }

    const hasSuperAdmin = existingRoles.some(r => r.name === 'super_admin');

    if (hasSuperAdmin) {
      console.log(`\n✅ User ${user.username} already has super_admin role!`);
    } else {
      // Grant super_admin role
      await query(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [user.user_id, superAdminRoleId]
      );
      console.log(`\n✅ Granted super_admin role to ${user.username}!`);
    }

    console.log('\n📝 User needs to log out and log back in for changes to take effect.\n');

  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  } finally {
    pool.end();
  }
}

// Get username/email from command line args
const usernameOrEmail = process.argv[2];

if (!usernameOrEmail) {
  console.error('Usage: node check-and-grant-super-admin.js <username or email>');
  console.error('Example: node check-and-grant-super-admin.js reedko');
  process.exit(1);
}

checkAndGrantSuperAdmin(usernameOrEmail);
