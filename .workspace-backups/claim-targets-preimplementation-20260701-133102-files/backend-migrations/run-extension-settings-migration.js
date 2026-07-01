// Run extension settings migration
import mysql from 'mysql';
import { promisify } from 'util';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'truthtrollers',
  multipleStatements: true
});

const query = promisify(pool.query).bind(pool);

async function runMigration() {
  try {
    console.log('📊 Running extension settings migration...');

    const sql = fs.readFileSync(
      join(__dirname, 'create-extension-settings-table.sql'),
      'utf8'
    );

    await query(sql);

    console.log('✅ Extension settings table created successfully');
    console.log('✅ Default settings inserted: verimeter_mode=user, verimeter_ai_weight=0.5');

    // Verify
    const settings = await query('SELECT * FROM extension_settings');
    console.log('📋 Current extension settings:');
    settings.forEach(row => {
      console.log(`   ${row.setting_key} = ${row.setting_value}`);
    });

    pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    pool.end();
    process.exit(1);
  }
}

runMigration();
