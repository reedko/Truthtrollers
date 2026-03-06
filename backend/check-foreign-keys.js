// Check which foreign keys reference the junction tables
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const junctionTables = [
  'user_roles',
  'role_permissions',
  'user_permissions',
  'content_users',
  'user_reference_visibility',
  'user_veracity_ratings',
  'bias_vectors'
];

async function checkForeignKeys() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'truthtrollers'
  });

  try {
    console.log('\n🔍 Checking foreign key constraints on junction tables...\n');

    for (const table of junctionTables) {
      console.log(`\n📋 ${table}:`);

      // Check FKs pointing TO this table
      const [incomingFKs] = await conn.query(`
        SELECT
          TABLE_NAME as referencing_table,
          CONSTRAINT_NAME,
          COLUMN_NAME as referencing_column,
          REFERENCED_COLUMN_NAME as referenced_column
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND REFERENCED_TABLE_NAME = ?
      `, [table]);

      if (incomingFKs.length > 0) {
        console.log('  ❌ Foreign keys pointing TO this table:');
        incomingFKs.forEach(fk => {
          console.log(`     ${fk.referencing_table}.${fk.referencing_column} -> ${table}.${fk.referenced_column} (${fk.CONSTRAINT_NAME})`);
        });
      } else {
        console.log('  ✅ No foreign keys pointing to this table');
      }

      // Check FKs FROM this table
      const [outgoingFKs] = await conn.query(`
        SELECT
          CONSTRAINT_NAME,
          COLUMN_NAME,
          REFERENCED_TABLE_NAME,
          REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [table]);

      if (outgoingFKs.length > 0) {
        console.log('  Foreign keys FROM this table:');
        outgoingFKs.forEach(fk => {
          console.log(`     ${table}.${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME} (${fk.CONSTRAINT_NAME})`);
        });
      }
    }

    console.log('\n');

  } finally {
    await conn.end();
  }
}

checkForeignKeys();
