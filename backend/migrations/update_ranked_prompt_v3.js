// backend/migrations/update_ranked_prompt_v3.js
// V3: Capture strong quotes from notable figures + increase claim range

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
    console.log("🔄 Updating ranked extraction prompts to v3...");

    // Deactivate v2
    await connection.execute(
      `UPDATE llm_prompts
       SET is_active = FALSE
       WHERE prompt_name IN ('claim_extraction_ranked_with_topics', 'claim_extraction_ranked_no_topics')
       AND version = 2`
    );

    // ========================================
    // IMPROVED RANKED PROMPT (with topics) - v3
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

   b) **NOTABLE QUOTES WITH STRONG LANGUAGE** (HIGH PRIORITY)
      - Direct quotes from experts, researchers, or key figures mentioned by name
      - Especially quotes containing strong language: "disaster", "mistake", "crisis", "failed", "fraud", "breakthrough", etc.
      - Include the person's credentials/relevance if mentioned
      - Example: "Richard Ablin, who discovered the PSA test, called mass screening 'a public health disaster'"
      - Example: "Dr. Smith termed the treatment 'the great medical mistake of our generation'"

   c) **KEY SUPPORTING EVIDENCE** (SECOND PRIORITY)
      - Specific data/findings that directly support the thesis
      - Claims with concrete numbers, percentages, outcomes
      - Example: "Screening reduced prostate cancer deaths by 21% but increased overdiagnosis by 50%"

   d) **COUNTERPOINTS/NUANCE** (THIRD PRIORITY, if space)
      - Significant objections or alternative interpretations
      - Limitations acknowledged by the author

   ❌ AVOID (These are NOT the claims we want):
   - Background context ("PSA testing was introduced in 1986")
   - Methodology details ("The study included 182,000 men")
   - Generic statements without attribution ("Early detection can save lives")
   - Obvious facts ("Prostate cancer is common in older men")

   🔍 CONTROVERSY MARKERS (prioritize claims with these):
   - Strong negative language: "disaster", "mistake", "failed", "crisis", "fraud", "harmful"
   - Strong positive language: "breakthrough", "revolutionary", "life-saving", "cure"
   - Contradictions: "despite", "however", "contrary to"
   - Authority quotes: "[Name], who [credentials], said/called/termed"

   ✅ REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (names, titles, timeframes)
   - PRIORITIZE: Thesis → Notable quotes → Evidence → Counterpoints
   - Include attribution for quotes (who said it, their relevance)

   📝 GOOD EXAMPLES (prioritize claims like these):
   ✅ "The 23-year European prostate cancer screening study found screening failed to reduce overall mortality"
   ✅ "Richard Ablin, who discovered the PSA test in 1970, called mass screening 'a public health disaster' in the New York Times"
   ✅ "Ablin authored an article titled 'The Great Prostate Mistake' criticizing mass PSA screening"
   ✅ "PSA testing led to 1.3 million overtreatments in the US from 2000-2020"

   ❌ BAD EXAMPLES (avoid these types):
   ❌ "There was a European study about prostate screening" (too vague, no conclusion)
   ❌ "The study included 182,000 men across multiple countries" (methodology, not finding)
   ❌ "Prostate cancer is the second leading cause of cancer death" (background context)
   ❌ "Ablin worked on PSA tests" (no strong claim, just background)

   🎯 Return UP TO {{maxClaims}} claims that best represent:
      1. The article's MAIN ARGUMENT
      2. CONTROVERSIAL QUOTES from notable figures
      3. KEY EVIDENCE supporting or refuting the thesis
      Think: "What are the most fact-checkable, controversial claims I could verify?"

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").`;

    // ========================================
    // IMPROVED RANKED PROMPT (no topics) - v3
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

   b) **NOTABLE QUOTES WITH STRONG LANGUAGE** (HIGH PRIORITY)
      - Direct quotes from experts, researchers, or key figures mentioned by name
      - Especially quotes containing strong language: "disaster", "mistake", "crisis", "failed", "fraud", "breakthrough", etc.
      - Include the person's credentials/relevance if mentioned
      - Example: "Richard Ablin, who discovered the PSA test, called mass screening 'a public health disaster'"
      - Example: "Dr. Smith termed the treatment 'the great medical mistake of our generation'"

   c) **KEY SUPPORTING EVIDENCE** (SECOND PRIORITY)
      - Specific data/findings that directly support the thesis
      - Claims with concrete numbers, percentages, outcomes
      - Example: "Screening reduced prostate cancer deaths by 21% but increased overdiagnosis by 50%"

   d) **COUNTERPOINTS/NUANCE** (THIRD PRIORITY, if space)
      - Significant objections or alternative interpretations
      - Limitations acknowledged by the author

   ❌ AVOID (These are NOT the claims we want):
   - Background context ("PSA testing was introduced in 1986")
   - Methodology details ("The study included 182,000 men")
   - Generic statements without attribution ("Early detection can save lives")
   - Obvious facts ("Prostate cancer is common in older men")

   🔍 CONTROVERSY MARKERS (prioritize claims with these):
   - Strong negative language: "disaster", "mistake", "failed", "crisis", "fraud", "harmful"
   - Strong positive language: "breakthrough", "revolutionary", "life-saving", "cure"
   - Contradictions: "despite", "however", "contrary to"
   - Authority quotes: "[Name], who [credentials], said/called/termed"

   ✅ REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (names, titles, timeframes)
   - PRIORITIZE: Thesis → Notable quotes → Evidence → Counterpoints
   - Include attribution for quotes (who said it, their relevance)

   📝 GOOD EXAMPLES (prioritize claims like these):
   ✅ "The 23-year European prostate cancer screening study found screening failed to reduce overall mortality"
   ✅ "Richard Ablin, who discovered the PSA test in 1970, called mass screening 'a public health disaster' in the New York Times"
   ✅ "Ablin authored an article titled 'The Great Prostate Mistake' criticizing mass PSA screening"
   ✅ "PSA testing led to 1.3 million overtreatments in the US from 2000-2020"

   ❌ BAD EXAMPLES (avoid these types):
   ❌ "There was a European study about prostate screening" (too vague, no conclusion)
   ❌ "The study included 182,000 men across multiple countries" (methodology, not finding)
   ❌ "Prostate cancer is the second leading cause of cancer death" (background context)
   ❌ "Ablin worked on PSA tests" (no strong claim, just background)

   🎯 Return UP TO {{maxClaims}} claims that best represent:
      1. The article's MAIN ARGUMENT
      2. CONTROVERSIAL QUOTES from notable figures
      3. KEY EVIDENCE supporting or refuting the thesis
      Think: "What are the most fact-checkable, controversial claims I could verify?"

