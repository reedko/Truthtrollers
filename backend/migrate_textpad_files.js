import mysql from 'mysql';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'd1Mm0v3g!',
  database: 'truthtrollers',
});

const query = promisify(db.query).bind(db);

async function migrateTextpadFiles() {
  console.log('🔍 Finding textpad documents in old location...');

  // Find all content records with textpad URLs pointing to old location
  const textpadRecords = await query(`
    SELECT content_id, url, thumbnail, content_name
    FROM content
    WHERE url LIKE 'local://documents/tasks/%' OR media_source = 'TextPad'
  `);

  console.log(`Found ${textpadRecords.length} textpad content records`);

  if (textpadRecords.length === 0) {
    console.log('✅ No records to migrate!');
    db.end();
    return;
  }

  const oldDir = path.join(__dirname, 'assets/documents/tasks');
  const newDir = path.join(__dirname, 'assets/images/content');

  // Ensure new directory exists
  await fs.mkdir(newDir, { recursive: true });

  for (const record of textpadRecords) {
    try {
      const contentId = record.content_id;
      const oldUrl = record.url;

      // Extract old filename from URL
      let oldFilename;
      if (oldUrl.startsWith('local://documents/tasks/')) {
        oldFilename = oldUrl.replace('local://documents/tasks/', '');
      } else if (oldUrl.includes('text_')) {
        oldFilename = path.basename(oldUrl);
      } else {
        console.log(`⚠️ Skipping content_id ${contentId} - unusual URL: ${oldUrl}`);
        continue;
      }

      const oldPath = path.join(oldDir, oldFilename);
      const newFilename = `content_id_${contentId}.txt`;
      const newPath = path.join(newDir, newFilename);
      const newThumbnailPath = `assets/images/content/${newFilename}`;

      // Check if old file exists
      try {
        await fs.access(oldPath);
      } catch (err) {
        console.log(`⚠️ File not found: ${oldPath}, skipping...`);
        continue;
      }

      // Copy file to new location
      await fs.copyFile(oldPath, newPath);
      console.log(`📋 Copied: ${oldFilename} → ${newFilename}`);

      // Update database record
      await query(
        `UPDATE content SET url = ?, thumbnail = ? WHERE content_id = ?`,
        [newThumbnailPath, newThumbnailPath, contentId]
      );

      console.log(`✅ Updated content_id ${contentId}: ${record.content_name}`);
      console.log(`   Old: ${oldUrl}`);
      console.log(`   New: ${newThumbnailPath}`);

      // Delete old file (optional - comment out if you want to keep backups)
      await fs.unlink(oldPath);
      console.log(`🗑️ Removed old file: ${oldFilename}`);

    } catch (err) {
      console.error(`❌ Error migrating content_id ${record.content_id}:`, err.message);
    }
  }

  console.log(`\n✅ Migration complete!`);
  db.end();
}

migrateTextpadFiles().catch(console.error);
