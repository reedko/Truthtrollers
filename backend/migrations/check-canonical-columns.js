// Check if canonical columns exist
import mysql from 'mysql';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  charset: 'utf8mb4'
});

const query = promisify(connection.query).bind(connection);

(async () => {
  await promisify(connection.connect).bind(connection)();

  console.log('Checking for canonical columns...\n');

  const cols = await query("SHOW COLUMNS FROM content WHERE Field LIKE '%canonical%'");
  if (cols.length > 0) {
    console.log('✅ Found canonical columns:');
    cols.forEach(col => {
      console.log(`   ${col.Field}: ${col.Type}`);
    });
  } else {
    console.log('❌ No canonical columns found');
  }

  console.log('\nChecking for canonical indexes...\n');

  const idx = await query("SHOW INDEX FROM content WHERE Key_name LIKE '%canonical%'");
  if (idx.length > 0) {
    console.log('✅ Found canonical indexes:');
    idx.forEach(i => {
      console.log(`   ${i.Key_name} on ${i.Column_name}`);
    });
  } else {
    console.log('❌ No canonical indexes found');
  }

  connection.end();
})();
