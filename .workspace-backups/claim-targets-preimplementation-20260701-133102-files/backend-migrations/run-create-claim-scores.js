import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  try {
    console.log('📝 Reading SQL file...');
    const sql = fs.readFileSync(
      join(__dirname, 'create-claim-scores-table.sql'),
      'utf8'
    );

    console.log('🔄 Creating claim_scores table...');
    await query(sql);

    console.log('✅ claim_scores table created successfully!');

    // Check if table exists
    const [tables] = await query("SHOW TABLES LIKE 'claim_scores'");
    console.log('📊 Table exists:', tables);

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
