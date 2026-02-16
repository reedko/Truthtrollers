// Simple migration runner
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function runMigration() {
  const migrationFile = process.argv[2];

  if (!migrationFile) {
    console.error('Usage: node run-single-migration.js <migration-file.sql>');
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'truthtrollers',
    multipleStatements: true
  });

  try {
    const sqlPath = path.join(__dirname, migrationFile);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log(`Running migration: ${migrationFile}`);
    const [results] = await connection.query(sql);
    console.log('✅ Migration completed successfully');
    console.log(results);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigration();
