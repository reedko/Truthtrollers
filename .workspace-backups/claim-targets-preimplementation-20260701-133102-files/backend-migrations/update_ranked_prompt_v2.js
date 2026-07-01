// backend/migrations/update_ranked_prompt_v2.js
// Updates the ranked extraction prompt to better capture thesis claims

import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "truthtrollers_user",
  password: process.env.DB_PASSWORD || "yourpassword",
  database: process.env.DB_DATABASE || "truthtrollers_db",
};

async function updatePrompt() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("🔄 Updating ranked extraction prompts to v2...");

    // Deactivate v1
    await connection.execute(
      `UPDATE llm_prompts
       SET is_active = FALSE
       WHERE prompt_name IN ('claim_extraction_ranked_with_topics', 'claim_extraction_ranked_no_topics')`
    );

    // ========================================
    // IMPROVED RANKED PROMPT (with topics) - v2
    // ========================================
    const improvedRankedWithTopics = `TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract ONLY the {{minClaims}}-{{maxClaims}} MOST IMPORTANT, VERIFIABLE claims from the text.

   🎯 PRIORITIZATION STRATEGY (follow this order):

   a) **THESIS/CONCLUSION CLAIMS** (HIGHEST PRIORITY)
      - What is the article's MAIN ARGUMENT or conclusion?
      - Claims that state "X study suggests Y failed/succeeded"
      - Claims that challenge or support a major position
      - The claim someone would cite to summarize this article's point
      - Example: "The European screening study suggests PSA testing failed to reduce overall mortality"

   b) **KEY SUPPORTING EVIDENCE** (SECOND PRIORITY)
      - Specific data/findings that directly support the thesis
      - Claims with concrete numbers, percentages, outcomes
      - Example: "Screening reduced prostate cancer deaths by 21% but increased overdiagnosis by 50%"

   c) **COUNTERPOINTS/NUANCE** (THIRD PRIORITY, if space)
      - Significant objections or alternative interpretations
      - Limitations acknowledged by the author

   ❌ AVOID (These are NOT the claims we want):
   - Background context ("PSA testing was introduced in 1986")
   - Methodology details ("The study included 182,000 men")
   - Generic statements ("Early detection can save lives" - unless this IS the thesis being challenged)
   - Obvious facts ("Prostate cancer is common in older men")

   ✅ REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (study name, timeframe, subjects)
   - PRIORITIZE: Claims that state CONCLUSIONS/FINDINGS over claims that state METHODS/BACKGROUND
   - Include numbers/dates/names where they appear in thesis/evidence claims

   📝 GOOD EXAMPLES (prioritize claims like these):
   ✅ "The 23-year European prostate cancer screening study found screening failed to reduce overall mortality"
   ✅ "PSA testing led to 1.3 million overtreatments in the US from 2000-2020"
   ✅ "The US Preventive Services Task Force downgraded PSA screening recommendations in 2012"

   ❌ BAD EXAMPLES (avoid these types):
   ❌ "There was a European study about prostate screening" (too vague, no conclusion)
   ❌ "The study included 182,000 men across multiple countries" (methodology, not finding)
   ❌ "Prostate cancer is the second leading cause of cancer death" (background context)

   🎯 Return the {{maxClaims}} claims that best represent the article's ARGUMENT and KEY EVIDENCE.
      Think: "If I could only extract a few claims to fact-check this article's main point, which would they be?"

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").`;

    // ========================================
    // IMPROVED RANKED PROMPT (no topics) - v2
    // ========================================
    const improvedRankedNoTopics = `TASKS
1) Extract ONLY the {{minClaims}}-{{maxClaims}} MOST IMPORTANT, VERIFIABLE claims from the text.

   🎯 PRIORITIZATION STRATEGY (follow this order):

   a) **THESIS/CONCLUSION CLAIMS** (HIGHEST PRIORITY)
      - What is the article's MAIN ARGUMENT or conclusion?
      - Claims that state "X study suggests Y failed/succeeded"
      - Claims that challenge or support a major position
      - The claim someone would cite to summarize this article's point
      - Example: "The European screening study suggests PSA testing failed to reduce overall mortality"

   b) **KEY SUPPORTING EVIDENCE** (SECOND PRIORITY)
      - Specific data/findings that directly support the thesis
      - Claims with concrete numbers, percentages, outcomes
      - Example: "Screening reduced prostate cancer deaths by 21% but increased overdiagnosis by 50%"

   c) **COUNTERPOINTS/NUANCE** (THIRD PRIORITY, if space)
      - Significant objections or alternative interpretations
      - Limitations acknowledged by the author

   ❌ AVOID (These are NOT the claims we want):
   - Background context ("PSA testing was introduced in 1986")
   - Methodology details ("The study included 182,000 men")
   - Generic statements ("Early detection can save lives" - unless this IS the thesis being challenged)
   - Obvious facts ("Prostate cancer is common in older men")

   ✅ REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (study name, timeframe, subjects)
   - PRIORITIZE: Claims that state CONCLUSIONS/FINDINGS over claims that state METHODS/BACKGROUND
   - Include numbers/dates/names where they appear in thesis/evidence claims

   📝 GOOD EXAMPLES (prioritize claims like these):
   ✅ "The 23-year European prostate cancer screening study found screening failed to reduce overall mortality"
   ✅ "PSA testing led to 1.3 million overtreatments in the US from 2000-2020"
   ✅ "The US Preventive Services Task Force downgraded PSA screening recommendations in 2012"

   ❌ BAD EXAMPLES (avoid these types):
   ❌ "There was a European study about prostate screening" (too vague, no conclusion)
   ❌ "The study included 182,000 men across multiple countries" (methodology, not finding)
   ❌ "Prostate cancer is the second leading cause of cancer death" (background context)

   🎯 Return the {{maxClaims}} claims that best represent the article's ARGUMENT and KEY EVIDENCE.
      Think: "If I could only extract a few claims to fact-check this article's main point, which would they be?"

2) Do NOT invent topics or testimonials in this mode.`;

    // Get next prompt IDs
    const [maxIdResult] = await connection.execute(
      'SELECT COALESCE(MAX(prompt_id), 0) as maxId FROM llm_prompts'
    );
    let nextId = (maxIdResult[0]?.maxId || 6) + 1;

    // Insert v2 with topics
    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId++,
        'claim_extraction_ranked_with_topics',
        'user',
        improvedRankedWithTopics,
        JSON.stringify({ minClaims: 3, maxClaims: 9 }),
        2,
        true,
      ]
    );
    console.log("✅ Inserted: claim_extraction_ranked_with_topics v2");

    // Insert v2 without topics
    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId++,
        'claim_extraction_ranked_no_topics',
        'user',
        improvedRankedNoTopics,
        JSON.stringify({ minClaims: 3, maxClaims: 9 }),
        2,
        true,
      ]
    );
    console.log("✅ Inserted: claim_extraction_ranked_no_topics v2");

    console.log("\n✅ Prompts updated to v2!");
    console.log("\n📋 Active prompts:");
    const [prompts] = await connection.execute(
      `SELECT prompt_name, version, is_active
       FROM llm_prompts
       WHERE is_active = TRUE
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
updatePrompt()
  .then(() => {
    console.log("\n🎉 Update complete! Clear the prompt cache:");
    console.log("   curl -X POST http://localhost:5001/api/prompts/clear-cache");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Update failed:", err);
    process.exit(1);
  });
