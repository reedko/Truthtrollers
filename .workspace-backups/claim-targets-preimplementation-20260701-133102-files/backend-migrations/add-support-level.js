// Add support_level column to reference_claim_links
// Stores calculated veracity: stance * confidence * quality
// Range: -1.0 to +1.0 (negative = refutes, positive = supports)

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
    console.log("🔍 Checking current reference_claim_links schema...");
    const currentSchema = await query("DESCRIBE reference_claim_links");
    console.table(currentSchema);

    const supportLevelField = currentSchema.find((f) => f.Field === "support_level");

    if (!supportLevelField) {
      console.log("\n⚠️  support_level column missing - adding it...");

      await query(`
        ALTER TABLE reference_claim_links
        ADD COLUMN support_level DECIMAL(6,4) DEFAULT NULL
        AFTER confidence
      `);

      console.log("✅ Successfully added support_level column");
    } else {
      console.log("\n✅ support_level column already exists - no changes needed");
    }

    console.log("\n🔍 Updated schema:");
    const updatedSchema = await query("DESCRIBE reference_claim_links");
    console.table(updatedSchema);

    console.log("\n📊 Sample support_level values:");
    const samples = await query(`
      SELECT claim_id, reference_content_id, stance, confidence, support_level
      FROM reference_claim_links
      ORDER BY ABS(support_level) DESC
      LIMIT 10
    `);
    console.table(samples);
  } catch (err) {
    console.error("❌ Migration failed:", err);
  } finally {
    db.end();
  }
}

run();
