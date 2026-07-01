import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseStatements(sql) {
  let delimiter = ";";
  let buffer = "";
  const statements = [];
  for (const line of sql.split(/\r?\n/)) {
    const directive = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (directive) {
      delimiter = directive[1];
      continue;
    }
    buffer += `${line}\n`;
    if (buffer.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trimEnd().slice(0, -delimiter.length).trim();
      if (statement) statements.push(statement);
      buffer = "";
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const fileArg = process.argv.find((arg) => arg.endsWith(".sql"));
  if (!fileArg) throw new Error("Usage: node src/scripts/runSqlMigration.js <migration.sql> [--apply]");
  const file = path.resolve(fileArg);
  const statements = parseStatements(await fs.readFile(file, "utf8"));
  if (!apply) {
    console.log(`Parsed ${statements.length} statements from ${file}. Re-run with --apply to execute.`);
    return;
  }

  const connection = await mysql.createConnection({
    host: requiredEnv("DB_HOST"),
    user: requiredEnv("DB_USER"),
    password: requiredEnv("DB_PASSWORD"),
    database: requiredEnv("DB_DATABASE"),
    charset: "utf8mb4",
    connectTimeout: 5000,
  });
  try {
    await connection.query("SET SESSION lock_wait_timeout = 10");
    for (let index = 0; index < statements.length; index += 1) {
      console.log(`Applying statement ${index + 1}/${statements.length}`);
      await connection.query(statements[index]);
      console.log(`Applied statement ${index + 1}/${statements.length}`);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Migration runner failed: ${error.message}`);
  process.exitCode = 1;
});
