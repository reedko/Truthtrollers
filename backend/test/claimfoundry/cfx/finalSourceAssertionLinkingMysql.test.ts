import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { prepareCfxFinalLinkingBaseline } from "../../../src/claimfoundry/cfx/finalLinking/baseline.js";
import type { CfxAcceptedLinkSuggestion } from "../../../src/claimfoundry/cfx/finalLinking/linkSuggestion.js";
import {
  persistCfxLinkSuggestions,
  persistCfxSourceAssertions,
  type CfxFinalLinkingPersistenceStore,
} from "../../../src/claimfoundry/cfx/finalLinking/persistence.js";
import {
  ensureClaimSource,
  ensureContentClaim,
  ensureContentRelation,
  findOrCreateCanonicalClaim,
} from "../../../src/services/cfxProductionEvidenceStore.js";

dotenv.config({ path: path.resolve(".env") });
const enabled = process.env.CFX_REAL_MYSQL_TEST === "1";
const repositoryRoot = path.resolve(process.cwd(), "..");

function rowQuery(connection: mysql.Pool | mysql.PoolConnection) {
  return async (sql: string, values: unknown[] = []) => {
    const [rows] = await connection.query(sql, values);
    return rows;
  };
}

async function loadBaseline() {
  const root = path.join(repositoryRoot,
    "artifacts/claim-foundry/cfx/CF1-F03/cfx-single-assertion-packet-extraction-20260802090828");
  const [acceptedRows, exactExtractionRequests, summary, selectedDocuments] = await Promise.all([
    readFile(path.join(root, "accepted-source-assertions.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "exact-model-requests.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "model-test-summary.json"), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot,
      "artifacts/claim-foundry/cfx/CF1-F03/cfx-ranked-minimal-extraction-20260802061220/selected-documents.json"), "utf8").then(JSON.parse),
  ]);
  return prepareCfxFinalLinkingBaseline({
    extractionRunId: path.basename(root), acceptedRows, exactExtractionRequests,
    extractionPromptHash: summary.promptHash, extractionSchemaHash: summary.schemaHash,
    selectedDocuments,
  });
}

test("final source-assertion and suggested-link persistence is FK-safe and idempotent on real MySQL", {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  const database = `cfx_final_link_test_${process.pid}_${Date.now()}`;
  assert.match(database, /^cfx_final_link_test_[0-9_]+$/u);
  assert.notEqual(database, process.env.DB_DATABASE);
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  });
  let pool: mysql.Pool | null = null;
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, database, connectionLimit: 2,
    });
    const query = rowQuery(pool);
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
        PRIMARY KEY(claim_source_id),FOREIGN KEY(claim_id) REFERENCES claims(claim_id),
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
    const migration = await readFile("migrations/2026-08-02-01-cfx-source-assertion-provenance.sql", "utf8");
    await query(migration);

    const fixture = await loadBaseline();
    const [taskContentResult] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO content(content_name,content_type,topic) VALUES ('CF1-F03','task','Fixture')");
    const taskContentId = taskContentResult.insertId;
    const taskClaimIds = new Map<string, number>();
    for (const item of fixture.caseAssertions) {
      const [result] = await pool.query<mysql.ResultSetHeader>(
        "INSERT INTO claims(claim_text,claim_type) VALUES (?,'task')", [item.caseAssertionText]);
      taskClaimIds.set(item.caseAssertionId, result.insertId);
      await pool.query(
        `INSERT INTO content_claims
         (content_id,claim_id,relationship_type,claim_role,object_claim_text,
          selected_for_evaluation,evaluation_eligible,search_eligible,verdict_eligible,visibility)
         VALUES (?,?,'contains','pillar',?,1,1,1,1,'workspace_eval')`,
        [taskContentId, result.insertId, item.caseAssertionText]);
    }
    const documents = new Map<string, { documentId: string; referenceContentId: number }>();
    for (const document of fixture.documents) {
      const [result] = await pool.query<mysql.ResultSetHeader>(
        "INSERT INTO content(content_name,url,canonical_url,content_type,topic) VALUES (?,?,?,'reference','Evidence')",
        [document.title, document.url, document.url]);
      documents.set(document.documentId, { documentId: document.documentId, referenceContentId: result.insertId });
    }

    const store: CfxFinalLinkingPersistenceStore = {
      ensureClaimSource, ensureContentClaim, ensureContentRelation, findOrCreateCanonicalClaim,
    };
    const first = await persistCfxSourceAssertions({ query, store, taskClaimIds, documents, rows: fixture.rows });
    const second = await persistCfxSourceAssertions({ query, store, taskClaimIds, documents, rows: fixture.rows });
    assert.equal(first.length, 14);
    assert.equal(first.every((row) => row.persistenceStatus === "inserted"), true);
    assert.equal(second.every((row) => row.persistenceStatus === "reused"), true);
    assert.deepEqual(first.map((row) => row.evidenceClaimId), second.map((row) => row.evidenceClaimId));
    const [[provenanceCount]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM cfx_source_assertion_provenance");
    assert.equal(Number(provenanceCount.n), 14);

    const suggestions: CfxAcceptedLinkSuggestion[] = first.map((row, rowIndex) => ({
      caseAssertionId: row.caseAssertionId, rowIndex, sourceAssertionId: row.sourceAssertionId,
      suggestedStance: rowIndex % 3 === 0 ? "support" : rowIndex % 3 === 1 ? "refute" : "nuance",
      suggestedScore: 0.8, rationale: "Offline persistence fixture suggestion.",
    }));
    const modelCallIds = new Map([["P54895", "link-request-001"], ["P54897", "link-request-002"]]);
    const linkInput = {
      query, store, taskContentId, rows: first, suggestions, suggestionRunId: "offline-fixture-link-run",
      suggestionModelCallIds: modelCallIds, suggestionPromptHash: "c".repeat(64),
      suggestionSchemaHash: "d".repeat(64), model: "offline-fixture",
    };
    const firstLinks = await persistCfxLinkSuggestions(linkInput);
    const secondLinks = await persistCfxLinkSuggestions(linkInput);
    assert.equal(firstLinks.length, 14);
    assert.deepEqual(firstLinks.map((row) => row.referenceClaimTaskLinkId),
      secondLinks.map((row) => row.referenceClaimTaskLinkId));
    const [[linkCount]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM reference_claim_task_links");
    assert.ok(Number(linkCount.n) > 0 && Number(linkCount.n) <= 14);
    const [[invalidMetrics]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) n FROM reference_claim_task_links
        WHERE score IS NOT NULL OR confidence IS NOT NULL OR created_by_ai<>1 OR verified_by_user_id IS NOT NULL`);
    assert.equal(Number(invalidMetrics.n), 0);
    const [[groundingMismatch]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) n FROM cfx_source_assertion_provenance
        WHERE exact_excerpt='' OR excerpt_end<excerpt_start OR suggestion_status<>'accepted'`);
    assert.equal(Number(groundingMismatch.n), 0);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const rollbackQuery = rowQuery(connection);
      const rollbackRow = { ...fixture.rows[0]!, sourceAssertionId: "SA-rollback-only" };
      await persistCfxSourceAssertions({ query: rollbackQuery, store, taskClaimIds, documents, rows: [rollbackRow] });
      await connection.rollback();
    } finally { connection.release(); }
    const [[rollbackCount]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM cfx_source_assertion_provenance WHERE source_assertion_id='SA-rollback-only'");
    assert.equal(Number(rollbackCount.n), 0);
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});
