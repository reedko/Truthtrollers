// Add confidence column to reference_claim_links
// Stores the adjudication confidence for the claim this reference supports/refutes
// Range: 0.0 - 1.0 (typically 0.15 - 0.98)

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

    const confidenceField = currentSchema.find((f) => f.Field === "confidence");

    if (!confidenceField) {
      console.log("\n⚠️  confidence column missing - adding it...");

      await query(`
        ALTER TABLE reference_claim_links
        ADD COLUMN confidence DECIMAL(5,4) DEFAULT NULL
        AFTER score
      `);

      console.log("✅ Successfully added confidence column");
    } else {
      console.log("\n✅ confidence column already exists - no changes needed");
    }

    console.log("\n🔍 Updated schema:");
    const updatedSchema = await query("DESCRIBE reference_claim_links");
    console.table(updatedSchema);

    console.log("\n📊 Sample confidence values:");
    const samples = await query(`
      SELECT claim_id, reference_content_id, score, confidence, stance
      FROM reference_claim_links
      ORDER BY confidence DESC
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
