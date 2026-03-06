// Safe migration to add surrogate keys to junction tables
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const junctionTables = [
  { name: 'user_roles', newPK: 'user_role_id', oldPK: ['user_id', 'role_id'] },
  { name: 'role_permissions', newPK: 'role_permission_id', oldPK: ['role_id', 'permission_id'] },
  { name: 'user_permissions', newPK: 'user_permission_id', oldPK: ['user_id', 'permission_id'] },
  { name: 'content_users', newPK: 'content_user_id', oldPK: ['content_id', 'user_id'] },
  { name: 'user_reference_visibility', newPK: 'user_reference_visibility_id', oldPK: ['user_id', 'task_content_id', 'reference_content_id'] },
  { name: 'user_veracity_ratings', newPK: 'user_veracity_rating_id', oldPK: ['user_id', 'veracity_relation_id'] },
  { name: 'bias_vectors', newPK: 'bias_vector_id', oldPK: ['entity_id', 'entity_type', 'topic_id'] }
];

async function migrateSurrogateKeys() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'truthtrollers',
  });

  try {
    console.log('\n🔄 Adding surrogate keys to junction tables...\n');

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const table of junctionTables) {
      console.log(`📋 Processing: ${table.name}`);

      // Check if new PK column already exists
      const [cols] = await connection.query(`
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
      `, [table.name, table.newPK]);

      if (cols.length === 0) {
        // Column doesn't exist, add it
        console.log(`   ➕ Adding column ${table.newPK}...`);
        await connection.query(`
          ALTER TABLE ${table.name}
          ADD COLUMN ${table.newPK} INT AUTO_INCREMENT UNIQUE FIRST
        `);
      } else {
        console.log(`   ✓ Column ${table.newPK} already exists`);
      }

      // Check current primary key
      const [currentPK] = await connection.query(`
        SELECT COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION
      `, [table.name]);

      const currentPKCols = currentPK.map(c => c.COLUMN_NAME);

      // If PK is not yet the new surrogate key, change it
      if (currentPKCols.length !== 1 || currentPKCols[0] !== table.newPK) {
        console.log(`   🔄 Changing primary key to ${table.newPK}...`);

        // Get foreign keys FROM this table
        const [outgoingFKs] = await connection.query(`
          SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND REFERENCED_TABLE_NAME IS NOT NULL
        `, [table.name]);

        // Drop foreign keys
        for (const fk of outgoingFKs) {
          console.log(`      Dropping FK: ${fk.CONSTRAINT_NAME}`);
          await connection.query(`ALTER TABLE ${table.name} DROP FOREIGN KEY ${fk.CONSTRAINT_NAME}`);
        }

        // Drop old primary key
        await connection.query(`ALTER TABLE ${table.name} DROP PRIMARY KEY`);

        // Add new primary key
        await connection.query(`
          ALTER TABLE ${table.name}
          ADD PRIMARY KEY (${table.newPK})
        `);

        // Recreate foreign keys
        for (const fk of outgoingFKs) {
          console.log(`      Recreating FK: ${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`);
          await connection.query(`
            ALTER TABLE ${table.name}
            ADD FOREIGN KEY (${fk.COLUMN_NAME}) REFERENCES ${fk.REFERENCED_TABLE_NAME}(${fk.REFERENCED_COLUMN_NAME})
          `);
        }

        // Add unique constraint on old PK columns
        const uniqueKeyName = `idx_${table.name}_unique`;
        const oldPKCols = table.oldPK.join(', ');

        // Check if unique key already exists
        const [existingIdx] = await connection.query(`
          SELECT INDEX_NAME
          FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND INDEX_NAME = ?
        `, [table.name, uniqueKeyName]);

        if (existingIdx.length === 0) {
          await connection.query(`
            ALTER TABLE ${table.name}
            ADD UNIQUE KEY ${uniqueKeyName} (${oldPKCols})
          `);
        }

        console.log(`   ✅ Primary key updated`);
      } else {
        console.log(`   ✓ Primary key already correct`);
      }

      console.log('');
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('✅ All junction tables updated successfully!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

migrateSurrogateKeys();
