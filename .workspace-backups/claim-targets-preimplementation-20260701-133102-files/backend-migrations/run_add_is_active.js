import dotenv from "dotenv";
dotenv.config();

import mysql from "mysql";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

const query = promisify(db.query).bind(db);

async function run() {
  try {
    console.log("📝 Adding is_active column to content table...");

    const sql = await fs.readFile(
      path.join(__dirname, "add_is_active_to_content.sql"),
      "utf-8"
    );

    // Execute ALTER TABLE
    await query(`
      ALTER TABLE content
      ADD COLUMN is_active TINYINT DEFAULT 1 AFTER is_retracted
    `);
    console.log("✅ Added is_active column");

    // Create index
    await query(`
      CREATE INDEX idx_content_is_active ON content(is_active)
    `);
    console.log("✅ Created index on is_active");

    console.log("✅ Migration completed successfully");

    // Verify the column was added
    const schema = await query("DESCRIBE content");
    const isActiveColumn = schema.find((col) => col.Field === "is_active");

    if (isActiveColumn) {
      console.log("✅ Verified: is_active column exists");
      console.log(isActiveColumn);
    } else {
      console.error("❌ Error: is_active column not found after migration");
    }

  } catch (err) {
    if (err.code === "ER_DUP_FIELDNAME") {
      console.log("⚠️  Column already exists, skipping migration");
    } else {
      console.error("❌ Migration failed:", err);
    }
  } finally {
    db.end();
  }
}

run();
