// Backfill canonical URLs and hashes for existing content
import mysql from 'mysql';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { canonicalizeAndHash } from '../src/utils/canonicalizeUrl.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
  charset: 'utf8mb4'
});

const query = promisify(connection.query).bind(connection);

async function backfillHashes() {
  try {
    console.log('🔧 Connecting to database...');
    await promisify(connection.connect).bind(connection)();

    console.log('🔧 Backfilling canonical URLs and hashes...');

    // Get all content with URLs but no hash
    const rows = await query(`
      SELECT content_id, url
      FROM content
      WHERE url IS NOT NULL
        AND url != ''
        AND canonical_url_hash IS NULL
      LIMIT 10000
    `);

    console.log(`Found ${rows.length} rows to process`);

    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const { canonical, hash } = canonicalizeAndHash(row.url);

      if (canonical && hash) {
        await query(
          `UPDATE content
           SET canonical_url = ?,
               canonical_url_hash = ?
           WHERE content_id = ?`,
          [canonical, hash, row.content_id]
        );
        updated++;

        if (updated % 100 === 0) {
          console.log(`  Processed ${updated}/${rows.length}...`);
        }
      } else {
        skipped++;
      }
    }

    console.log(`\n✅ Backfill complete!`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);

    if (rows.length === 10000) {
      console.log(`\n⚠️  More rows to process - run this script again!`);
    }

    connection.end();
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    connection.end();
    process.exit(1);
  }
}

backfillHashes();
