#!/usr/bin/env node
/**
 * Runs database migrations added during the 2026-06-11 session.
 *
 * Usage:
 *   node migrations/run_2026_06_11_session_migrations.js [path/to/.env]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "../.env");

dotenv.config({ path: envPath });

const migrations = [
  "add_claim_hierarchy_to_content_claims.sql",
  "add_claim_link_audit_table.sql",
  "add_weighted_reputation_model.sql",
];

function splitSqlStatements(sql) {
  const statements = [];
  let delimiter = ";";
  let current = "";

  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (/^DELIMITER\s+/i.test(trimmed)) {
      if (current.trim()) {
        statements.push(current.trim());
        current = "";
      }
      delimiter = trimmed.split(/\s+/)[1];
      continue;
    }

    current += `${line}\n`;

    if (trimmed.endsWith(delimiter)) {
      current = current.slice(0, current.lastIndexOf(delimiter));
      if (current.trim()) statements.push(current.trim());
      current = "";
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function runSqlFile(connection, filename) {
  const sqlPath = path.join(__dirname, filename);
  const sql = fs.readFileSync(sqlPath, "utf8");
  const statements = splitSqlStatements(sql);

  console.log(`\n==> ${filename}`);
  console.log(`    ${statements.length} statements`);

  for (const [index, statement] of statements.entries()) {
    const normalized = statement.trim();
    if (!normalized || normalized.startsWith("--")) continue;

    try {
      const [result] = await connection.query(normalized);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`    [${index + 1}]`, result);
      }
    } catch (error) {
      const message = error?.message || String(error);
      if (
        message.includes("already exists") ||
        message.includes("Duplicate column") ||
        message.includes("Duplicate key name")
      ) {
        console.log(`    [${index + 1}] skipped: ${message}`);
        continue;
      }
      throw error;
    }
  }
}

async function verify(connection) {
  const [columns] = await connection.query(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'content_claims' AND COLUMN_NAME IN (
          'claim_role',
          'parent_claim_id',
          'claim_depth',
          'centrality_score',
          'verifiability_score',
          'claim_order'
        ))
        OR (TABLE_NAME = 'claim_link_audit')
        OR (TABLE_NAME = 'user_reputation' AND COLUMN_NAME IN (
          'weighted_avg_content_score',
          'reputation_confidence',
          'evaluator_activity_score'
        ))
        OR (TABLE_NAME = 'content_rating_evaluations' AND COLUMN_NAME IN (
          'evaluator_reputation_at_evaluation',
          'evaluator_weight'
        ))
      )
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);

  console.log("\nVerified migration columns/tables:");
  for (const row of columns) {
    console.log(`  - ${row.TABLE_NAME}.${row.COLUMN_NAME}`);
  }
}

async function main() {
  const config = {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_DATABASE || process.env.DB_NAME || "truthtrollers",
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: true,
  };

  console.log("Running 2026-06-11 session migrations");
  console.log(`Env: ${envPath}`);
  console.log(`DB: ${config.user}@${config.host}:${config.port}/${config.database}`);

  const connection = await mysql.createConnection(config);
  try {
    for (const migration of migrations) {
      await runSqlFile(connection, migration);
    }
    await verify(connection);
    console.log("\nSession migrations completed.");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("\nSession migration failed:", error.message);
  process.exit(1);
});
