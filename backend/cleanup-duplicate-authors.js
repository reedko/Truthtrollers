// cleanup-duplicate-authors.js
// Removes duplicate content_authors records, keeping only one per content_id + author_id pair

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

async function cleanupDuplicates() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_DATABASE || 'truthtrollers',
  });

  try {
    console.log('🔍 Finding duplicate content_authors records...');

    // Find duplicates
    const [duplicates] = await connection.query(`
      SELECT content_id, author_id, COUNT(*) as count
      FROM content_authors
      GROUP BY content_id, author_id
      HAVING COUNT(*) > 1
    `);

    if (duplicates.length === 0) {
      console.log('✅ No duplicates found!');
      await connection.end();
      return;
    }

    console.log(`Found ${duplicates.length} duplicate pairs:`);
    duplicates.forEach(dup => {
      console.log(`  - content_id ${dup.content_id}, author_id ${dup.author_id}: ${dup.count} records`);
    });

    // Remove duplicates, keeping only the first record for each pair
    console.log('\n🧹 Cleaning up duplicates...');

    for (const dup of duplicates) {
      // Get all records for this pair
      const [records] = await connection.query(`
        SELECT content_author_id
        FROM content_authors
        WHERE content_id = ? AND author_id = ?
        ORDER BY content_author_id ASC
      `, [dup.content_id, dup.author_id]);

      // Keep the first, delete the rest
      const toDelete = records.slice(1).map(r => r.content_author_id);

      if (toDelete.length > 0) {
        const [result] = await connection.query(`
          DELETE FROM content_authors
          WHERE content_author_id IN (?)
        `, [toDelete]);

        console.log(`  ✅ Removed ${result.affectedRows} duplicate(s) for content_id ${dup.content_id}, author_id ${dup.author_id}`);
      }
    }

    console.log('\n✅ Cleanup complete!');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

cleanupDuplicates().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
