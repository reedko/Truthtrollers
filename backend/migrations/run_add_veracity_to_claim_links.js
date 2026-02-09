// Run migration: Add veracity scoring to claim_links
import { query } from '../src/db/pool.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    console.log('🚀 Running migration: add_veracity_to_claim_links.sql');

    const sql = fs.readFileSync(
      path.join(__dirname, 'add_veracity_to_claim_links.sql'),
      'utf-8'
    );

    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.toLowerCase().includes('select')) {
        // Skip verification queries
        continue;
      }
      const preview = statement.substring(0, 60);
      console.log(`Executing: ${preview}...`);
      await query(statement);
    }

    console.log('✅ Migration completed successfully!');

    // Run verification
    const results = await query(`
      SELECT
        COUNT(*) as total_links,
        SUM(CASE WHEN created_by_ai = 1 THEN 1 ELSE 0 END) as ai_generated,
        SUM(CASE WHEN created_by_ai = 0 THEN 1 ELSE 0 END) as user_created,
        AVG(veracity_score) as avg_veracity,
        AVG(confidence) as avg_confidence
      FROM claim_links
    `);

    const row = results[0];
    console.log('\n📊 Verification:');
    console.log(`   Total links: ${row.total_links}`);
    console.log(`   AI-generated: ${row.ai_generated}`);
    console.log(`   User-created: ${row.user_created}`);
    console.log(`   Avg veracity: ${row.avg_veracity ? row.avg_veracity.toFixed(2) : 'N/A'}`);
    console.log(`   Avg confidence: ${row.avg_confidence ? row.avg_confidence.toFixed(2) : 'N/A'}`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
