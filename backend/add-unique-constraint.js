import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

async function addUniqueConstraint() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'truthtrollers',
  });

  try {
    console.log('🔧 Adding unique constraint to content_authors...');

    await connection.query(`
      ALTER TABLE content_authors
      ADD UNIQUE KEY unique_content_author (content_id, author_id)
    `);

    console.log('✅ Unique constraint added successfully!');

  } catch (error) {
    if (error.code === 'ER_DUP_KEYNAME') {
      console.log('ℹ️ Constraint already exists, skipping...');
    } else {
      console.error('❌ Error adding constraint:', error);
      throw error;
    }
  } finally {
    await connection.end();
  }
}

addUniqueConstraint().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
