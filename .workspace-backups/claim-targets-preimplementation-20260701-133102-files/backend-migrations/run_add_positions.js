// Add positions column to molecule_views
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

    const positionsField = currentSchema.find((f) => f.Field === "positions");

    if (!positionsField) {
      console.log("\n⚠️  positions column missing - adding it...");

      await query(`
        ALTER TABLE molecule_views
        ADD COLUMN positions JSON DEFAULT NULL
        AFTER display_mode
      `);

      console.log("✅ Successfully added positions column");
    } else {
      console.log("\n✅ positions column already exists - no changes needed");
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
