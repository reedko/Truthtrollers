// Fix authors.description column size
// Error: ER_DATA_TOO_LONG: Data too long for column 'bio' at row 1
// (Error message says "bio" but actual column is "description")

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
    console.log("🔍 Checking current schema...");
    const currentSchema = await query("DESCRIBE authors");
    console.table(currentSchema);

    const descField = currentSchema.find((f) => f.Field === "description");
    console.log("\n📋 Current description field:", descField);

    if (descField && descField.Type.includes("varchar")) {
      console.log("\n⚠️  Description is VARCHAR - needs to be TEXT");
      console.log("🔧 Altering column...");

      await query(`
        ALTER TABLE authors
        MODIFY COLUMN description TEXT NULL
      `);

      console.log("✅ Successfully changed description to TEXT");
    } else if (descField && descField.Type === "text") {
      console.log("\n✅ Description is already TEXT - no changes needed");
    } else {
      console.log("\n❓ Description field not found or unexpected type");
    }

    console.log("\n🔍 Updated schema:");
    const updatedSchema = await query("DESCRIBE authors");
    console.table(updatedSchema);
  } catch (err) {
    console.error("❌ Migration failed:", err);
  } finally {
    db.end();
  }
}

run();
