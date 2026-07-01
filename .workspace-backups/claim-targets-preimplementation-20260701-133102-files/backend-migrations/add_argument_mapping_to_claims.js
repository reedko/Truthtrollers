import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: "../.env" });
dotenv.config({ path: ".env" });

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
};

const columns = [
  ["object_claim_text", "TEXT NULL"],
  ["is_attribution", "TINYINT(1) NULL"],
  ["speaker_entity", "VARCHAR(255) NULL"],
  ["article_stance", "VARCHAR(32) NULL"],
  ["argument_function", "VARCHAR(64) NULL"],
  ["score_transform", "VARCHAR(16) NULL"],
  ["accountability_eligible", "TINYINT(1) NULL"],
  ["argument_mapping_confidence", "DECIMAL(5,4) NULL"],
  ["argument_mapping_rationale", "TEXT NULL"],
];

const prompts = [
  {
    name: "argument_mapping_system",
    type: "system",
    text: `You map extracted case claims to their function inside the article's argument.

Return strict JSON only. Do not include markdown or commentary.

Decide whether the article endorses each claim, rejects it, reports it neutrally, or uses it as an opposing claim to refute.

This is not fact-checking. Do not use outside knowledge. Use only the article text and extracted claims.

For attribution claims like "X says Y", distinguish the attribution wrapper from the object claim Y.

scoreTransform controls how evidence about the object claim should affect the article:
- normal: evidence supporting the object claim supports the article; evidence refuting it weakens the article.
- invert: evidence supporting the object claim weakens the article; evidence refuting it supports the article.
- none: the claim should not directly affect the article score.
- review: unclear; human review needed before scoring.

Use invert when the article presents a claim mainly as an opponent/ad/source claim that the article is trying to discredit.
Use none for attribution-only, neutral reporting, or background that does not carry the argument.`,
  },
  {
    name: "argument_mapping_user",
    type: "user",
    text: `Analyze this article excerpt and extracted claims.

ARTICLE EXCERPT:
{{articleExcerpt}}

EXTRACTED THESIS:
{{articleThesis}}

CLAIMS:
{{claimsJson}}

Return JSON with exactly this structure:
{
  "articleThesis": "",
  "claims": [
    {
      "claimId": 0,
      "objectClaim": "",
      "isAttribution": false,
      "speakerEntity": "",
      "articleStanceTowardObjectClaim": "endorses|rejects|neutral|unclear",
      "argumentFunction": "thesis|supporting_premise|evidence|opposing_claim_to_refute|background|reported_neutral|unclear",
      "scoreTransform": "normal|invert|none|review",
      "accountabilityEligible": false,
      "confidence": 0,
      "rationale": ""
    }
  ]
}

Rules:
- Include one output item for every input claim.
- objectClaim is the factual assertion evidence search should evaluate.
- For "X said/stated/claimed/alleged that Y", objectClaim should be Y.
- If the article uses Y as an example of what is wrong or false, use argumentFunction opposing_claim_to_refute and scoreTransform invert.
- If the article uses Y to support its own thesis, use normal.
- If the article merely says who said something and the object claim does not carry the article argument, use none.
- Keep rationales short.`,
  },
];

async function ensureColumn(conn, table, field, definition) {
  const [rows] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [field]);
  if (rows.length) {
    console.log(`✓ ${table}.${field} already exists`);
    return;
  }
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${field} ${definition}`);
  console.log(`+ Added ${table}.${field}`);
}

async function upsertPrompt(conn, prompt) {
  await conn.query("UPDATE llm_prompts SET is_active = FALSE WHERE prompt_name = ?", [prompt.name]);
  const [[versionRow]] = await conn.query(
    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM llm_prompts WHERE prompt_name = ?",
    [prompt.name]
  );
  const [[idRow]] = await conn.query("SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts");
  await conn.query(
    `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
     VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
    [idRow.next_id, prompt.name, prompt.type, prompt.text, JSON.stringify({}), versionRow.next_version]
  );
  console.log(`+ Activated ${prompt.name} v${versionRow.next_version}`);
}

async function main() {
  const conn = await mysql.createConnection(dbConfig);
  try {
    for (const [field, definition] of columns) {
      await ensureColumn(conn, "content_claims", field, definition);
    }
    for (const prompt of prompts) {
      await upsertPrompt(conn, prompt);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
