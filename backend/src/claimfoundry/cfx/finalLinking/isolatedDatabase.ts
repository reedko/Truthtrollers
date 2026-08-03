import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import type { CfxSourceDocument } from "./baseline.js";

export type CfxIsolatedLinkDatabase = {
  databaseName: string;
  pool: mysql.Pool;
  query(sql: string, values?: unknown[]): Promise<any>;
};

function assertDatabaseName(value: string, productionDatabase: string | undefined): void {
  if (!/^cfx_final_link_fixture_[0-9a-z_]+$/u.test(value)) {
    throw new TypeError("isolated database name is outside the governed prefix");
  }
  if (value === productionDatabase) throw new Error("isolated database must not equal DB_DATABASE");
}

export async function createCfxIsolatedLinkDatabase(input: {
  databaseName: string;
  backendRoot: string;
}): Promise<CfxIsolatedLinkDatabase> {
  assertDatabaseName(input.databaseName, process.env.DB_DATABASE);
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  try {
    const [existing] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?",
      [input.databaseName],
    );
    if (existing.length) throw new Error(`isolated database already exists: ${input.databaseName}`);
    await admin.query(`CREATE DATABASE \`${input.databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally { await admin.end(); }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: input.databaseName,
    connectionLimit: 4,
  });
  const query = async (sql: string, values: unknown[] = []) => {
    const [rows] = await pool.query(sql, values);
    return rows;
  };
  try {
    for (const ddl of [
      `CREATE TABLE content (
        content_id INT NOT NULL AUTO_INCREMENT,content_name VARCHAR(1000),media_source VARCHAR(255),
        url VARCHAR(1000),assigned ENUM('assigned','unassigned') NOT NULL DEFAULT 'unassigned',
        progress ENUM('unassigned','Assigned','Started','Partially Complete','Awaiting Evaluation','Completed') NOT NULL DEFAULT 'unassigned',
        details TEXT,topic VARCHAR(255),content_type ENUM('task','reference','both') NOT NULL DEFAULT 'task',
        is_retracted TINYINT DEFAULT 0,is_active TINYINT DEFAULT 1,canonical_url_hash VARCHAR(64),
        canonical_url VARCHAR(2048),PRIMARY KEY(content_id)) ENGINE=InnoDB`,
      `CREATE TABLE claims (
        claim_id INT NOT NULL AUTO_INCREMENT,claim_text TEXT NOT NULL,
        claim_type ENUM('task','reference','snippet') DEFAULT 'task',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        veracity_score FLOAT DEFAULT 0,confidence_level FLOAT DEFAULT 0,last_verified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(claim_id)) ENGINE=InnoDB`,
      `CREATE TABLE content_claims (
        cc_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,content_id INT NOT NULL,claim_id INT NOT NULL,
        relationship_type VARCHAR(50),claim_role ENUM('thesis','pillar','pillar_support','evidence','background','fallibility_critical'),
        object_claim_text TEXT,speaker_entity VARCHAR(255),article_stance VARCHAR(32),selected_for_evaluation TINYINT DEFAULT 0,
        evaluation_eligible TINYINT DEFAULT 1,search_eligible TINYINT DEFAULT 1,verdict_eligible TINYINT DEFAULT 1,
        visibility VARCHAR(32) DEFAULT 'workspace',PRIMARY KEY(cc_id),
        FOREIGN KEY(content_id) REFERENCES content(content_id) ON DELETE CASCADE,
        FOREIGN KEY(claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE) ENGINE=InnoDB`,
      `CREATE TABLE claim_sources (
        claim_source_id INT NOT NULL AUTO_INCREMENT,claim_id INT NOT NULL,reference_content_id INT NOT NULL,
        is_primary TINYINT DEFAULT 0,user_id INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(claim_source_id),KEY claim_id(claim_id),KEY reference_content_id(reference_content_id),
        FOREIGN KEY(claim_id) REFERENCES claims(claim_id),
        FOREIGN KEY(reference_content_id) REFERENCES content(content_id)) ENGINE=InnoDB`,
      `CREATE TABLE content_relations (
        content_relation_id INT NOT NULL AUTO_INCREMENT,content_id INT NOT NULL,reference_content_id INT NOT NULL,
        added_by_user_id INT NULL,is_system TINYINT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(content_relation_id),UNIQUE KEY unique_content_reference(content_id,reference_content_id),
        FOREIGN KEY(content_id) REFERENCES content(content_id),
        FOREIGN KEY(reference_content_id) REFERENCES content(content_id)) ENGINE=InnoDB`,
      `CREATE TABLE reference_claim_task_links (
        reference_claim_task_links_id INT NOT NULL AUTO_INCREMENT,content_relation_id INT NULL,
        reference_claim_id INT NOT NULL,task_claim_id INT NOT NULL,
        stance ENUM('support','refute','nuance','insufficient') NOT NULL,score INT NULL,
        confidence DECIMAL(4,3) NULL,support_level DECIMAL(5,3) NULL,rationale TEXT,quote TEXT,
        created_by_ai TINYINT DEFAULT 1,verified_by_user_id INT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(reference_claim_task_links_id),
        UNIQUE KEY uq_rctl_relation_claim_pair(content_relation_id,reference_claim_id,task_claim_id),
        FOREIGN KEY(content_relation_id) REFERENCES content_relations(content_relation_id) ON DELETE CASCADE,
        FOREIGN KEY(reference_claim_id) REFERENCES claims(claim_id),
        FOREIGN KEY(task_claim_id) REFERENCES claims(claim_id)) ENGINE=InnoDB`,
    ]) await query(ddl);
    const migration = await readFile(path.join(input.backendRoot,
      "migrations/2026-08-02-01-cfx-source-assertion-provenance.sql"), "utf8");
    await query(migration);
    return { databaseName: input.databaseName, pool, query };
  } catch (error) {
    await pool.end();
    const cleanup = await mysql.createConnection({
      host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    });
    try { await cleanup.query(`DROP DATABASE IF EXISTS \`${input.databaseName}\``); }
    finally { await cleanup.end(); }
    throw error;
  }
}

