// Test the delete_content_cascade procedure
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

async function testDelete() {
  const contentId = process.argv[2];

  if (!contentId) {
    console.error('Usage: node test-delete-content.js <content_id>');
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'truthtrollers',
  });

  try {
    console.log(`\n🗑️  Deleting content_id ${contentId}...\n`);

    const [results] = await connection.query(
      'CALL delete_content_cascade(?)',
      [contentId]
    );

    console.log('Result:', results[0]);
    console.log('\n✅ Content deleted successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

testDelete();
