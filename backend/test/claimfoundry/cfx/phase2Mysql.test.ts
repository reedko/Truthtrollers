import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import {
  ensureCfxCanonicalAcquisition,
  persistCfxDiscoveryAssignments,
  retryCfxCanonicalAcquisition,
  upsertCfxCanonicalDocument,
} from "../../../src/services/cfxCanonicalDocumentStore.js";
import {
  persistEvidenceScrapeCapture,
} from "../../../src/services/cfxEvidenceScrapeAdapter.js";
import {
  aggregateCfxCanonicalDocuments,
} from "../../../src/claimfoundry/cfx/acquisition/canonicalDocuments.js";

dotenv.config({ path: path.resolve(".env") });
const enabled = process.env.CFX_REAL_MYSQL_TEST === "1";

function statements(sql:string):string[] {
  return sql.split(";").map((value) => value.trim()).filter((value) =>
    value && !value.split("\n").every((line) => line.trim().startsWith("--")));
}

function rowQuery(connection:mysql.Pool | mysql.PoolConnection) {
  return async (sql:string, values:unknown[] = []) => {
    const [rows] = await connection.query(sql, values);
    return rows;
  };
}

function transactionPool(pool:mysql.Pool) {
  return {
    async getConnection() {
      const connection = await pool.getConnection();
      return {
        beginTransaction:() => connection.beginTransaction(),
        commit:() => connection.commit(),
        rollback:() => connection.rollback(),
        release:() => connection.release(),
        query:rowQuery(connection),
      };
    },
  };
}

