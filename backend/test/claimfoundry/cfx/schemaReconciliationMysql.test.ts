import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: path.resolve(".env") });

const enabled = process.env.CFX_REAL_MYSQL_TEST === "1";

function statements(sql: string): string[] {
  return sql
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value && !value.split("\n").every((line) => line.trim().startsWith("--")));
}

test("reconciled CFX schema applies and rolls back on disposable real MySQL", {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  const database = `cfx_schema_test_${process.pid}_${Date.now()}`;
  assert.match(database, /^cfx_schema_test_[0-9_]+$/u);
  assert.notEqual(database, process.env.DB_DATABASE);
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: false,
  });
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await admin.query(`USE \`${database}\``);
    for (const ddl of [
      "CREATE TABLE content (content_id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY(content_id)) ENGINE=InnoDB",
      "CREATE TABLE claims (claim_id INT NOT NULL AUTO_INCREMENT, claim_text TEXT NOT NULL, claim_type ENUM('task','reference','snippet') DEFAULT 'task', PRIMARY KEY(claim_id)) ENGINE=InnoDB",
      "CREATE TABLE scrape_jobs (scrape_job_id BIGINT NOT NULL AUTO_INCREMENT, status ENUM('pending','claimed','completed','failed','expired') NOT NULL DEFAULT 'pending', PRIMARY KEY(scrape_job_id)) ENGINE=InnoDB",
      "CREATE TABLE claim_sources (claim_source_id INT NOT NULL AUTO_INCREMENT, claim_id INT NOT NULL, reference_content_id INT NOT NULL, PRIMARY KEY(claim_source_id), CONSTRAINT cs_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id), CONSTRAINT cs_content FOREIGN KEY(reference_content_id) REFERENCES content(content_id)) ENGINE=InnoDB",
      "CREATE TABLE reference_claim_task_links (reference_claim_task_links_id INT NOT NULL AUTO_INCREMENT, reference_claim_id INT NOT NULL, task_claim_id INT NOT NULL, PRIMARY KEY(reference_claim_task_links_id), CONSTRAINT rctl_ref FOREIGN KEY(reference_claim_id) REFERENCES claims(claim_id), CONSTRAINT rctl_task FOREIGN KEY(task_claim_id) REFERENCES claims(claim_id)) ENGINE=InnoDB",
    ]) await admin.query(ddl);

    const migration = await readFile("migrations/2026-07-31-01-cfx-evidence-scrape-bindings.sql", "utf8");
    for (const ddl of statements(migration)) await admin.query(ddl);
    for (const ddl of statements(migration)) await admin.query(ddl);

    const [tables] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME LIKE 'cfx\\_%' ORDER BY TABLE_NAME",
      [database],
    );
    assert.equal(tables.length, 5);
    const [provenance] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='reference_claim_task_link_provenance'",
      [database],
    );
    assert.equal(provenance.length, 1);

    const [jobColumns] = await admin.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME,COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND COLUMN_NAME='scrape_job_id'
         AND TABLE_NAME IN ('scrape_jobs','cfx_evidence_acquisition_bindings','cfx_evidence_terminal_outbox')
       ORDER BY TABLE_NAME`,
      [database],
    );
    assert.deepEqual(jobColumns.map((row) => row.COLUMN_TYPE), ["bigint", "bigint", "bigint"]);

    const [taskContent] = await admin.query<mysql.ResultSetHeader>("INSERT INTO content VALUES ()");
    const [referenceContent] = await admin.query<mysql.ResultSetHeader>("INSERT INTO content VALUES ()");
    const [targetClaim] = await admin.query<mysql.ResultSetHeader>("INSERT INTO claims(claim_text,claim_type) VALUES ('target','task')");
    const [evidenceClaim] = await admin.query<mysql.ResultSetHeader>("INSERT INTO claims(claim_text,claim_type) VALUES ('evidence','reference')");
    const [job] = await admin.query<mysql.ResultSetHeader>("INSERT INTO scrape_jobs(status) VALUES ('pending')");
    const [source] = await admin.query<mysql.ResultSetHeader>("INSERT INTO claim_sources(claim_id,reference_content_id) VALUES (?,?)", [evidenceClaim.insertId, referenceContent.insertId]);
    const [link] = await admin.query<mysql.ResultSetHeader>("INSERT INTO reference_claim_task_links(reference_claim_id,task_claim_id) VALUES (?,?)", [evidenceClaim.insertId, targetClaim.insertId]);

    const [binding] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO cfx_evidence_acquisition_bindings
       (scrape_job_id,task_content_id,target_claim_id,reference_content_id,run_id,proposition_id,candidate_id,acquisition_artifact_id,s2_artifact_path,s2_artifact_sha256,grounding_unit_ids_json,requested_url)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [job.insertId, taskContent.insertId, targetClaim.insertId, referenceContent.insertId, "run-1", "P01", "candidate-1", "artifact-1", "frozen/s2.json", "a".repeat(64), JSON.stringify(["U0001"]), "https://example.test"],
    );
    const [attempt] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO cfx_evidence_acquisition_attempts
       (binding_id,attempt_ordinal,acquisition_lane,provider,request_url,outcome,started_at,completed_at)
       VALUES (?,1,'production_scrape','extension','https://example.test','acquired',NOW(6),NOW(6))`,
      [binding.insertId],
    );
    const [textVersion] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO cfx_evidence_text_versions
       (binding_id,acquisition_attempt_id,reference_content_id,access_level,extraction_method,source_url,cleaned_text,cleaned_text_sha256,character_count,word_count,selected_for_bearing)
       VALUES (?,?,?,'full_text','extension','https://example.test','evidence text',?,13,2,1)`,
      [binding.insertId, attempt.insertId, referenceContent.insertId, "b".repeat(64)],
    );
    const [bearingRun] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO cfx_targeted_bearing_runs
       (binding_id,acquired_text_version_id,target_claim_id,run_id,prompt_sha256,schema_sha256,model,exact_request_json,raw_response_json,parsed_response_json,validation_status,validation_diagnostics_json,started_at,completed_at)
       VALUES (?,?,?,'bearing-1',?,?,?,JSON_OBJECT(),JSON_OBJECT(),JSON_OBJECT(),'accepted',JSON_ARRAY(),NOW(6),NOW(6))`,
      [binding.insertId, textVersion.insertId, targetClaim.insertId, "c".repeat(64), "d".repeat(64), "gpt-4o-mini"],
    );
    await admin.query(
      `INSERT INTO reference_claim_task_link_provenance
       (reference_claim_task_links_id,targeted_bearing_run_id,acquired_text_version_id,claim_source_id,validation_status,access_level)
       VALUES (?,?,?,?,'accepted','full_text')`,
      [link.insertId, bearingRun.insertId, textVersion.insertId, source.insertId],
    );
    await admin.query(
      `INSERT INTO cfx_evidence_terminal_outbox
       (binding_id,scrape_job_id,terminal_status,result_content_id,payload_json)
       VALUES (?,?,'completed',?,JSON_OBJECT('candidateId','candidate-1'))`,
      [binding.insertId, job.insertId, referenceContent.insertId],
    );
    await assert.rejects(
      admin.query(
        `INSERT INTO cfx_evidence_terminal_outbox
         (binding_id,scrape_job_id,terminal_status,payload_json)
         VALUES (?,?,'failed',JSON_OBJECT())`,
        [binding.insertId, job.insertId],
      ),
      /Duplicate entry/u,
    );

    const rollback = await readFile("../artifacts/claim-foundry/cfx/schema-reconciliation/migration-rollback.sql", "utf8");
    for (const ddl of statements(rollback)) await admin.query(ddl);
    const [remaining] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND (TABLE_NAME LIKE 'cfx\\_%' OR TABLE_NAME='reference_claim_task_link_provenance')",
      [database],
    );
    assert.equal(Number(remaining[0]!.n), 0);
    const [parents] = await admin.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM claims");
    assert.equal(Number(parents[0]!.n), 2);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});
