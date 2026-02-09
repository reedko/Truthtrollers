// backend/migrations/seed_claim_extraction_prompts.js
// Seeds the llm_prompts table with claim extraction prompts

import mysql from "mysql2/promise";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "truthtrollers_user",
  password: process.env.DB_PASSWORD || "yourpassword",
  database: process.env.DB_DATABASE || "truthtrollers_db",
};

async function seedPrompts() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("🌱 Seeding llm_prompts table...");

    // ========================================
    // RANKED MODE: System Prompt
    // ========================================
    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        1,
        'claim_extraction_ranked_system',
        'system',
        'You are a precise claim extraction assistant. You must return strictly valid JSON.',
        JSON.stringify({}),
        1,
        true,
      ]
    );
    console.log("✅ Inserted: claim_extraction_ranked_system");

    // ========================================
    // RANKED MODE: User Prompt (with topics)
    // ========================================
    const rankedWithTopics = `TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract ONLY the {{minClaims}}-{{maxClaims}} MOST IMPORTANT, VERIFIABLE claims from the text.

   RANKING CRITERIA (prioritize in this order):
   a) MATERIALITY: Central to the article's main thesis or argument
   b) CONTROVERSY: Genuinely disputed, surprising, or counterintuitive
   c) SPECIFICITY: Concrete, falsifiable, with numbers/dates/names

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - INCLUDE: Claims with concrete data (numbers, percentages, dates, named entities)
   - AVOID: Vague statements ("there was a study"), obvious facts, opinions, background context
   - Phrase each claim as a complete, specific sentence

   EXAMPLES:
   ✅ GOOD: "Cancer prescreening programs led to 1 million overtreatment cases in the US from 2000-2020"
   ✅ GOOD: "PSA testing for prostate cancer has an 80% false positive rate"
   ❌ BAD: "There was a study about cancer tests" (too vague)
   ❌ BAD: "Some people think prescreening is bad" (opinion, not falsifiable)

   Return ONLY the top {{maxClaims}} claims that meet these criteria. Quality over quantity.

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").`;

    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        2,
        'claim_extraction_ranked_with_topics',
        'user',
        rankedWithTopics,
        JSON.stringify({ minClaims: 3, maxClaims: 9 }),
        1,
        true,
      ]
    );
    console.log("✅ Inserted: claim_extraction_ranked_with_topics");

    // ========================================
    // RANKED MODE: User Prompt (no topics)
    // ========================================
    const rankedNoTopics = `TASKS
1) Extract ONLY the {{minClaims}}-{{maxClaims}} MOST IMPORTANT, VERIFIABLE claims from the text.

   RANKING CRITERIA (prioritize in this order):
   a) MATERIALITY: Central to the article's main thesis or argument
   b) CONTROVERSY: Genuinely disputed, surprising, or counterintuitive
   c) SPECIFICITY: Concrete, falsifiable, with numbers/dates/names

   REQUIREMENTS:
   - Each claim must be FALSIFIABLE: can be proven true or false with evidence
   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)
   - INCLUDE: Claims with concrete data (numbers, percentages, dates, named entities)
   - AVOID: Vague statements ("there was a study"), obvious facts, opinions, background context
   - Phrase each claim as a complete, specific sentence

   EXAMPLES:
   ✅ GOOD: "Cancer prescreening programs led to 1 million overtreatment cases in the US from 2000-2020"
   ✅ GOOD: "PSA testing for prostate cancer has an 80% false positive rate"
   ❌ BAD: "There was a study about cancer tests" (too vague)
   ❌ BAD: "Some people think prescreening is bad" (opinion, not falsifiable)

   Return ONLY the top {{maxClaims}} claims that meet these criteria. Quality over quantity.

2) Do NOT invent topics or testimonials in this mode.`;

    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        3,
        'claim_extraction_ranked_no_topics',
        'user',
        rankedNoTopics,
        JSON.stringify({ minClaims: 3, maxClaims: 9 }),
        1,
        true,
      ]
    );
    console.log("✅ Inserted: claim_extraction_ranked_no_topics");

    // ========================================
    // COMPREHENSIVE MODE: User Prompt (with topics)
    // ========================================
    const comprehensiveWithTopics = `TASKS
1) Identify the single most general topic (max 2 words).
2) List 2–5 specific subtopics under that topic.
3) Extract DISTINCT factual claims from the text.
   - Return AT LEAST {{minClaims}} and AT MOST {{maxClaims}} claims, if available.
   - Each claim must be independently verifiable, one atomic assertion per item.
   - Each claim must be SELF-CONTAINED: resolve pronouns, include context (time/place/subject).
   - Prefer claims with numbers, dates, named entities, locations, or concrete actions.
   - Avoid duplicates, paraphrases, opinions, or vague summaries.
   - Phrase each claim as a full sentence.
   - Example: "Trump won 2016 US election" NOT "He won the election"

4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").
   - Deduplicate against the main text if overlapping.`;

    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        4,
        'claim_extraction_comprehensive_with_topics',
        'user',
        comprehensiveWithTopics,
        JSON.stringify({ minClaims: 5, maxClaims: 12 }),
        1,
        true,
      ]
    );
    console.log("✅ Inserted: claim_extraction_comprehensive_with_topics");

    // ========================================
    // COMPREHENSIVE MODE: User Prompt (no topics)
    // ========================================
    const comprehensiveNoTopics = `TASKS
1) Extract DISTINCT factual claims from the text ONLY.
   - Return AT LEAST {{minClaims}} and AT MOST {{maxClaims}} claims, if available.
   - Each claim must be independently verifiable, one atomic assertion per item.
   - Each claim must be SELF-CONTAINED: resolve pronouns, include context (time/place/subject).
   - Prefer claims with numbers, dates, named entities, locations, or concrete actions.
   - Avoid duplicates, paraphrases, opinions, or vague summaries.
   - Phrase each claim as a full sentence.
   - Example: "Trump won 2016 US election" NOT "He won the election"

2) Do NOT invent topics or testimonials in this mode.`;

    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        5,
        'claim_extraction_comprehensive_no_topics',
        'user',
        comprehensiveNoTopics,
        JSON.stringify({ minClaims: 5, maxClaims: 12 }),
        1,
        true,
      ]
    );
    console.log("✅ Inserted: claim_extraction_comprehensive_no_topics");

    // ========================================
    // CLAIM FILTERING PROMPT
    // ========================================
    const claimFilteringPrompt = `Evaluate this claim for verification worthiness:

CLAIM: "{{claim}}"

Rate 0.0-1.0 on each dimension:

1. SPECIFICITY: Is this specific and falsifiable? (NOT vague like "there was a study")
   - 1.0 = Concrete, verifiable assertion with specifics (numbers, dates, names)
   - 0.5 = Somewhat specific but missing key details
   - 0.0 = Vague, generic, or subjective opinion

2. CONTROVERSY: Would reasonable people dispute this? Is it worth checking?
   - 1.0 = Genuinely controversial or surprising claim
   - 0.5 = Somewhat debatable
   - 0.0 = Obviously true/false or trivial

3. MATERIALITY: Is this central to the article's main argument?
   - 1.0 = Core thesis or key supporting claim
   - 0.5 = Supporting detail
   - 0.0 = Background context or filler

Return JSON: {"specificity": X, "controversy": Y, "materiality": Z, "reasoning": "brief explanation"}`;

    await connection.execute(
      `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        6,
        'claim_filtering',
        'user',
        claimFilteringPrompt,
        JSON.stringify({ threshold: 0.6 }),
        1,
        true,
      ]
    );
    console.log("✅ Inserted: claim_filtering");

    console.log("\n✅ All prompts seeded successfully!");
    console.log("\n📋 Prompt summary:");
    const prompts = await connection.execute(
      `SELECT prompt_id, prompt_name, version, is_active FROM llm_prompts ORDER BY prompt_id`
    );
    console.table(prompts[0]);

  } catch (err) {
    console.error("❌ Error seeding prompts:", err.message);
    throw err;
  } finally {
    await connection.end();
  }
}

// Run the seed
seedPrompts()
  .then(() => {
    console.log("\n🎉 Seeding complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Seeding failed:", err);
    process.exit(1);
  });
