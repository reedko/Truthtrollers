// Quick script to check claim extraction prompts
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config(); // Use production .env

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "truthtrollers",
};

async function checkPrompts() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("\n📋 Checking PRODUCTION claim_extraction_ranked prompts...\n");
    console.log(`Database: ${dbConfig.host} / ${dbConfig.database}\n`);

    // Get all versions with their settings
    const [allVersions] = await connection.execute(
      `SELECT prompt_name, version, is_active, parameters, max_claims,
              SUBSTRING(prompt_text, 1, 200) as preview
       FROM llm_prompts
       WHERE prompt_name LIKE 'claim_extraction_ranked%'
       ORDER BY prompt_name, version DESC`
    );

    console.log('📊 ALL VERSIONS:');
    console.table(allVersions.map(p => ({
      prompt: p.prompt_name,
      version: p.version,
      active: p.is_active ? '✅' : '❌',
      max_claims: p.max_claims,
      parameters: p.parameters
    })));

    // Get active prompts
    const [active] = await connection.execute(
      `SELECT prompt_name, version, parameters, max_claims, prompt_text
       FROM llm_prompts
       WHERE prompt_name LIKE 'claim_extraction_ranked%'
         AND is_active = TRUE
       ORDER BY prompt_name`
    );

    console.log('\n\n🎯 CURRENTLY ACTIVE PROMPTS IN PRODUCTION:');
    active.forEach(p => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`${p.prompt_name} v${p.version}`);
      console.log(`max_claims: ${p.max_claims}`);
      console.log(`parameters: ${p.parameters}`);
      console.log(`${'='.repeat(80)}`);
      console.log(p.prompt_text);
      console.log('\n');
    });

    if (active.length === 0) {
      console.log('⚠️ WARNING: No active prompts found!');
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await connection.end();
  }
}

checkPrompts().catch(console.error);
