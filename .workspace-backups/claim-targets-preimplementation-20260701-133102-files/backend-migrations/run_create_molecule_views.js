// Run migration to create molecule views tables
import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql";
import { promisify } from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  multipleStatements: true,
});

const query = promisify(db.query).bind(db);

async function runMigration() {
  try {
    console.log("📦 Running molecule views migration...");

    // First check if tables already exist
    const existingTables = await query("SHOW TABLES LIKE 'molecule_%'");
    if (existingTables.length > 0) {
      console.log("⚠️  Tables already exist. Dropping them first...");
      await query("DROP TABLE IF EXISTS molecule_view_pins");
      await query("DROP TABLE IF EXISTS molecule_views");
    }

    // Check the users table schema to understand primary key
    console.log("\n🔍 Checking users table schema...");
    const usersSchema = await query("DESCRIBE users");
    console.table(usersSchema);

    // Check the content table schema
    console.log("\n🔍 Checking content table schema...");
    const contentSchema = await query("DESCRIBE content");
    console.table(contentSchema);

    const sql = fs.readFileSync(
      path.join(__dirname, "create_molecule_views.sql"),
      "utf8"
    );

    await query(sql);

    console.log("✅ Molecule views tables created successfully!");

    console.log("\n🔍 Verifying tables...");
    const views = await query("DESCRIBE molecule_views");
    console.log("molecule_views table:");
    console.table(views);

    const pins = await query("DESCRIBE molecule_view_pins");
    console.log("\nmolecule_view_pins table:");
    console.table(pins);
  } catch (error) {
    console.error("❌ Migration failed:", error);
  } finally {
    db.end();
  }
}

runMigration();
