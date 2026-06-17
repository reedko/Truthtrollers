// Seeds the llm_prompts table with the new reasoning-stack claim extraction prompts.
// This is the preferred prompt family for both CASE content and SOURCE content.
//
// Prompt contract:
// - contentRole: case | source
// - extractionMode: edge | ranked | comprehensive
// - one system prompt + two user variants (with_topics / no_topics)

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env.dev") });

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "truthtrollers_user",
  password: process.env.DB_PASSWORD || "yourpassword",
  database: process.env.DB_DATABASE || "truthtrollers_db",
};

const systemPrompt = `You extract a reasoning stack from content.
Return strict JSON only.

Build a hierarchy:
1. thesis
2. pillar claims
3. evidence claims
4. background claims

Keep claims atomic, self-contained, and verifiable.
Do not collapse distinct assertions into one item.
For source/reference content, use the case claims only as relevance context.
Do not invent facts that are not in the text.`;

const userPromptWithTopics = `CONTENT ROLE: {{contentRole}}
EXTRACTION MODE: {{extractionMode}}

TASK
Extract a reasoning stack from the text.

Return JSON with:
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>"],
  "thesis": "<string>",
  "pillars": [
    {
      "id": "P1",
      "label": "<string>",
      "summary": "<string>",
      "centrality": 0-100,
      "claims": [
        {
          "text": "<claim>",
          "role": "pillar_support",
          "parentId": "P1",
          "centrality": 0-100,
          "verifiability": 0-100
        }
      ]
    }
  ],
  "evidenceClaims": [
    {
      "text": "<claim>",
      "role": "evidence",
      "parentId": "P1",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "backgroundClaims": [
    {
      "text": "<claim>",
      "role": "background",
      "parentId": "",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "claims": [
    {
      "text": "<claim>",
      "role": "thesis|pillar|evidence|background",
      "parentId": "",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "testimonials": [
    { "text": "<testimonial1>", "name": "<optional>", "imageUrl": "<optional>" }
  ]
}

RULES
- CONTENT ROLE = case:
  - identify the article's central thesis first.
  - group major supporting claims as pillars.
  - nest atomic evidence claims under the pillar they support.
  - background facts stay separate and should not outrank the thesis.

- CONTENT ROLE = source:
  - use the case claims only as relevance context if supplied by the caller.
  - extract claims actually present in the source.
  - prioritize claims that support, refute, or nuance the case claims.
  - do not invent or import the case claims into the source.

- EDGE: return only the sharpest, most consequential claims.
- RANKED: return the most important claims that build the reasoning stack.
- COMPREHENSIVE: return a fuller claim pool, but still keep the reasoning stack.
- Each claim must be atomic, self-contained, and directly verifiable.
- Return \`claims\` as the flat canonical list for persistence; keep nested fields for structure.
- If nothing fits a section, return an empty array.`;

const userPromptNoTopics = `CONTENT ROLE: {{contentRole}}
EXTRACTION MODE: {{extractionMode}}

TASK
Extract a reasoning stack from the text.

Return JSON with:
{
  "thesis": "<string>",
  "pillars": [
    {
      "id": "P1",
      "label": "<string>",
      "summary": "<string>",
      "centrality": 0-100,
      "claims": [
        {
          "text": "<claim>",
          "role": "pillar_support",
          "parentId": "P1",
          "centrality": 0-100,
          "verifiability": 0-100
        }
      ]
    }
  ],
  "evidenceClaims": [
    {
      "text": "<claim>",
      "role": "evidence",
      "parentId": "P1",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "backgroundClaims": [
    {
      "text": "<claim>",
      "role": "background",
      "parentId": "",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "claims": [
    {
      "text": "<claim>",
      "role": "thesis|pillar|evidence|background",
      "parentId": "",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ]
}

RULES
- CONTENT ROLE = case:
  - identify the article's central thesis first.
  - group major supporting claims as pillars.
  - nest atomic evidence claims under the pillar they support.
  - background facts stay separate and should not outrank the thesis.

- CONTENT ROLE = source:
  - use the case claims only as relevance context if supplied by the caller.
  - extract claims actually present in the source.
  - prioritize claims that support, refute, or nuance the case claims.
  - do not invent or import the case claims into the source.

- EDGE: return only the sharpest, most consequential claims.
- RANKED: return the most important claims that build the reasoning stack.
- COMPREHENSIVE: return a fuller claim pool, but still keep the reasoning stack.
- Each claim must be atomic, self-contained, and directly verifiable.
- Return \`claims\` as the flat canonical list for persistence; keep nested fields for structure.
- If nothing fits a section, return an empty array.`;

