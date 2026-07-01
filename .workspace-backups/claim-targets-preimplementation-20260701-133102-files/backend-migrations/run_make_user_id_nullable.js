// Run migration to make user_id nullable in claim_links table
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

    // Read SQL file
    const sqlPath = path.join(__dirname, 'make_claim_links_user_id_nullable.sql');
    const sql = await fs.readFile(sqlPath, 'utf8');

    console.log('🔄 Running migration to make user_id nullable in claim_links...');
    await connection.query(sql);

    console.log('✅ Migration completed successfully!');
    console.log('📊 user_id column in claim_links is now nullable');
    console.log('💡 AI-generated links (created_by_ai=1) can now have NULL user_id');

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
