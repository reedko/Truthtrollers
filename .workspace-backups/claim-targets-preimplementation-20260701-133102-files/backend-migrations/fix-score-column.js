// Change score column in reference_claim_links from INT to DECIMAL(5,2)
// This allows storing quality scores like 0.85 as 85.00 (0-100 range with 2 decimal places)

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

    const scoreField = currentSchema.find((f) => f.Field === "score");
    console.log("\n📋 Current score field:", scoreField);

    if (scoreField && scoreField.Type.includes("int")) {
      console.log("\n⚠️  Score is INT - changing to DECIMAL(5,2)");
      console.log("🔧 Altering column...");

      await query(`
        ALTER TABLE reference_claim_links
        MODIFY COLUMN score DECIMAL(5,2) DEFAULT 0.00
      `);

      console.log("✅ Successfully changed score to DECIMAL(5,2)");
    } else if (scoreField && scoreField.Type.includes("decimal")) {
      console.log("\n✅ Score is already DECIMAL - no changes needed");
    } else {
      console.log("\n❓ Score field not found or unexpected type");
    }

    console.log("\n🔍 Updated schema:");
    const updatedSchema = await query("DESCRIBE reference_claim_links");
    console.table(updatedSchema);

    console.log("\n📊 Sample score values:");
    const samples = await query(`
      SELECT claim_id, reference_content_id, score, stance
      FROM reference_claim_links
      ORDER BY score DESC
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
