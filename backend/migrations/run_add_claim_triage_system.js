// Run the claim triage system migration
// Usage: node migrations/run_add_claim_triage_system.js

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_CONFIG = {
  host: 'localhost',
  user: 'root',
  password: 'Root#7777',
  database: 'truthtrollers',
  multipleStatements: true,
};

async function runMigration() {
  let connection;

  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('✅ Connected to database');

    // Read the SQL file
    const sqlFile = path.join(__dirname, 'add_claim_triage_system.sql');
    console.log(`📄 Reading migration file: ${sqlFile}`);

    const sql = fs.readFileSync(sqlFile, 'utf8');

    // Split by statements (handle IF NOT EXISTS)
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`📊 Found ${statements.length} SQL statements to execute`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';';

      // Skip comments
      if (statement.startsWith('--')) {
        continue;
      }

      try {
        console.log(`\n[${i + 1}/${statements.length}] Executing statement...`);

        // Show a preview of the statement
        const preview = statement.substring(0, 100).replace(/\s+/g, ' ');
        console.log(`   ${preview}${statement.length > 100 ? '...' : ''}`);

        await connection.query(statement);
        console.log('   ✅ Success');
      } catch (err) {
        // Check if it's a "duplicate column" or "already exists" error (which is OK)
        if (
          err.message.includes('Duplicate column') ||
          err.message.includes('already exists') ||
          err.message.includes('Duplicate key name')
        ) {
          console.log(`   ⚠️  Already exists (skipped): ${err.message}`);
        } else {
          console.error(`   ❌ Error: ${err.message}`);
          throw err;
        }
      }
    }

    console.log('\n✅ Migration completed successfully!');

    // Verify tables exist
    console.log('\n🔍 Verifying new tables...');

    const [tables] = await connection.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'truthtrollers'
        AND table_name IN ('source_quality_scores', 'claim_retrieval_evidence')
    `);

    console.log('New tables found:');
    tables.forEach(t => console.log(`  - ${t.table_name}`));

    // Verify new columns on claims table
    const [columns] = await connection.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'truthtrollers'
        AND table_name = 'claims'
        AND column_name IN (
          'triage_status',
          'claim_centrality',
          'claim_specificity',
          'claim_consequence',
          'retrieval_count'
        )
    `);

    console.log('\nNew columns on claims table:');
    columns.forEach(c => console.log(`  - ${c.column_name}`));

    if (columns.length === 0) {
      console.warn('\n⚠️  Warning: New columns not found on claims table!');
      console.warn('This might mean the migration did not fully apply.');
      console.warn('Check the ALTER TABLE statements for errors.');
    }

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run the migration
runMigration();
