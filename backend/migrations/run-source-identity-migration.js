// backend/migrations/run-source-identity-migration.js
// Run: node backend/migrations/run-source-identity-migration.js

import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../../.env") });

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "add-source-identity.sql"), "utf8");

const conn = await mysql.createConnection({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});

try {
  console.log("Running source identity migration…");
  await conn.query(sql);
  console.log("✅ publisher_domains and source_identity_cache tables created.");
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
} finally {
  await conn.end();
}
