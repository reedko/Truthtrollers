// Run the evidence search config migration
// Usage: node migrations/run_add_evidence_search_config.js

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

    const sqlFile = path.join(__dirname, 'add_evidence_search_config.sql');
    console.log(`📄 Reading migration file: ${sqlFile}`);

    const sql = fs.readFileSync(sqlFile, 'utf8');

    console.log('🚀 Executing migration...');
    await connection.query(sql);

    console.log('✅ Migration completed successfully!');
    console.log('\n📊 Evidence search modes configured:');
    console.log('   1. high_quality_only - Tavily + Bing only');
    console.log('   2. fringe_on_support - High-quality + fringe when strong support (CURRENT)');
    console.log('   3. balanced_all_claims - 2-3 support, 2-3 refute, 2-3 nuance per claim');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

runMigration();
