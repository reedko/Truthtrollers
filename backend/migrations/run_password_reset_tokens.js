// migrations/run_password_reset_tokens.js
import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });

  try {
    const sqlPath = path.join(__dirname, 'create_password_reset_tokens.sql');
    const sql = await fs.readFile(sqlPath, 'utf-8');

    await connection.query(sql);
    console.log('✅ password_reset_tokens table created successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

runMigration();
