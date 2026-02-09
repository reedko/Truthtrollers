import mysql from 'mysql';
import { promisify } from 'util';

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'd1Mm0v3g!',
  database: 'truthtrollers',
});

const query = promisify(db.query).bind(db);

async function verifyMigration() {
  console.log('🔍 Verifying textpad file migration...\n');

  // Check for any remaining old-style URLs
  const oldStyleRecords = await query(`
    SELECT content_id, url, thumbnail, content_name, media_source
    FROM content
    WHERE url LIKE 'local://documents/tasks/%'
  `);

  if (oldStyleRecords.length > 0) {
    console.log(`⚠️ Found ${oldStyleRecords.length} records still using old URL format:`);
    oldStyleRecords.forEach(r => {
      console.log(`  content_id ${r.content_id}: ${r.url}`);
    });
  } else {
    console.log('✅ No records using old URL format');
  }

  // Check new-style textpad records
  const newStyleRecords = await query(`
    SELECT content_id, url, thumbnail, content_name, media_source
    FROM content
    WHERE media_source = 'TextPad'
    ORDER BY content_id DESC
    LIMIT 5
  `);

  console.log(`\n📋 Recent TextPad records (using new format):`);
  newStyleRecords.forEach(r => {
    console.log(`  content_id ${r.content_id}: ${r.content_name}`);
    console.log(`    URL: ${r.url}`);
    console.log(`    Thumbnail: ${r.thumbnail}`);
  });

  console.log('\n✅ Verification complete!');
  db.end();
}

verifyMigration().catch(console.error);