test("Phase 2 schema and acquisition invariants hold on disposable real MySQL", {
  skip:!enabled,
  timeout:120_000,
}, async () => {
  const database = `cfx_phase2_test_${process.pid}_${Date.now()}`;
  assert.match(database, /^cfx_phase2_test_[0-9_]+$/u);
  assert.notEqual(database, process.env.DB_DATABASE);
  const admin = await mysql.createConnection({
    host:process.env.DB_HOST || "127.0.0.1",
    port:Number(process.env.DB_PORT || 3306),
    user:process.env.DB_USER,
    password:process.env.DB_PASSWORD,
  });
  let pool:mysql.Pool | null = null;
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    pool = mysql.createPool({
      host:process.env.DB_HOST || "127.0.0.1",
      port:Number(process.env.DB_PORT || 3306),
      user:process.env.DB_USER,
      password:process.env.DB_PASSWORD,
      database,
      connectionLimit:4,
    });
    const query = rowQuery(pool);
    for (const ddl of [
      "CREATE TABLE content (content_id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY(content_id)) ENGINE=InnoDB",
      "CREATE TABLE claims (claim_id INT NOT NULL AUTO_INCREMENT, claim_text TEXT NOT NULL, claim_type ENUM('task','reference','snippet') DEFAULT 'task', PRIMARY KEY(claim_id)) ENGINE=InnoDB",
      `CREATE TABLE scrape_jobs (
        scrape_job_id BIGINT NOT NULL AUTO_INCREMENT,
        requested_by_user_id BIGINT NULL,
        requested_by_source ENUM('dashboard','extension','api') NOT NULL DEFAULT 'api',
        scrape_mode ENUM('scrape_current_tab','scrape_specific_url') NOT NULL DEFAULT 'scrape_specific_url',
        target_url TEXT NULL,task_content_id BIGINT NULL,
        status ENUM('pending','claimed','completed','failed','expired') NOT NULL DEFAULT 'pending',
        PRIMARY KEY(scrape_job_id)) ENGINE=InnoDB`,
      "CREATE TABLE claim_sources (claim_source_id INT NOT NULL AUTO_INCREMENT, claim_id INT NOT NULL, reference_content_id INT NOT NULL, PRIMARY KEY(claim_source_id), CONSTRAINT p2_cs_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id), CONSTRAINT p2_cs_content FOREIGN KEY(reference_content_id) REFERENCES content(content_id)) ENGINE=InnoDB",
      "CREATE TABLE reference_claim_task_links (reference_claim_task_links_id INT NOT NULL AUTO_INCREMENT, reference_claim_id INT NOT NULL, task_claim_id INT NOT NULL, PRIMARY KEY(reference_claim_task_links_id), CONSTRAINT p2_rctl_ref FOREIGN KEY(reference_claim_id) REFERENCES claims(claim_id), CONSTRAINT p2_rctl_task FOREIGN KEY(task_claim_id) REFERENCES claims(claim_id)) ENGINE=InnoDB",
    ]) await query(ddl);
    for (const migrationPath of [
      "migrations/2026-07-31-01-cfx-evidence-scrape-bindings.sql",
      "migrations/2026-08-01-01-cfx-phase2-canonical-documents.sql",
    ]) {
      const migration = await readFile(migrationPath, "utf8");
      for (const ddl of statements(migration)) await query(ddl);
    }

    const [types] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=? AND (
          (TABLE_NAME='cfx_canonical_documents' AND COLUMN_NAME='canonical_document_id') OR
          (TABLE_NAME='cfx_evidence_acquisition_bindings' AND COLUMN_NAME='canonical_document_id') OR
          (TABLE_NAME='cfx_document_discovery_assignments' AND COLUMN_NAME='target_claim_id') OR
          (TABLE_NAME='claims' AND COLUMN_NAME='claim_id'))
        ORDER BY TABLE_NAME,COLUMN_NAME`,
      [database],
    );
    const typeMap = new Map(types.map((row) =>
      [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row.COLUMN_TYPE]));
    assert.equal(typeMap.get("cfx_canonical_documents.canonical_document_id"), "bigint unsigned");
    assert.equal(typeMap.get("cfx_evidence_acquisition_bindings.canonical_document_id"), "bigint unsigned");
    assert.equal(typeMap.get("cfx_document_discovery_assignments.target_claim_id"), "int");
    assert.equal(typeMap.get("claims.claim_id"), "int");

    const [foreignKeys] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME IN
          ('fk_cfx_acq_canonical_document','fk_cfx_discovery_document',
           'fk_cfx_discovery_target','fk_cfx_text_supersedes')`,
      [database],
    );
    assert.deepEqual(foreignKeys.map((row) => row.CONSTRAINT_NAME).sort(), [
      "fk_cfx_acq_canonical_document", "fk_cfx_discovery_document",
      "fk_cfx_discovery_target", "fk_cfx_text_supersedes",
    ]);

    const [task] = await pool.query<mysql.ResultSetHeader>("INSERT INTO content VALUES ()");
    const [reference] = await pool.query<mysql.ResultSetHeader>("INSERT INTO content VALUES ()");
    const [claim] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO claims(claim_text,claim_type) VALUES ('target','task')");
    const [document] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO cfx_canonical_documents
       (run_id,document_key,canonical_identity_kind,canonical_identity_value,
        canonical_identity_sha256,pmid,representative_candidate_id,reference_content_id)
       VALUES ('run-1','DOC-one','pmid','123',?,'123','C1',?)`,
      ["a".repeat(64),reference.insertId],
    );
    await pool.query(
      `INSERT INTO cfx_canonical_document_identities
       (canonical_document_id,run_id,identity_kind,identity_value,identity_sha256,
        identity_match_sha256)
       VALUES (?,'run-1','pmid','123',?,?)`,
      [document.insertId,"a".repeat(64),"a".repeat(64)],
    );

    const acquisitionInput = {
      pool:transactionPool(pool),runId:"run-1",
      canonicalDocumentId:document.insertId,taskContentId:task.insertId,
      targetClaimId:claim.insertId,referenceContentId:reference.insertId,
      sourceUrl:"https://example.test/original",
      representative:{candidateId:"C1",propositionId:"P01"},
      sourceArtifactPath:"frozen/s2.json",sourceArtifactSha256:"b".repeat(64),
      groundingUnitIds:["U0001"],queueScrape:true,
    };
    const [first, second] = await Promise.all([
      ensureCfxCanonicalAcquisition(acquisitionInput),
      ensureCfxCanonicalAcquisition(acquisitionInput),
    ]);
    assert.equal([first.created,second.created].filter(Boolean).length, 1);
    const [counts] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT
        (SELECT COUNT(*) FROM cfx_evidence_acquisition_bindings) bindings,
        (SELECT COUNT(*) FROM scrape_jobs) jobs`,
    );
    assert.equal(Number(counts[0]!.bindings), 1);
    assert.equal(Number(counts[0]!.jobs), 1);
    const binding = first.binding.bindingId ? first.binding : second.binding;

    await pool.query("UPDATE scrape_jobs SET status='failed' WHERE scrape_job_id=?", [binding.scrapeJobId]);
    const [retry1,retry2] = await Promise.all([
      retryCfxCanonicalAcquisition({
        pool:transactionPool(pool),bindingId:binding.bindingId,
        openedTabId:77,extensionInstanceId:"ext-p2",
      }),
      retryCfxCanonicalAcquisition({
        pool:transactionPool(pool),bindingId:binding.bindingId,
        openedTabId:77,extensionInstanceId:"ext-p2",
      }),
    ]);
    assert.equal([retry1.created,retry2.created].filter(Boolean).length, 1);
    assert.equal(retry1.scrapeJobId, retry2.scrapeJobId);

    const bound = {
      ...binding,
      canonicalDocumentId:document.insertId,runId:"run-1",
      scrapeJobId:retry1.scrapeJobId,requestedUrl:"https://example.test/original",
      acquisitionArtifactId:"ACQ-C1",
    };
    const captureInput = {
      binding:bound,referenceContentId:reference.insertId,
      requestedUrl:"https://example.test/original",
      resolvedUrl:"https://mirror.test/final?b=2&a=1#fragment",
      rawHtml:"<article>raw</article>",rawText:"raw",
      cleanedText:"immutable acquired text version one",
    };
    const version1 = await persistEvidenceScrapeCapture(query, captureInput);
    const replay = await persistEvidenceScrapeCapture(query, captureInput);
    const version2 = await persistEvidenceScrapeCapture(query, {
      ...captureInput,cleanedText:"immutable acquired text version two",
    });
    assert.equal(replay.acquiredTextVersionId, version1.acquiredTextVersionId);
    assert.equal(replay.created, false);
    assert.equal(version2.supersedesTextVersionId, version1.acquiredTextVersionId);
    const [versions] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT acquired_text_version_id,supersedes_text_version_id,
              cleaned_text_sha256,selected_for_bearing
         FROM cfx_evidence_text_versions ORDER BY acquired_text_version_id`,
    );
    assert.equal(versions.length, 2);
    assert.equal(Number(versions[0]!.selected_for_bearing), 0);
    assert.equal(Number(versions[1]!.selected_for_bearing), 1);
    assert.notEqual(versions[0]!.cleaned_text_sha256, versions[1]!.cleaned_text_sha256);
    const [redirectAlias] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT identity_value FROM cfx_canonical_document_identities
        WHERE identity_kind='resolved_url'`,
    );
    assert.deepEqual(redirectAlias.map((row) => row.identity_value), [
      "https://mirror.test/final?a=1&b=2",
    ]);

    await pool.query(
      `INSERT INTO cfx_document_discovery_assignments
       (canonical_document_id,run_id,proposition_id,target_claim_id,candidate_id,
        query_id,query_intent,query_text,provider,retrieval_rank,
        provider_request_id,assignment_sha256)
       VALUES (?,'run-1','P01',?,'C1','Q5','qualification',
               'claim-specific limitations','pubmed',1,'REQ-1',?)`,
      [document.insertId,claim.insertId,"c".repeat(64)],
    );
    const [provenance] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT proposition_id,target_claim_id,candidate_id,query_id,query_intent,provider,retrieval_rank FROM cfx_document_discovery_assignments",
    );
    assert.deepEqual({...provenance[0]}, {
      proposition_id:"P01",target_claim_id:claim.insertId,candidate_id:"C1",
      query_id:"Q5",query_intent:"qualification",provider:"pubmed",retrieval_rank:1,
    });
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});

