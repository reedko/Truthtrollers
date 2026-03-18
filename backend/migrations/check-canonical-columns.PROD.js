// Check if canonical columns exist ON PRODUCTION
import mysql from 'mysql';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load PRODUCTION environment variables
const envPath = join(__dirname, '../.env.production');
dotenv.config({ path: envPath });

if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_DATABASE) {
  console.error('❌ Missing production database credentials!');
  console.error('   Create .env.production with DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE');
  process.exit(1);
}

console.log(`\n🔴 PRODUCTION DATABASE CHECK 🔴`);
console.log(`Target: ${process.env.DB_USER}@${process.env.DB_HOST}/${process.env.DB_DATABASE}\n`);

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  charset: 'utf8mb4'
});

const query = promisify(connection.query).bind(connection);

(async () => {
  await promisify(connection.connect).bind(connection)();

  console.log('Checking for canonical columns...\n');

  const cols = await query("SHOW COLUMNS FROM content WHERE Field LIKE '%canonical%'");
  if (cols.length > 0) {
    console.log('✅ Found canonical columns:');
    cols.forEach(col => {
      console.log(`   ${col.Field}: ${col.Type}`);
    });
  } else {
    console.log('❌ No canonical columns found');
  }

  console.log('\nChecking for canonical indexes...\n');

  const idx = await query("SHOW INDEX FROM content WHERE Key_name LIKE '%canonical%'");
  if (idx.length > 0) {
    console.log('✅ Found canonical indexes:');
    idx.forEach(i => {
      console.log(`   ${i.Key_name} on ${i.Column_name}`);
    });
  } else {
    console.log('❌ No canonical indexes found');
  }

  // Check how many rows need backfilling
  console.log('\nChecking backfill status...\n');

  const [stats] = await query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN canonical_url_hash IS NOT NULL THEN 1 ELSE 0 END) as with_hash,
      SUM(CASE WHEN canonical_url_hash IS NULL THEN 1 ELSE 0 END) as without_hash
    FROM content
    WHERE url IS NOT NULL AND url != ''
  `);

  console.log('Backfill status:');
  console.log(`   Total content with URLs: ${stats.total}`);
  console.log(`   With canonical hash: ${stats.with_hash}`);
  console.log(`   Without canonical hash: ${stats.without_hash}`);

  if (stats.without_hash > 0) {
    console.log(`\n⚠️  Run backfill-canonical-hashes.PROD.js to update ${stats.without_hash} rows`);
  } else {
    console.log('\n✅ All rows have canonical hashes!');
  }

  connection.end();
})();