async function seedReasoningStackPrompts() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log("🌱 Seeding reasoning-stack prompts...");

    const maxIdResult = await connection.execute(
      "SELECT COALESCE(MAX(prompt_id), 0) AS maxId FROM llm_prompts"
    );
    let nextId = Number(maxIdResult[0]?.[0]?.maxId || 0) + 1;

    const prompts = [
      {
        prompt_name: "claim_extraction_stack_system",
        prompt_type: "system",
        prompt_text: systemPrompt,
        parameters: {},
        version: 1,
        is_active: true,
        max_claims: 12,
        min_sources: 2,
        max_sources: 4,
      },
      {
        prompt_name: "claim_extraction_stack_with_topics",
        prompt_type: "user",
        prompt_text: userPromptWithTopics,
        parameters: { minClaims: 5, maxClaims: 12 },
        version: 1,
        is_active: true,
        max_claims: 12,
        min_sources: 2,
        max_sources: 4,
      },
      {
        prompt_name: "claim_extraction_stack_no_topics",
        prompt_type: "user",
        prompt_text: userPromptNoTopics,
        parameters: { minClaims: 5, maxClaims: 12 },
        version: 1,
        is_active: true,
        max_claims: 12,
        min_sources: 2,
        max_sources: 4,
      },
    ];

    for (const prompt of prompts) {
      const existing = await connection.execute(
        "SELECT prompt_id, version, is_active FROM llm_prompts WHERE prompt_name = ? ORDER BY version DESC, prompt_id DESC LIMIT 1",
        [prompt.prompt_name]
      );

      if (existing[0].length > 0) {
        const current = existing[0][0];
        await connection.execute(
          `UPDATE llm_prompts
           SET prompt_text = ?,
               parameters = ?,
               is_active = ?,
               max_claims = ?,
               min_sources = ?,
               max_sources = ?
           WHERE prompt_id = ?`,
          [
            prompt.prompt_text,
            JSON.stringify(prompt.parameters),
            prompt.is_active,
            prompt.max_claims,
            prompt.min_sources,
            prompt.max_sources,
            current.prompt_id,
          ]
        );
        console.log(`♻️  Updated existing prompt: ${prompt.prompt_name}`);
        continue;
      }

      await connection.execute(
        `INSERT INTO llm_prompts
         (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active, max_claims, min_sources, max_sources)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nextId++,
          prompt.prompt_name,
          prompt.prompt_type,
          prompt.prompt_text,
          JSON.stringify(prompt.parameters),
          prompt.version,
          prompt.is_active,
          prompt.max_claims,
          prompt.min_sources,
          prompt.max_sources,
        ]
      );
      console.log(`✅ Inserted: ${prompt.prompt_name}`);
    }

    const rows = await connection.execute(
      "SELECT prompt_id, prompt_name, version, is_active FROM llm_prompts WHERE prompt_name LIKE 'claim_extraction_stack%' ORDER BY prompt_name, version DESC"
    );

    console.log("📋 Current stack prompts:");
    for (const row of rows[0]) {
      console.log(`  - ${row.prompt_name} v${row.version} (active=${row.is_active})`);
    }
  } finally {
    await connection.end();
  }
}

seedReasoningStackPrompts().catch((err) => {
  console.error("❌ Failed to seed reasoning-stack prompts:", err);
  process.exit(1);
});
