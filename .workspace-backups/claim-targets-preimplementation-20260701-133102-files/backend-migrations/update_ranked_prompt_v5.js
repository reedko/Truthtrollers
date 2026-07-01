// backend/migrations/update_ranked_prompt_v5.js
// Updates claim extraction to REQUIRE main thesis as first claim + be more conservative on count

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config(); // Use production .env

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "truthtrollers",
};

async function updatePrompts() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("🔄 Updating claim extraction prompts to v5 (require main thesis)...");

    // ========================================
    // RANKED MODE: User Prompt (with topics) - V5
    // ========================================
    const rankedWithTopics = `TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract {{minClaims}}-{{maxClaims}} MOST IMPORTANT, VERIFIABLE claims from the text.

   ⚠️ CRITICAL: Your FIRST claim MUST be the article's MAIN THESIS or central argument.

   EXTRACTION STRATEGY (two-tier approach):

   TIER 1 - THEMATIC CLAIMS (1-2 claims, REQUIRED):
   • The article's central argument or conclusion
   • What is the author's main point? What are they trying to convince you of?
   • This can be broader/more subjective than other claims
   • Examples:
     ✅ "COVID-19 vaccines pose serious safety risks that justify policy reconsideration"
     ✅ "Cancer screening programs cause more harm than benefit due to overdiagnosis"
     ✅ "Current medical guidelines on cholesterol are based on flawed science"

   TIER 2 - SUPPORTING EVIDENCE (remaining claims, ATOMIC):
   • Extract ATOMIC claims - break compound statements into separate claims
   • Study findings, statistical data, comparative claims, historical precedents
   • Expert opinions and statements
   • Each must be FALSIFIABLE and SELF-CONTAINED

   RANKING CRITERIA FOR TIER 2:
   a) MATERIALITY: Directly supports the main thesis
   b) CONTROVERSY: Genuinely disputed, surprising, or counterintuitive
   c) SPECIFICITY: Concrete, falsifiable, with numbers/dates/names

   ATOMIC EXTRACTION RULES:

   ✅ EXTRACT SEPARATELY:
   - Study findings (what the study found)
   - Comparative claims (X compared to Y, X higher/lower than Y)
   - Causal claims (X caused Y, X was pulled because of Y)
   - Historical precedents (past events, previous decisions)
   - Expert opinions about those findings

   COMPLETE EXAMPLE:
   Article: "Vaccines are more dangerous than we're told. A 2022 study found 1 in 800 adverse events. The 1976 swine flu vaccine was pulled for much smaller rates. Health officials are ignoring these warning signs."

   ✅ CORRECT extraction (thesis first, then atomic evidence):
   1. [THESIS] "COVID-19 vaccines pose significant safety concerns that are being underreported by health authorities"
   2. [EVIDENCE] "A 2022 peer-reviewed analysis found that Pfizer and Moderna COVID-19 vaccines were linked to serious adverse events in approximately 1 in 800 people"
   3. [EVIDENCE] "The U.S. swine flu vaccine was pulled in 1976 due to adverse event rates far smaller than 1 in 800"

   ❌ WRONG - Missing the thesis claim:
   1. "A 2022 study found 1 in 800 adverse events"
   2. "The swine flu vaccine was pulled in 1976"

   REQUIREMENTS:
   - FIRST claim = article's main thesis/argument (REQUIRED - even if somewhat broad)
   - REMAINING claims = specific, atomic, falsifiable evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - AVOID: Combining multiple assertions into one claim, vague opinions without data
   - Phrase each claim as a complete, specific sentence

   QUANTITY GUIDANCE:
   • Aim for QUALITY over QUANTITY
   • Target {{minClaims}}-{{maxClaims}} claims based on article depth
   • Extract all genuinely important, distinct, verifiable claims
   • Better to extract fewer strong claims than many mediocre ones

   MORE EXAMPLES:
   ✅ GOOD THESIS: "Medical screening programs lead to widespread overtreatment and patient harm"
   ✅ GOOD EVIDENCE: "Cancer prescreening programs led to 1 million overtreatment cases in the US from 2000-2020"
   ✅ GOOD EVIDENCE: "PSA testing for prostate cancer has an 80% false positive rate"
   ✅ GOOD EVIDENCE: "A rotavirus vaccine was pulled in 1999 due to adverse event concerns"
   ❌ BAD: "Some people think prescreening is bad" (too vague, no specifics)
   ❌ BAD: "Studies show vaccines have risks" (too vague, lacks detail)

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").`;

    // Get current max version
    const [versionResult] = await connection.execute(
      `SELECT COALESCE(MAX(version), 0) as maxVersion
       FROM llm_prompts
       WHERE prompt_name = 'claim_extraction_ranked_with_topics'`
    );
    const nextVersion = (versionResult[0]?.maxVersion || 0) + 1;

    // Deactivate old versions
    await connection.execute(
      `UPDATE llm_prompts
       SET is_active = FALSE
       WHERE prompt_name = 'claim_extraction_ranked_with_topics'`
    );

    // Get max prompt_id
    const [maxIdResult] = await connection.execute(
      'SELECT COALESCE(MAX(prompt_id), 0) as maxId FROM llm_prompts'
    );
    const nextId = (maxIdResult[0]?.maxId || 0) + 1;

    // Insert new version
    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active, max_claims)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId,
        'claim_extraction_ranked_with_topics',
        'user',
        rankedWithTopics,
        JSON.stringify({ max_claims: 12 }), // Allow up to 12 claims
        nextVersion,
        true,
        12, // max_claims column value
      ]
    );

    console.log(`✅ Created claim_extraction_ranked_with_topics v${nextVersion}`);
    console.log(`   - REQUIRES main thesis as first claim`);
    console.log(`   - Two-tier structure: thesis + atomic evidence`);
    console.log(`   - Range: 5-12 claims based on article depth and importance`);

    console.log("\n✅ Update complete!");
    console.log("\n📋 Current active prompts:");
    const [prompts] = await connection.execute(
      `SELECT prompt_name, version, is_active
       FROM llm_prompts
       WHERE prompt_name LIKE 'claim_extraction_ranked%'
       AND is_active = TRUE
       ORDER BY prompt_name`
    );
    console.table(prompts);

  } catch (err) {
    console.error("❌ Error updating prompts:", err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

// Run the update
updatePrompts()
  .then(() => {
    console.log("\n🎉 Migration complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Migration failed:", err);
    process.exit(1);
  });
