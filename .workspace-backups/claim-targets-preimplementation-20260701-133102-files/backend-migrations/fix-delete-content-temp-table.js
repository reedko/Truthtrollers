// Fix delete_content_cascade stored procedure - temp table subquery issue
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'truthtrollers',
  multipleStatements: true
});

const query = (sql, params) => {
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

async function runMigration() {
  try {
    console.log('🔧 Fixing delete_content_cascade stored procedure...');

    const sqlFile = path.join(__dirname, 'fix-delete-content-temp-table.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    await query(sql);

    console.log('✅ Stored procedure fixed successfully!');
    console.log('   - Changed from TEMPORARY TABLE to regular TABLE');
    console.log('   - Changed from IN (SELECT...) subqueries to JOINs');
    console.log('   - This fixes the "Unknown column claim_id in subquery" error');

    pool.end();
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    pool.end();
    process.exit(1);
  }
}

runMigration();