export async function seedCfxFinalLinkFixture(input: {
  database: CfxIsolatedLinkDatabase;
  caseAssertions: Array<{ caseAssertionId: string; caseAssertionText: string }>;
  documents: CfxSourceDocument[];
}): Promise<{
  taskContentId: number;
  taskClaimIds: Map<string, number>;
  documents: Map<string, { documentId: string; referenceContentId: number }>;
}> {
  const task = await input.database.query(
    "INSERT INTO content(content_name,content_type,topic) VALUES ('CF1-F03 CFX final-link fixture','task','Fixture')");
  const taskContentId = Number(task.insertId);
  const taskClaimIds = new Map<string, number>();
  for (const item of input.caseAssertions) {
    const result = await input.database.query(
      "INSERT INTO claims(claim_text,claim_type) VALUES (?,'task')", [item.caseAssertionText]);
    const claimId = Number(result.insertId);
    taskClaimIds.set(item.caseAssertionId, claimId);
    await input.database.query(
      `INSERT INTO content_claims
       (content_id,claim_id,relationship_type,claim_role,object_claim_text,
        selected_for_evaluation,evaluation_eligible,search_eligible,verdict_eligible,visibility)
       VALUES (?,?,'contains','pillar',?,1,1,1,1,'workspace_eval')`,
      [taskContentId, claimId, item.caseAssertionText]);
  }
  const documents = new Map<string, { documentId: string; referenceContentId: number }>();
  for (const document of input.documents) {
    const result = await input.database.query(
      `INSERT INTO content(content_name,url,canonical_url,content_type,topic)
       VALUES (?,?,?,'reference','Evidence')`,
      [document.title, document.url, document.url]);
    documents.set(document.documentId, {
      documentId: document.documentId,
      referenceContentId: Number(result.insertId),
    });
  }
  return { taskContentId, taskClaimIds, documents };
}
