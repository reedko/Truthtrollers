// backend/migrations/update_claim_extraction_prompts_atomic.js
// Updates claim extraction prompts to better handle atomic claims (comparative, causal, historical)

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "truthtrollers_user",
  password: process.env.DB_PASSWORD || "yourpassword",
  database: process.env.DB_DATABASE || "truthtrollers_db",
};

async function updatePrompts() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("🔄 Updating claim extraction prompts for atomic claim extraction...");

    // ========================================
    // RANKED MODE: User Prompt (with topics)
    // ========================================
    const rankedWithTopics = `TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract the {{minClaims}}-{{maxClaims}} MOST IMPORTANT, VERIFIABLE claims from the text.

   RANKING CRITERIA (prioritize in this order):
   a) MATERIALITY: Central to the article's main thesis or argument
   b) CONTROVERSY: Genuinely disputed, surprising, or counterintuitive
   c) SPECIFICITY: Concrete, falsifiable, with numbers/dates/names

   CRITICAL: Extract ATOMIC claims - break compound statements into separate claims:

   ✅ EXTRACT SEPARATELY:
   - Study findings (what the study found)
   - Comparative claims (X compared to Y, X higher/lower than Y)
   - Causal claims (X caused Y, X was pulled because of Y)
   - Historical precedents (past events, previous decisions)
   - Expert opinions/statements about those findings

   EXAMPLES OF ATOMIC EXTRACTION:
   Article: "A 2022 study found vaccines had 1 in 800 adverse events. The 1976 swine flu vaccine was pulled for rates far smaller than this."

   ✅ CORRECT - Extract as 2 atomic claims:
   1. "A 2022 peer-reviewed analysis found that Pfizer and Moderna COVID-19 vaccines were linked to serious adverse events in approximately 1 in 800 people"
   2. "The U.S. swine flu vaccine was pulled in 1976 due to adverse event rates far smaller than 1 in 800"

   ❌ WRONG - Don't combine into 1 claim:
   "A 2022 study found 1 in 800 adverse events, and the swine flu vaccine was pulled for lower rates"

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - INCLUDE: Claims with concrete data, study findings, comparative statements, historical precedents
   - INCLUDE: "There was a study" is GOOD if you specify what study, when, and what it found specifically
   - AVOID: Combining multiple assertions into one claim, vague opinions without data
   - Phrase each claim as a complete, specific sentence

   MORE EXAMPLES:
   ✅ GOOD: "Cancer prescreening programs led to 1 million overtreatment cases in the US from 2000-2020"
   ✅ GOOD: "PSA testing for prostate cancer has an 80% false positive rate"
   ✅ GOOD: "A rotavirus vaccine was pulled in 1999 due to adverse event concerns"
   ✅ GOOD: "According to Dr. Malhotra, the adverse event rate of 1 in 800 exceeds historical thresholds for vaccine withdrawal"
   ❌ BAD: "Some people think prescreening is bad" (opinion without specifics)
   ❌ BAD: "Studies show vaccines have risks" (too vague, no specifics)

   Return the top {{maxClaims}} claims. Prioritize breaking related evidence into atomic claims.

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").`;

    await connection.execute(
      `UPDATE llm_prompts
       SET prompt_text = ?, version = version + 1
       WHERE prompt_name = ?`,
      [rankedWithTopics, 'claim_extraction_ranked_with_topics']
    );
    console.log("✅ Updated: claim_extraction_ranked_with_topics");

    // ========================================
    // RANKED MODE: User Prompt (no topics)
    // ========================================
    const rankedNoTopics = `TASKS
1) Extract the {{minClaims}}-{{maxClaims}} MOST IMPORTANT, VERIFIABLE claims from the text.

   RANKING CRITERIA (prioritize in this order):
   a) MATERIALITY: Central to the article's main thesis or argument
   b) CONTROVERSY: Genuinely disputed, surprising, or counterintuitive
   c) SPECIFICITY: Concrete, falsifiable, with numbers/dates/names

   CRITICAL: Extract ATOMIC claims - break compound statements into separate claims:

   ✅ EXTRACT SEPARATELY:
   - Study findings (what the study found)
   - Comparative claims (X compared to Y, X higher/lower than Y)
   - Causal claims (X caused Y, X was pulled because of Y)
   - Historical precedents (past events, previous decisions)
   - Expert opinions/statements about those findings

   EXAMPLES OF ATOMIC EXTRACTION:
   Article: "A 2022 study found vaccines had 1 in 800 adverse events. The 1976 swine flu vaccine was pulled for rates far smaller than this."

   ✅ CORRECT - Extract as 2 atomic claims:
   1. "A 2022 peer-reviewed analysis found that Pfizer and Moderna COVID-19 vaccines were linked to serious adverse events in approximately 1 in 800 people"
   2. "The U.S. swine flu vaccine was pulled in 1976 due to adverse event rates far smaller than 1 in 800"

   ❌ WRONG - Don't combine into 1 claim:
   "A 2022 study found 1 in 800 adverse events, and the swine flu vaccine was pulled for lower rates"

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - INCLUDE: Claims with concrete data, study findings, comparative statements, historical precedents
   - INCLUDE: "There was a study" is GOOD if you specify what study, when, and what it found specifically
   - AVOID: Combining multiple assertions into one claim, vague opinions without data
   - Phrase each claim as a complete, specific sentence

   MORE EXAMPLES:
   ✅ GOOD: "Cancer prescreening programs led to 1 million overtreatment cases in the US from 2000-2020"
   ✅ GOOD: "PSA testing for prostate cancer has an 80% false positive rate"
   ✅ GOOD: "A rotavirus vaccine was pulled in 1999 due to adverse event concerns"
   ✅ GOOD: "According to Dr. Malhotra, the adverse event rate of 1 in 800 exceeds historical thresholds for vaccine withdrawal"
   ❌ BAD: "Some people think prescreening is bad" (opinion without specifics)
   ❌ BAD: "Studies show vaccines have risks" (too vague, no specifics)

   Return the top {{maxClaims}} claims. Prioritize breaking related evidence into atomic claims.

2) Do NOT invent topics or testimonials in this mode.`;

    await connection.execute(
      `UPDATE llm_prompts
       SET prompt_text = ?, version = version + 1
       WHERE prompt_name = ?`,
      [rankedNoTopics, 'claim_extraction_ranked_no_topics']
    );
    console.log("✅ Updated: claim_extraction_ranked_no_topics");

    console.log("\n✅ All prompts updated successfully!");
    console.log("\n📋 Updated prompt summary:");
    const prompts = await connection.execute(
      `SELECT prompt_id, prompt_name, version, is_active
       FROM llm_prompts
       WHERE prompt_name LIKE 'claim_extraction_ranked%'
       ORDER BY prompt_id`
    );
    console.table(prompts[0]);

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
    console.log("\n🎉 Update complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Update failed:", err);
    process.exit(1);
  });
