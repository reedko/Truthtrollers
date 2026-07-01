// backend/migrations/add_evidence_query_prompt.js
// Adds evidence_query_generation prompt to llm_prompts table

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "truthtrollers_user",
  password: process.env.DB_PASSWORD || "yourpassword",
  database: process.env.DB_DATABASE || "truthtrollers_db",
};

async function addEvidenceQueryPrompt() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("🌱 Adding evidence_query_generation prompt...");

    // Get max prompt_id
    const maxIdResult = await connection.execute(
      'SELECT COALESCE(MAX(prompt_id), 0) as maxId FROM llm_prompts'
    );
    const nextId = (maxIdResult[0][0]?.maxId || 0) + 1;

    // System prompt
    const systemPrompt = `You generate diverse, high-precision search queries for fact-checking. CRITICAL: You must create queries designed to find sources that SUPPORT, REFUTE, and provide NUANCED perspectives on the claim.`;

    // User prompt template
    const userPrompt = `Claim: {{claimText}}
Context: {{context}}

Task: Produce {{n}} queries across intents with the following distribution:
- At least 2 queries designed to find sources that SUPPORT the claim (prefer 3)
- At least 2 queries designed to find sources that REFUTE the claim (prefer 3)
- At least 1 query designed to find sources that provide NUANCED perspective on the claim (prefer 3)
- The remaining queries can cover background or factbox information

IMPORTANT: Design your queries to actively seek out sources with different perspectives. For refute queries, look for credible counterarguments, debunking sites, fact-checks, or alternative evidence. For support queries, look for sources that would confirm or provide evidence for the claim. For nuance queries, look for sources that provide context, caveats, or partial support/refutation.`;

    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId,
        'evidence_query_generation_system',
        'system',
        systemPrompt,
        JSON.stringify({}),
        1,
        true,
      ]
    );
    console.log("✅ Inserted: evidence_query_generation_system");

    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId + 1,
        'evidence_query_generation_user',
        'user',
        userPrompt,
        JSON.stringify({ n: 6 }),
        1,
        true,
      ]
    );
    console.log("✅ Inserted: evidence_query_generation_user");

    console.log("\n✅ Evidence query generation prompts added successfully!");
    console.log("\n📋 Current prompts in database:");
    const prompts = await connection.execute(
      `SELECT prompt_id, prompt_name, version, is_active FROM llm_prompts ORDER BY prompt_id`
    );
    console.table(prompts[0]);

  } catch (err) {
    console.error("❌ Error adding prompts:", err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

// Run the migration
addEvidenceQueryPrompt()
  .then(() => {
    console.log("\n🎉 Migration complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Migration failed:", err);
    process.exit(1);
  });
