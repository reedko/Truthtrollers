import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  try {
    console.log('📝 Reading SQL file...');
    const sql = fs.readFileSync(
      join(__dirname, 'simple-verimeter-sp.sql'),
      'utf8'
    );

    console.log('🔄 Creating stored procedure...');

    // Execute the SQL using the pool directly
    pool.query(sql, (error, results) => {
      if (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
      }

      console.log('✅ Stored procedure created successfully!');
      console.log('📊 Results:', results);

      // Test it by calling the SP
      pool.query('CALL compute_simple_verimeter_for_content(13626, 1)', (err, testResults) => {
        if (err) {
          console.error('❌ Test call failed:', err);
          process.exit(1);
        }

        console.log('✅ Test call successful!');
        console.log('📊 Test results:', testResults);

        process.exit(0);
      });
    });
  } catch (error) {
    console.error('❌ Failed to read SQL file:', error);
    process.exit(1);
  }
}

runMigration();
