import mysql from 'mysql';
import { promisify } from 'util';

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'd1Mm0v3g!',
  database: 'truthtrollers',
});

const query = promisify(db.query).bind(db);

async function fixThumbnailPaths() {
  console.log('🔍 Checking for incorrect thumbnail paths...');

  // Find all content records with "conten_id" in thumbnail path
  const incorrectPaths = await query(`
    SELECT content_id, thumbnail
    FROM content
    WHERE thumbnail LIKE '%conten_id_%'
  `);

  console.log(`Found ${incorrectPaths.length} records with incorrect paths`);

  if (incorrectPaths.length === 0) {
    console.log('✅ No incorrect paths found!');
    db.end();
    return;
  }

  // Fix each one
  for (const record of incorrectPaths) {
    const oldPath = record.thumbnail;
    const newPath = oldPath.replace(/conten_id_/g, 'content_id_');

    console.log(`Fixing content_id ${record.content_id}:`);
    console.log(`  Old: ${oldPath}`);
    console.log(`  New: ${newPath}`);

    await query(
      `UPDATE content SET thumbnail = ? WHERE content_id = ?`,
      [newPath, record.content_id]
    );
  }

  console.log(`✅ Fixed ${incorrectPaths.length} thumbnail paths!`);
  db.end();
}

fixThumbnailPaths().catch(console.error);
