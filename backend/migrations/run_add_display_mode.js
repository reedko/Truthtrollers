// Add display_mode column to molecule_views
import dotenv from "dotenv";
dotenv.config();

import mysql from "mysql";
import { promisify } from "util";

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

const query = promisify(db.query).bind(db);

async function run() {
  try {
    console.log("🔍 Checking molecule_views schema...");
    const currentSchema = await query("DESCRIBE molecule_views");

    const displayModeField = currentSchema.find((f) => f.Field === "display_mode");

    if (!displayModeField) {
      console.log("\n⚠️  display_mode column missing - adding it...");

      await query(`
        ALTER TABLE molecule_views
        ADD COLUMN display_mode VARCHAR(50) DEFAULT 'mr_cards'
        AFTER is_default
      `);

      console.log("✅ Successfully added display_mode column");
    } else {
      console.log("\n✅ display_mode column already exists - no changes needed");
    }

    console.log("\n🔍 Updated schema:");
    const updatedSchema = await query("DESCRIBE molecule_views");
    console.table(updatedSchema);
  } catch (err) {
    console.error("❌ Migration failed:", err);
  } finally {
    db.end();
  }
}

run();
