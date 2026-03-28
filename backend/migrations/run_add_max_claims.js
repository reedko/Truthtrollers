// backend/migrations/run_add_max_claims.js
// Adds max_claims column to llm_prompts table

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "password",
  database: process.env.DB_DATABASE || "truthtrollers",
  multipleStatements: true,
};

async function runMigration() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("🔧 Reading migration file...");
    const sqlPath = join(__dirname, 'add_max_claims_to_prompts.sql');
    const sql = await fs.readFile(sqlPath, 'utf8');

    console.log("📝 Executing migration...");
    await connection.query(sql);

    console.log("✅ Migration completed successfully!");
    console.log("");
    console.log("📊 Updated settings:");
    console.log("  - Added max_claims column to llm_prompts (default: 12)");
    console.log("  - Set max_claims = 12 for all claim_extraction prompts");
    console.log("");
    console.log("🎯 This limits the maximum number of claims extracted from articles to 12.");

  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

runMigration();
