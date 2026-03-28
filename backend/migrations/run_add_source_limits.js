// backend/migrations/run_add_source_limits.js
// Adds min_sources and max_sources columns to llm_prompts table
// and reduces maxEvidenceCandidates in evidence_search_config

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
    const sqlPath = join(__dirname, 'add_source_limits_to_prompts.sql');
    const sql = await fs.readFile(sqlPath, 'utf8');

    console.log("📝 Executing migration...");
    await connection.query(sql);

    console.log("✅ Migration completed successfully!");
    console.log("");
    console.log("📊 Updated settings:");
    console.log("  - Added min_sources column to llm_prompts (default: 2)");
    console.log("  - Added max_sources column to llm_prompts (default: 4)");
    console.log("  - Reduced maxEvidenceCandidates:");
    console.log("    • high_quality_only: 4 → 3");
    console.log("    • fringe_on_support: 4 → 3");
    console.log("    • balanced_all_claims: 9 → 6");
    console.log("");
    console.log("🎯 This will reduce the number of sources pulled during scraping.");

  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

runMigration();