test("query_intent is nullable: new assignments persist without it, legacy explicit values remain readable", {
  skip:!enabled,
  timeout:120_000,
}, async () => {
  const database = `cfx_phase2_nullable_test_${process.pid}_${Date.now()}`;
  assert.match(database, /^cfx_phase2_nullable_test_[0-9_]+$/u);
  assert.notEqual(database, process.env.DB_DATABASE);
  const admin = await mysql.createConnection({
    host:process.env.DB_HOST || "127.0.0.1",
    port:Number(process.env.DB_PORT || 3306),
    user:process.env.DB_USER,
    password:process.env.DB_PASSWORD,
  });
  let pool:mysql.Pool | null = null;
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    pool = mysql.createPool({
      host:process.env.DB_HOST || "127.0.0.1",
      port:Number(process.env.DB_PORT || 3306),
      user:process.env.DB_USER,
      password:process.env.DB_PASSWORD,
      database,
      connectionLimit:4,
    });
    const query = rowQuery(pool);
    for (const ddl of [
      "CREATE TABLE content (content_id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY(content_id)) ENGINE=InnoDB",
      "CREATE TABLE claims (claim_id INT NOT NULL AUTO_INCREMENT, claim_text TEXT NOT NULL, claim_type ENUM('task','reference','snippet') DEFAULT 'task', PRIMARY KEY(claim_id)) ENGINE=InnoDB",
      `CREATE TABLE scrape_jobs (
        scrape_job_id BIGINT NOT NULL AUTO_INCREMENT,
        requested_by_user_id BIGINT NULL,
        requested_by_source ENUM('dashboard','extension','api') NOT NULL DEFAULT 'api',
        scrape_mode ENUM('scrape_current_tab','scrape_specific_url') NOT NULL DEFAULT 'scrape_specific_url',
        target_url TEXT NULL,task_content_id BIGINT NULL,
        status ENUM('pending','claimed','completed','failed','expired') NOT NULL DEFAULT 'pending',
        PRIMARY KEY(scrape_job_id)) ENGINE=InnoDB`,
      "CREATE TABLE claim_sources (claim_source_id INT NOT NULL AUTO_INCREMENT, claim_id INT NOT NULL, reference_content_id INT NOT NULL, PRIMARY KEY(claim_source_id), CONSTRAINT p2n_cs_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id), CONSTRAINT p2n_cs_content FOREIGN KEY(reference_content_id) REFERENCES content(content_id)) ENGINE=InnoDB",
      "CREATE TABLE reference_claim_task_links (reference_claim_task_links_id INT NOT NULL AUTO_INCREMENT, reference_claim_id INT NOT NULL, task_claim_id INT NOT NULL, PRIMARY KEY(reference_claim_task_links_id), CONSTRAINT p2n_rctl_ref FOREIGN KEY(reference_claim_id) REFERENCES claims(claim_id), CONSTRAINT p2n_rctl_task FOREIGN KEY(task_claim_id) REFERENCES claims(claim_id)) ENGINE=InnoDB",
    ]) await query(ddl);
    // Apply the original 2026-08-01 migration unchanged, then the new
    // forward-only nullable migration on top of it -- proving the two
    // together reproduce the exact real-database end state.
    for (const migrationPath of [
      "migrations/2026-07-31-01-cfx-evidence-scrape-bindings.sql",
      "migrations/2026-08-01-01-cfx-phase2-canonical-documents.sql",
      "migrations/2026-08-05-01-cfx-discovery-assignment-query-intent-nullable.sql",
    ]) {
      const migration = await readFile(migrationPath, "utf8");
      for (const ddl of statements(migration)) await query(ddl);
    }

    const [[column]] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME='cfx_document_discovery_assignments' AND COLUMN_NAME='query_intent'`,
      [database],
    );
    assert.equal(column!.IS_NULLABLE, "YES");
    assert.equal(
      column!.COLUMN_TYPE,
      "enum('canonical','entity_predicate','source_identity','independent_evidence','counterevidence','qualification')",
    );

    const [claim] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO claims(claim_text,claim_type) VALUES ('target','task')");

    // 5. No active application object includes queryIntent: the real,
    // unmodified aggregateCfxCanonicalDocuments() output carries no such field.
    const candidate = {
      candidateId: "C1", propositionId: "P01", queryId: "Q1" as const,
      provider: "tavily", providerRecordId: null, title: "Nullable-era document",
      authors: [] as string[], publication: null, publicationDate: null,
      doi: null, pmid: "999999", url: null, canonicalUrl: null, resolvedUrl: null,
      abstractOrSnippet: null, sourceType: null, retrievalScore: 1, retrievalRank: 1,
      rawArtifactPath: "raw/C1.json",
      discoveryPaths: [{
        propositionId: "P01", queryId: "Q1" as const, query: "nullable era query",
        provider: "tavily", retrievalRank: 1, requestId: "REQ-P01-Q1",
      }],
    };
    const [document] = aggregateCfxCanonicalDocuments([
      { candidate, targetClaimId: claim.insertId },
    ]);
    assert.equal("queryIntent" in document!.discoveryAssignments[0]!, false);
    assert.equal(document!.discoveryAssignments[0]!.propositionId, "P01");
    assert.equal(document!.discoveryAssignments[0]!.targetClaimId, claim.insertId);

    const canonicalDocumentId = await upsertCfxCanonicalDocument(query, {
      runId: "run-nullable", document: document!,
    });

    // 1 & 2. A new discovery-assignment insert through the real,
    // unmodified production function succeeds without query_intent, and the
    // persisted row reads back as NULL.
    const persisted = await persistCfxDiscoveryAssignments(query, {
      runId: "run-nullable",
      canonicalDocumentId,
      assignments: document!.discoveryAssignments,
    });
    assert.equal(persisted.insertedCount, 1);
    const [[newRow]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT query_intent FROM cfx_document_discovery_assignments WHERE candidate_id='C1'",
    );
    assert.equal(newRow!.query_intent, null);

    // 3. A legacy row written with an explicit enum value (as any
    // pre-migration historical row would have been) remains readable and
    // unchanged by the nullable migration.
    await pool.query(
      `INSERT INTO cfx_document_discovery_assignments
       (canonical_document_id,run_id,proposition_id,target_claim_id,candidate_id,
        query_id,query_intent,query_text,provider,retrieval_rank,
        provider_request_id,assignment_sha256)
       VALUES (?,'run-nullable','P01',?,'LEGACY-C1','Q5','qualification',
               'legacy claim-specific limitations','pubmed',1,'REQ-LEGACY',?)`,
      [canonicalDocumentId, claim.insertId, "d".repeat(64)],
    );
    const [[legacyRow]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT query_intent FROM cfx_document_discovery_assignments WHERE candidate_id='LEGACY-C1'",
    );
    assert.equal(legacyRow!.query_intent, "qualification");
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});
