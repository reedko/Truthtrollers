// backend/migrations/run-admiralty-migration.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = mysql.createPool({
  host:     process.env.DB_HOST || "localhost",
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

const sql = fs.readFileSync(
  path.join(__dirname, "create-admiralty-evaluations.sql"),
  "utf8"
);

try {
  await pool.query(sql);
  console.log("✅ admiralty_evaluations table ready.");
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
