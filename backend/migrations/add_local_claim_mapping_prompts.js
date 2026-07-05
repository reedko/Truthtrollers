import dotenv from "dotenv";
import mysql from "mysql2/promise";
import {
  LOCAL_CLAIM_EXTRACTION_PROMPT,
  DOCUMENT_SYNTHESIS_PROMPT,
} from "../src/core/localClaimExtraction.js";
import { COMPLEX_MAPPING_PROMPT } from "../src/core/argumentMappingEngine.js";

dotenv.config({ path: "../.env" });
dotenv.config({ path: ".env" });

const prompts = [
  ["claim_local_extraction", LOCAL_CLAIM_EXTRACTION_PROMPT],
  ["claim_document_synthesis", DOCUMENT_SYNTHESIS_PROMPT],
  ["claim_complex_target_mapping", COMPLEX_MAPPING_PROMPT],
];

async function activateCombinedPrompt(connection, promptName, prompt) {
  const [[versionRow]] = await connection.query(
    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM llm_prompts WHERE prompt_name = ?",
    [promptName],
  );
  const [[idRow]] = await connection.query(
    "SELECT COALESCE(MAX(CAST(prompt_id AS UNSIGNED)), 0) + 1 AS next_id FROM llm_prompts",
  );
  await connection.query("UPDATE llm_prompts SET is_active = FALSE WHERE prompt_name = ?", [promptName]);
  await connection.query(
    `INSERT INTO llm_prompts
       (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
     VALUES (?, ?, 'combined', ?, ?, ?, TRUE)`,
    [
      idRow.next_id,
      promptName,
      `SYSTEM:\n${prompt.system}\n\nUSER:\n${prompt.user}`,
      JSON.stringify(prompt.parameters || {}),
      versionRow.next_version,
    ],
  );
  console.log(`+ Activated ${promptName} v${versionRow.next_version}`);
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  try {
    for (const [promptName, prompt] of prompts) {
      await activateCombinedPrompt(connection, promptName, prompt);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

