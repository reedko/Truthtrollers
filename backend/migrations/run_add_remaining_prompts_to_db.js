#!/usr/bin/env node
// Run migration: Add all remaining hardcoded prompts to database

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  console.log('🔧 Starting migration: add_remaining_prompts_to_db');

  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'd1Mm0v3g!',
    database: 'truthtrollers',
    multipleStatements: true,
  });

  try {
    const sqlPath = join(__dirname, 'add_remaining_prompts_to_db.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('📝 Executing SQL migration...');
    await connection.query(sql);

    console.log('✅ Migration completed successfully');

    // Verify prompts were added
    const [rows] = await connection.query(
      `SELECT prompt_name, prompt_type, version, is_active
       FROM llm_prompts
       WHERE prompt_id >= 103
       ORDER BY prompt_id`
    );

    console.log('\n📊 Newly added prompts in database:');
    if (rows.length === 0) {
      console.log('  No prompts found');
    } else {
      console.log('\n  SOURCE QUALITY SCORER:');
      rows.filter(r => r.prompt_name.includes('source_quality')).forEach(row => {
        console.log(`    - ${row.prompt_name} (${row.prompt_type}, v${row.version}, ${row.is_active ? 'active' : 'inactive'})`);
      });

      console.log('\n  CLAIM TRIAGE ENGINE:');
      rows.filter(r => r.prompt_name.includes('claim_triage')).forEach(row => {
        console.log(`    - ${row.prompt_name} (${row.prompt_type}, v${row.version}, ${row.is_active ? 'active' : 'inactive'})`);
      });

      console.log('\n  CLAIM PROPERTIES EVALUATION:');
      rows.filter(r => r.prompt_name.includes('claim_properties')).forEach(row => {
        console.log(`    - ${row.prompt_name} (${row.prompt_type}, v${row.version}, ${row.is_active ? 'active' : 'inactive'})`);
      });

      console.log('\n  CLAIM MATCHING:');
      rows.filter(r => r.prompt_name.includes('claim_matching')).forEach(row => {
        console.log(`    - ${row.prompt_name} (${row.prompt_type}, v${row.version}, ${row.is_active ? 'active' : 'inactive'})`);
      });

      console.log('\n  CLAIM RELEVANCE ASSESSMENT:');
      rows.filter(r => r.prompt_name.includes('claim_relevance')).forEach(row => {
        console.log(`    - ${row.prompt_name} (${row.prompt_type}, v${row.version}, ${row.is_active ? 'active' : 'inactive'})`);
      });
    }

    console.log(`\n✨ Total prompts added: ${rows.length}`);

  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    await connection.end();
  }
}

runMigration().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
