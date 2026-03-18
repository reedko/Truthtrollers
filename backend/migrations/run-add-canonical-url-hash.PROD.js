// Run the canonical URL hash migration ON PRODUCTION
// Uses .env.production credentials
import mysql from 'mysql';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load PRODUCTION environment variables
const envPath = join(__dirname, '../.env.production');
console.log(`Loading production config from: ${envPath}`);
dotenv.config({ path: envPath });

// Verify we have production credentials
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_DATABASE) {
  console.error('❌ Missing production database credentials!');
  console.error('   Create .env.production with DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE');
  process.exit(1);
}

console.log(`\n🔴 PRODUCTION MIGRATION 🔴`);
console.log(`Target: ${process.env.DB_USER}@${process.env.DB_HOST}/${process.env.DB_DATABASE}\n`);

// Confirmation prompt
console.log('⚠️  WARNING: This will modify your PRODUCTION database!');
console.log('Press Ctrl+C within 5 seconds to cancel...\n');

await new Promise(resolve => setTimeout(resolve, 5000));

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
  charset: 'utf8mb4'
});

const query = promisify(connection.query).bind(connection);

async function runMigration() {
  try {
    console.log('🔧 Connecting to PRODUCTION database...');
    await promisify(connection.connect).bind(connection)();

    console.log('🔧 Running canonical URL hash migration...');

    // Execute each statement individually
    const statements = [
      {
        name: 'Add canonical_url_hash column',
        sql: `ALTER TABLE content
              ADD COLUMN canonical_url_hash VARCHAR(64) NULL
              COMMENT 'SHA-256 hash of canonical URL for privacy-preserving lookups'`
      },
      {
        name: 'Add canonical_url column',
        sql: `ALTER TABLE content
              ADD COLUMN canonical_url VARCHAR(2048) NULL
              COMMENT 'Canonicalized version of URL (normalized, tracking params removed)'`
      },
      {
        name: 'Create index on canonical_url_hash',
        sql: `CREATE INDEX idx_content_canonical_url_hash
              ON content(canonical_url_hash)`
      },
      {
        name: 'Create index on canonical_url',
        sql: `CREATE INDEX idx_content_canonical_url
              ON content(canonical_url(255))`
      }
    ];

    for (const stmt of statements) {
      console.log(`\n${stmt.name}...`);
      try {
        await query(stmt.sql);
        console.log('  ✅ Success');
      } catch (err) {
        // Ignore "Duplicate column" errors - column already exists
        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME') {
          console.log('  ⚠️  Already exists, skipping');
        } else {
          console.error('  ❌ Error:', err.message);
          throw err;
        }
      }
    }

    console.log('\n📊 Verifying changes...');
    const columns = await query(`
      SHOW COLUMNS FROM content
      WHERE Field IN ('canonical_url_hash', 'canonical_url')
    `);

    console.log('New columns:');
    columns.forEach(col => {
      console.log(`  - ${col.Field}: ${col.Type}`);
    });

    const indexes = await query(`
      SHOW INDEX FROM content
      WHERE Key_name LIKE '%canonical%'
    `);

    console.log('\nNew indexes:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.Key_name} on ${idx.Column_name}`);
    });

    console.log('\n✅ PRODUCTION Migration completed successfully!');

    connection.end();
  } catch (error) {
    console.error('❌ PRODUCTION Migration failed:', error);
    connection.end();
    process.exit(1);
  }
}

runMigration();
