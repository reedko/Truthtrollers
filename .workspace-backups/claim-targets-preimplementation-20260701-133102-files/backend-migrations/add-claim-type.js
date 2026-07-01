// Add claim_type column to claims table
// Allows distinguishing between:
// - 'task': Claims extracted from task content
// - 'reference': Claims extracted from reference content
// - 'snippet': Search engine snippet saved as a claim (for failed scrapes)

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
    console.log("🔍 Checking current claims table schema...");
    const currentSchema = await query("DESCRIBE claims");
    console.table(currentSchema);

    const claimTypeField = currentSchema.find((f) => f.Field === "claim_type");

    if (!claimTypeField) {
      console.log("\n⚠️  claim_type column missing - adding it...");

      await query(`
        ALTER TABLE claims
        ADD COLUMN claim_type ENUM('task', 'reference', 'snippet')
        DEFAULT 'task'
        AFTER claim_text
      `);

      console.log("✅ Successfully added claim_type column");

      // Update existing claims to have appropriate types based on content_type
      console.log("\n🔧 Setting claim_type for existing claims...");

      await query(`
        UPDATE claims c
        JOIN content_claims cc ON c.claim_id = cc.claim_id
        JOIN content ct ON cc.content_id = ct.content_id
        SET c.claim_type = CASE
          WHEN ct.content_type = 'task' THEN 'task'
          WHEN ct.content_type = 'reference' THEN 'reference'
          ELSE 'task'
        END
      `);

      console.log("✅ Updated existing claims with claim_type");
    } else {
      console.log("\n✅ claim_type column already exists - no changes needed");
    }

    console.log("\n🔍 Updated schema:");
    const updatedSchema = await query("DESCRIBE claims");
    console.table(updatedSchema);

    console.log("\n📊 Claim type distribution:");
    const distribution = await query(`
      SELECT claim_type, COUNT(*) as count
      FROM claims
      GROUP BY claim_type
    `);
    console.table(distribution);
  } catch (err) {
    console.error("❌ Migration failed:", err);
  } finally {
    db.end();
  }
}

run();