2) Do NOT invent topics or testimonials in this mode.`;

    // Get next prompt IDs
    const [maxIdResult] = await connection.execute(
      'SELECT COALESCE(MAX(prompt_id), 0) as maxId FROM llm_prompts'
    );
    let nextId = (maxIdResult[0]?.maxId || 8) + 1;

    // Insert v3 with topics (maxClaims now 12)
    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId++,
        'claim_extraction_ranked_with_topics',
        'user',
        improvedRankedWithTopics,
        JSON.stringify({ minClaims: 3, maxClaims: 12 }),
        3,
        true,
      ]
    );
    console.log("✅ Inserted: claim_extraction_ranked_with_topics v3 (3-12 claims)");

    // Insert v3 without topics
    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId++,
        'claim_extraction_ranked_no_topics',
        'user',
        improvedRankedNoTopics,
        JSON.stringify({ minClaims: 3, maxClaims: 12 }),
        3,
        true,
      ]
    );
    console.log("✅ Inserted: claim_extraction_ranked_no_topics v3 (3-12 claims)");

    console.log("\n✅ Prompts updated to v3!");
    console.log("\n📋 Key changes:");
    console.log("  - Added 'NOTABLE QUOTES WITH STRONG LANGUAGE' category");
    console.log("  - Added controversy markers: disaster, mistake, crisis, failed, etc.");
    console.log("  - Increased maxClaims from 9 → 12");
    console.log("  - Added your Ablin quote as an example");

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
    console.log("\n🎉 Update complete!");
    console.log("\n💡 Next steps:");
    console.log("   1. Restart backend or clear cache:");
    console.log("      - Dashboard → Prompt Manager → Clear Cache");
    console.log("   2. Try scraping the Brownstone article again");
    console.log("   3. Should now capture the Ablin 'public health disaster' quote!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Update failed:", err);
    process.exit(1);
  });
