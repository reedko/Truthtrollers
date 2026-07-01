import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const TABLES = [
  "content",
  "publishers",
  "content_publishers",
  "publisher_domains",
  "publisher_ratings",
  "publisher_profiles",
  "publisher_enrichment_runs",
  "publisher_external_signals",
  "publisher_relationships",
  "publisher_credibility_checks",
  "source_identity_cache",
  "content_publishing_context",
  "content_publishing_identifiers",
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const outputArg = process.argv[2];
  const outputPath = path.resolve(
    outputArg || `schema-inventory/publisher-schema-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );

  const connection = await mysql.createConnection({
    host: requiredEnv("DB_HOST"),
    user: requiredEnv("DB_USER"),
    password: requiredEnv("DB_PASSWORD"),
    database: requiredEnv("DB_DATABASE"),
    charset: "utf8mb4",
    connectTimeout: 5000,
  });

  try {
    const [[server]] = await connection.query(
      "SELECT VERSION() AS version, DATABASE() AS database_name, @@character_set_database AS character_set_database, @@collation_database AS collation_database",
    );
    const [existingRows] = await connection.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
    );
    const existing = new Set(existingRows.map((row) => row.TABLE_NAME));
    const tables = {};

    for (const table of TABLES) {
      if (!existing.has(table)) {
        tables[table] = { exists: false };
        continue;
      }
      const [rows] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
      tables[table] = {
        exists: true,
        createSql: rows[0]["Create Table"],
      };
    }

    const [routineRows] = await connection.query(
      `SELECT ROUTINE_NAME, ROUTINE_TYPE
         FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE()
        ORDER BY ROUTINE_TYPE, ROUTINE_NAME`,
    );
    const routines = [];
    for (const routine of routineRows) {
      try {
        const [rows] = await connection.query(
          `SHOW CREATE ${routine.ROUTINE_TYPE} \`${routine.ROUTINE_NAME}\``,
        );
        routines.push({
          ...routine,
          createSql: rows[0]?.[`Create ${routine.ROUTINE_TYPE === "PROCEDURE" ? "Procedure" : "Function"}`] || null,
        });
      } catch (error) {
        routines.push({ ...routine, createSql: null, captureError: error.message });
      }
    }

    const inventory = {
      capturedAt: new Date().toISOString(),
      server,
      tables,
      routines,
    };

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
    console.log(`Publisher schema inventory written to ${outputPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Publisher schema inventory failed: ${error.message}`);
  process.exitCode = 1;
});
