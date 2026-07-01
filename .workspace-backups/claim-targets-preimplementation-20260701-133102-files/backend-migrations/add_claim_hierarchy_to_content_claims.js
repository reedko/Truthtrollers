// Adds reasoning-stack metadata columns to content_claims.
// This keeps hierarchy data scoped to the specific content-to-claim link,
// which is the right place for reusable claims.

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

const COLUMNS = [
  {
    name: "claim_role",
    ddl: `ALTER TABLE content_claims
          ADD COLUMN claim_role ENUM('thesis', 'pillar', 'pillar_support', 'evidence', 'background') DEFAULT NULL AFTER relationship_type`,
  },
  {
    name: "parent_claim_id",
    ddl: `ALTER TABLE content_claims
          ADD COLUMN parent_claim_id INT DEFAULT NULL AFTER claim_role`,
  },
  {
    name: "claim_depth",
    ddl: `ALTER TABLE content_claims
          ADD COLUMN claim_depth TINYINT DEFAULT NULL AFTER parent_claim_id`,
  },
  {
    name: "centrality_score",
    ddl: `ALTER TABLE content_claims
          ADD COLUMN centrality_score DECIMAL(5,2) DEFAULT NULL AFTER claim_depth`,
  },
  {
    name: "verifiability_score",
    ddl: `ALTER TABLE content_claims
          ADD COLUMN verifiability_score DECIMAL(5,2) DEFAULT NULL AFTER centrality_score`,
  },
  {
    name: "claim_order",
    ddl: `ALTER TABLE content_claims
          ADD COLUMN claim_order INT DEFAULT NULL AFTER verifiability_score`,
  },
];

async function main() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    console.log("🌱 Updating content_claims hierarchy schema...");

    const [rows] = await connection.execute(
      `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'content_claims'
      `
    );

    const existing = new Set(rows.map((row) => row.COLUMN_NAME));

    for (const column of COLUMNS) {
      if (existing.has(column.name)) {
        console.log(`⏭️  Skipping existing column: ${column.name}`);
        continue;
      }
      await connection.execute(column.ddl);
      console.log(`✅ Added column: ${column.name}`);
    }

    console.log("📋 content_claims hierarchy columns are ready.");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("❌ Failed to update content_claims schema:", err);
  process.exit(1);
});
