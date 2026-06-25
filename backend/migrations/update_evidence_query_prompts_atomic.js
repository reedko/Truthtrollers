import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env" });

const systemPrompt = `You generate precise search queries for fact-checking.
Return strict JSON only.

Preserve the exact atomic assertion being checked. If the input includes both an original claim and a core factual assertion, optimize queries for the core factual assertion while retaining named people/entities from the original claim when useful.

Do not broaden a narrow misconduct claim into a generic topic claim. For example, "CDC ordered scientists to destroy evidence linking MMR to autism" is not the same as "MMR causes autism." Queries must seek evidence about the alleged order/destruction/concealment, not just the vaccine-autism topic.`;

const standardUserPrompt = `CLAIM TO VERIFY:
{{claimText}}

CONTEXT:
{{context}}

Task: Produce {{n}} search queries across intents.

Rules:
- Preserve named people, agencies, studies, dates, and key verbs.
- For attribution claims like "X revealed that Y", search for Y directly and also include X in some queries.
- For misconduct claims, include the misconduct verb: ordered, destroyed, concealed, manipulated, omitted, falsified, retracted, corrected, etc.
- Do not replace a specific allegation with a broad topic query.
- Include refutation queries that test the exact allegation.

Return JSON:
{"queries":[{"query":"...","intent":"support|refute|nuance|background|factbox"}]}`;

const balancedUserPrompt = `CLAIM TO VERIFY:
{{claimText}}

CONTEXT:
{{context}}

TASK: Generate EXACTLY {{n}} diverse search queries for this exact claim.

BALANCED DISTRIBUTION REQUIRED:
- {{supportQueries}} queries designed to find sources that SUPPORT the exact claim
- {{refuteQueries}} queries designed to find sources that REFUTE the exact claim
- {{nuanceQueries}} queries designed to find sources that provide NUANCED perspective

QUERY DESIGN RULES:
- Preserve the core factual assertion. Do not broaden it.
- If the claim says "Original claim: X" and "Core factual assertion to evaluate: Y", optimize for Y.
- Keep named actors when useful: whistleblower, agency, study authors, journal, study title.
- For attribution-wrapper claims like "William Thompson revealed that the CDC ordered scientists to destroy evidence...", generate queries for the direct assertion "CDC ordered scientists to destroy evidence..." and some queries including "William Thompson".
- For allegations of fraud, cover-up, destruction, data manipulation, omitted data, or institutional misconduct, queries must include those exact misconduct concepts.
- Do NOT use generic topic queries like "MMR vaccine autism evidence" when the claim is specifically about evidence destruction or an order to destroy evidence.

Examples for a destruction-order claim:
- "CDC ordered scientists destroy evidence MMR autism William Thompson"
- "William Thompson CDC destroy documents MMR autism fact check"
- "CDC whistleblower documents destroyed MMR autism evidence false"
- "CDC omitted data vs destroyed evidence William Thompson MMR autism"

OUTPUT FORMAT:
Return JSON:
{"queries":[{"query":"...","intent":"support|refute|nuance|background|factbox"}]}`;

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });

  try {
    const updates = [
      ["evidence_query_generation_system", systemPrompt],
      ["evidence_query_generation_user", standardUserPrompt],
      ["evidence_query_generation_user_balanced", balancedUserPrompt],
    ];

    const result = {};
    for (const [name, prompt] of updates) {
      const [res] = await conn.execute(
        "UPDATE llm_prompts SET prompt_text = ?, version = version + 1 WHERE prompt_name = ? AND is_active = 1",
        [prompt, name]
      );
      result[name] = res.affectedRows;
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
