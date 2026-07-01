// Fix max_claims column - currently stuck at 4, increase to 6+
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
};

async function fixMaxClaims() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("🔧 Fixing max_claims column (currently set to 4)...\n");

    // Show current state
    const [before] = await connection.execute(
      `SELECT prompt_name, version, is_active, max_claims, parameters
       FROM llm_prompts
       WHERE prompt_name LIKE 'claim_extraction_ranked%'
         AND is_active = TRUE
       ORDER BY prompt_name`
    );

    console.log("📊 BEFORE UPDATE:");
    console.table(before.map(p => ({
      prompt: p.prompt_name,
      version: p.version,
      max_claims_col: p.max_claims,
      parameters: p.parameters
    })));

    // Update max_claims column to 12 for all active ranked prompts
    const NEW_MAX_CLAIMS = 12;

    await connection.execute(
      `UPDATE llm_prompts
       SET max_claims = ?
       WHERE prompt_name LIKE 'claim_extraction_ranked%'
         AND is_active = TRUE`,
      [NEW_MAX_CLAIMS]
    );

    console.log(`\n✅ Updated max_claims column to ${NEW_MAX_CLAIMS} for all active ranked prompts\n`);

    // Show after state
    const [after] = await connection.execute(
      `SELECT prompt_name, version, is_active, max_claims, parameters
       FROM llm_prompts
       WHERE prompt_name LIKE 'claim_extraction_ranked%'
         AND is_active = TRUE
       ORDER BY prompt_name`
    );

    console.log("📊 AFTER UPDATE:");
    console.table(after.map(p => ({
      prompt: p.prompt_name,
      version: p.version,
      max_claims_col: p.max_claims,
      parameters: p.parameters
    })));

    console.log("\n✅ Migration complete!");
    console.log(`\n⚠️  NOTE: This updates the max_claims COLUMN, not the parameters JSON.`);
    console.log(`   The ClaimExtractor code uses this column value to determine max claims.`);

  } catch (err) {
    console.error("❌ Error:", err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

fixMaxClaims()
  .then(() => {
    console.log("\n🎉 Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Failed:", err);
    process.exit(1);
  });
