import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path:path.resolve(".env") });
const enabled = process.env.CFX_REAL_MYSQL_TEST === "1";

test("Phase 2 migration matches the reached live production parent schema", {
  skip:!enabled,
  timeout:30_000,
}, async () => {
  assert.ok(process.env.DB_DATABASE, "DB_DATABASE is required for the read-only live schema gate");
  const connection = await mysql.createConnection({
    host:process.env.DB_HOST || "127.0.0.1",
    port:Number(process.env.DB_PORT || 3306),
    user:process.env.DB_USER,
    password:process.env.DB_PASSWORD,
    database:process.env.DB_DATABASE,
  });
  try {
    const [columns] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=? AND (
          (TABLE_NAME='content' AND COLUMN_NAME='content_id') OR
          (TABLE_NAME='claims' AND COLUMN_NAME='claim_id') OR
          (TABLE_NAME='scrape_jobs' AND COLUMN_NAME='scrape_job_id') OR
          (TABLE_NAME='cfx_evidence_acquisition_bindings' AND COLUMN_NAME='binding_id') OR
          (TABLE_NAME='cfx_evidence_text_versions' AND COLUMN_NAME='acquired_text_version_id'))
        ORDER BY TABLE_NAME,COLUMN_NAME`,
      [process.env.DB_DATABASE],
    );
    const types = new Map(columns.map((row) =>
      [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row.COLUMN_TYPE]));
    assert.equal(types.get("content.content_id"), "int");
    assert.equal(types.get("claims.claim_id"), "int");
    assert.equal(types.get("scrape_jobs.scrape_job_id"), "bigint");
    assert.equal(types.get("cfx_evidence_acquisition_bindings.binding_id"), "bigint unsigned");
    assert.equal(types.get("cfx_evidence_text_versions.acquired_text_version_id"), "bigint unsigned");
    const [scrapeCreate] = await connection.query<mysql.RowDataPacket[]>("SHOW CREATE TABLE scrape_jobs");
    assert.match(String(scrapeCreate[0]?.["Create Table"]), /PRIMARY KEY \(`scrape_job_id`\)/u);
  } finally {
    await connection.end();
  }
});
