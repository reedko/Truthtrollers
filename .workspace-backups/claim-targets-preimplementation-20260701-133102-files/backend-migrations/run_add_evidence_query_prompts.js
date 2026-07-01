#!/usr/bin/env node
// Run migration: Add evidence query generation prompts to database

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  console.log('🔧 Starting migration: add_evidence_query_prompts');

  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'd1Mm0v3g!',
    database: 'truthtrollers',
    multipleStatements: true,
  });

  try {
    const sqlPath = join(__dirname, 'add_evidence_query_prompts.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('📝 Executing SQL migration...');
    await connection.query(sql);

    console.log('✅ Migration completed successfully');

    // Verify prompts were added
    const [rows] = await connection.query(
      "SELECT prompt_name, prompt_type, version, is_active FROM llm_prompts WHERE prompt_name LIKE 'evidence_query%' ORDER BY prompt_name"
    );

    console.log('\n📊 Evidence query prompts in database:');
    if (rows.length === 0) {
      console.log('  No evidence query prompts found');
    } else {
      rows.forEach(row => {
        console.log(`  - ${row.prompt_name} (${row.prompt_type}, v${row.version}, ${row.is_active ? 'active' : 'inactive'})`);
      });
    }

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
