// backend/migrations/fix_edge_prompts.js
// Fixes scrambled claim_extraction_edge_* prompts in llm_prompts table.
// These were manually created with source quality assessment content by mistake.
// This migration deactivates the bad versions and inserts correct ones.

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "truthtrollers_user",
  password: process.env.DB_PASSWORD || "yourpassword",
  database: process.env.DB_DATABASE || "truthtrollers_db",
};

const EDGE_SYSTEM = `You are a precise claim extraction assistant. You must return strictly valid JSON.`;

const EDGE_WITH_TOPICS = `TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract the {{minClaims}}–{{maxClaims}} SHARPEST, most impactful verifiable claims from the text.

   EDGE MODE — be ruthless. Only extract claims that meet ALL of:
   a) SPECIFICITY: concrete numbers, dates, named entities, or clearly falsifiable assertions
   b) CONTROVERSY: genuinely disputed, surprising, or counterintuitive
   c) MATERIALITY: central to the article's main argument or thesis

   CRITICAL: Extract ATOMIC claims — break compound statements into separate claims:

   ✅ EXTRACT SEPARATELY:
   - Study findings (what the study found, with specifics)
   - Comparative claims (X compared to Y, X higher/lower than Y)
   - Causal claims (X caused Y)
   - Historical precedents (past events, previous decisions)
   - Expert opinions/statements with concrete content

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - Phrase each claim as a complete, specific sentence
   - Return only the top {{maxClaims}} highest-impact claims

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").`;

const EDGE_NO_TOPICS = `TASKS
1) Extract the {{minClaims}}–{{maxClaims}} SHARPEST, most impactful verifiable claims from the text.

   EDGE MODE — be ruthless. Only extract claims that meet ALL of:
   a) SPECIFICITY: concrete numbers, dates, named entities, or clearly falsifiable assertions
   b) CONTROVERSY: genuinely disputed, surprising, or counterintuitive
   c) MATERIALITY: central to the article's main argument or thesis

   CRITICAL: Extract ATOMIC claims — break compound statements into separate claims.

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - Phrase each claim as a complete, specific sentence
   - Return only the top {{maxClaims}} highest-impact claims

2) Do NOT invent topics or testimonials in this mode.`;

async function fixEdgePrompts() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("🔧 Fixing scrambled claim_extraction_edge_* prompts...\n");

    // Show current state
    const [current] = await connection.execute(
      `SELECT prompt_name, version, is_active, LEFT(prompt_text, 80) AS preview
       FROM llm_prompts
       WHERE prompt_name LIKE 'claim_extraction_edge%'
       ORDER BY prompt_name, version`
    );
    console.log("📋 Current edge prompts in DB:");
    console.table(current);

    const promptsToFix = [
      {
        name: "claim_extraction_edge_system",
        type: "system",
        text: EDGE_SYSTEM,
        parameters: {},
      },
      {
        name: "claim_extraction_edge_with_topics",
        type: "user",
        text: EDGE_WITH_TOPICS,
        parameters: { minClaims: 3, maxClaims: 7 },
      },
      {
        name: "claim_extraction_edge_no_topics",
        type: "user",
        text: EDGE_NO_TOPICS,
        parameters: { minClaims: 3, maxClaims: 7 },
      },
    ];

    for (const prompt of promptsToFix) {
      // Deactivate all existing versions
      const [deactivated] = await connection.execute(
        `UPDATE llm_prompts SET is_active = FALSE WHERE prompt_name = ?`,
        [prompt.name]
      );
      console.log(`⏸  Deactivated ${deactivated.affectedRows} existing version(s) of ${prompt.name}`);

      // Get max existing version
      const [rows] = await connection.execute(
        `SELECT COALESCE(MAX(version), 0) AS max_ver FROM llm_prompts WHERE prompt_name = ?`,
        [prompt.name]
      );
      const newVersion = rows[0].max_ver + 1;

      // Insert correct new version
      await connection.execute(
        `INSERT INTO llm_prompts (prompt_name, prompt_type, prompt_text, parameters, version, is_active)
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [prompt.name, prompt.type, prompt.text, JSON.stringify(prompt.parameters), newVersion]
      );
      console.log(`✅ Inserted correct ${prompt.name} v${newVersion}`);
    }

    // Verify
    const [after] = await connection.execute(
      `SELECT prompt_name, version, is_active, LEFT(prompt_text, 80) AS preview
       FROM llm_prompts
       WHERE prompt_name LIKE 'claim_extraction_edge%'
       ORDER BY prompt_name, version`
    );
    console.log("\n📋 Edge prompts after fix:");
    console.table(after);

    console.log("\n✅ Edge prompt fix complete!");

  } catch (err) {
    console.error("❌ Error:", err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

fixEdgePrompts()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
