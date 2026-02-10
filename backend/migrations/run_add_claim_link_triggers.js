// Run migration to add triggers for auto-updating verimeter scores
import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function runMigration() {
  let connection;

  try {
    console.log('🔄 Connecting to database...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      multipleStatements: true,
    });

    console.log('✅ Connected to database');

    console.log('🔄 Creating triggers for automatic verimeter score updates...');

    // Execute trigger creation statements individually
    const triggers = [
      {
        name: 'claim_links_after_insert',
        sql: `
          DROP TRIGGER IF EXISTS claim_links_after_insert;
          CREATE TRIGGER claim_links_after_insert
          AFTER INSERT ON claim_links
          FOR EACH ROW
          BEGIN
            DELETE cs FROM content_scores cs
            JOIN content_claims cc ON cs.content_id = cc.content_id
            WHERE cc.claim_id = NEW.target_claim_id;

            DELETE FROM claim_scores
            WHERE claim_id = NEW.target_claim_id;
          END;
        `
      },
      {
        name: 'claim_links_after_update',
        sql: `
          DROP TRIGGER IF EXISTS claim_links_after_update;
          CREATE TRIGGER claim_links_after_update
          AFTER UPDATE ON claim_links
          FOR EACH ROW
          BEGIN
            DELETE cs FROM content_scores cs
            JOIN content_claims cc ON cs.content_id = cc.content_id
            WHERE cc.claim_id = NEW.target_claim_id;

            DELETE FROM claim_scores
            WHERE claim_id = NEW.target_claim_id;
          END;
        `
      },
      {
        name: 'claim_links_after_delete',
        sql: `
          DROP TRIGGER IF EXISTS claim_links_after_delete;
          CREATE TRIGGER claim_links_after_delete
          AFTER DELETE ON claim_links
          FOR EACH ROW
          BEGIN
            DELETE cs FROM content_scores cs
            JOIN content_claims cc ON cs.content_id = cc.content_id
            WHERE cc.claim_id = OLD.target_claim_id;

            DELETE FROM claim_scores
            WHERE claim_id = OLD.target_claim_id;
          END;
        `
      }
    ];

    for (const trigger of triggers) {
      try {
        await connection.query(trigger.sql);
        console.log(`   ✅ Created ${trigger.name}`);
      } catch (err) {
        console.error(`   ❌ Failed to create ${trigger.name}:`, err.message);
        throw err;
      }
    }

    console.log('✅ Migration completed successfully!');
    console.log('📊 Triggers created:');
    console.log('   - claim_links_after_insert');
    console.log('   - claim_links_after_update');
    console.log('   - claim_links_after_delete');
    console.log('💡 Scores will now auto-invalidate when claim_links change');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('✅ Database connection closed');
    }
  }
}

runMigration();
