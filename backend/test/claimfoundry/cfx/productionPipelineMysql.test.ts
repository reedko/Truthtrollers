import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { processCfxEvidenceBinding } from "../../../src/services/cfxEvidenceCoordinator.js";
import { runCfxProductionEvidencePipeline } from "../../../src/services/cfxProductionEvidencePipeline.js";

dotenv.config({ path: path.resolve(".env") });

const enabled = process.env.CFX_REAL_MYSQL_TEST === "1";
const fixturePath = path.resolve(
  "../artifacts/claim-foundry/cfx/CF1-F03/" +
    "cfx-s2-evidence-search-cfx-substantive-review-cf1-f03-20260730234738-20260731051936/" +
    "evidence_search_handoffs.json",
);

function statements(sql: string): string[] {
  return sql.split(";").map((value) => value.trim()).filter(Boolean);
}

function rowQuery(connection: mysql.Connection | mysql.PoolConnection) {
  return async (sql: string, values: unknown[] = []) => {
    const [rows] = await connection.query(sql, values);
    return rows;
  };
}

function transactionPool(pool: mysql.Pool) {
  return {
    async getConnection() {
      const connection = await pool.getConnection();
      return {
        beginTransaction: () => connection.beginTransaction(),
        commit: () => connection.commit(),
        rollback: () => connection.rollback(),
        release: () => connection.release(),
        query: rowQuery(connection),
      };
    },
  };
}

async function createProductionParents(query: ReturnType<typeof rowQuery>) {
  for (const ddl of [
    `CREATE TABLE content (
      content_id INT NOT NULL AUTO_INCREMENT,
      content_name VARCHAR(1000) NULL,
      media_source VARCHAR(255) NULL,
      url TEXT NULL,
      assigned ENUM('unassigned','assigned') NOT NULL DEFAULT 'unassigned',
      progress ENUM('unassigned','assigned','completed') NOT NULL DEFAULT 'unassigned',
      details LONGTEXT NULL,
      content_text LONGTEXT NULL,
      topic VARCHAR(255) NULL,
      content_type ENUM('task','reference') NOT NULL DEFAULT 'task',
      is_retracted TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      canonical_url_hash CHAR(64) NULL,
      canonical_url TEXT NULL,
      PRIMARY KEY(content_id),
      UNIQUE KEY uq_content_canonical_hash(canonical_url_hash)
    ) ENGINE=InnoDB`,
    `CREATE TABLE claims (
      claim_id INT NOT NULL AUTO_INCREMENT,
      claim_text TEXT NOT NULL,
      claim_type ENUM('task','reference','snippet') NOT NULL DEFAULT 'task',
      veracity_score DECIMAL(8,4) NULL,
      confidence_level DECIMAL(8,4) NULL,
      last_verified DATETIME NULL,
      PRIMARY KEY(claim_id),
      KEY idx_claim_text(claim_type,claim_text(191))
    ) ENGINE=InnoDB`,
    `CREATE TABLE content_claims (
      cc_id INT NOT NULL AUTO_INCREMENT,
      content_id INT NOT NULL,
      claim_id INT NOT NULL,
      relationship_type VARCHAR(80) NULL,
      claim_role ENUM('pillar','evidence') NULL,
      object_claim_text TEXT NULL,
      speaker_entity VARCHAR(1000) NULL,
      article_stance VARCHAR(80) NULL,
      selected_for_evaluation TINYINT(1) NOT NULL DEFAULT 0,
      evaluation_eligible TINYINT(1) NOT NULL DEFAULT 0,
      search_eligible TINYINT(1) NOT NULL DEFAULT 0,
      verdict_eligible TINYINT(1) NOT NULL DEFAULT 0,
      visibility VARCHAR(80) NULL,
      PRIMARY KEY(cc_id),
      UNIQUE KEY uq_content_claim(content_id,claim_id),
      CONSTRAINT cc_content FOREIGN KEY(content_id) REFERENCES content(content_id),
      CONSTRAINT cc_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE claim_evaluation_targets (
      evaluation_target_id INT NOT NULL AUTO_INCREMENT,
      content_id INT NOT NULL,
      claim_id INT NOT NULL,
      target_order INT NOT NULL DEFAULT 0,
      target_text TEXT NULL,
      source_excerpt LONGTEXT NULL,
      article_stance VARCHAR(80) NULL,
      study_title VARCHAR(1000) NULL,
      study_authors TEXT NULL,
      study_year VARCHAR(40) NULL,
      study_identifier VARCHAR(1000) NULL,
      population_scope VARCHAR(1000) NULL,
      query_hints_json JSON NULL,
      PRIMARY KEY(evaluation_target_id),
      UNIQUE KEY uq_eval_target(content_id,claim_id,target_order),
      CONSTRAINT cet_content FOREIGN KEY(content_id) REFERENCES content(content_id),
      CONSTRAINT cet_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE scrape_jobs (
      scrape_job_id BIGINT NOT NULL AUTO_INCREMENT,
      requested_by_user_id BIGINT NULL,
      requested_by_source ENUM('dashboard','extension','api') NOT NULL,
      scrape_mode ENUM('scrape_current_tab','scrape_specific_url') NOT NULL,
      target_url TEXT NOT NULL,
      task_content_id BIGINT NULL,
      status ENUM('pending','claimed','completed','failed','expired') NOT NULL DEFAULT 'pending',
      result_content_id INT NULL,
      PRIMARY KEY(scrape_job_id),
      CONSTRAINT sj_result_content FOREIGN KEY(result_content_id) REFERENCES content(content_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE content_relations (
      content_relation_id INT NOT NULL AUTO_INCREMENT,
      content_id INT NOT NULL,
      reference_content_id INT NOT NULL,
      added_by_user_id BIGINT NULL,
      is_system TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY(content_relation_id),
      UNIQUE KEY uq_content_relation(content_id,reference_content_id),
      CONSTRAINT cr_content FOREIGN KEY(content_id) REFERENCES content(content_id),
      CONSTRAINT cr_reference FOREIGN KEY(reference_content_id) REFERENCES content(content_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE claim_sources (
      claim_source_id INT NOT NULL AUTO_INCREMENT,
      claim_id INT NOT NULL,
      reference_content_id INT NOT NULL,
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      user_id BIGINT NULL,
      PRIMARY KEY(claim_source_id),
      UNIQUE KEY uq_claim_source(claim_id,reference_content_id),
      CONSTRAINT cs_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id),
      CONSTRAINT cs_content FOREIGN KEY(reference_content_id) REFERENCES content(content_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE reference_claim_task_links (
      reference_claim_task_links_id INT NOT NULL AUTO_INCREMENT,
      content_relation_id INT NOT NULL,
      reference_claim_id INT NOT NULL,
      task_claim_id INT NOT NULL,
      stance ENUM('support','refute','nuance') NOT NULL,
      score DECIMAL(8,4) NULL,
      confidence DECIMAL(8,4) NULL,
      support_level DECIMAL(5,3) NULL,
      rationale LONGTEXT NULL,
      quote LONGTEXT NULL,
      created_by_ai TINYINT(1) NOT NULL DEFAULT 0,
      verified_by_user_id BIGINT NULL,
      PRIMARY KEY(reference_claim_task_links_id),
      UNIQUE KEY uq_reference_task_link(content_relation_id,reference_claim_id,task_claim_id),
      CONSTRAINT rctl_relation FOREIGN KEY(content_relation_id) REFERENCES content_relations(content_relation_id),
      CONSTRAINT rctl_ref FOREIGN KEY(reference_claim_id) REFERENCES claims(claim_id),
      CONSTRAINT rctl_task FOREIGN KEY(task_claim_id) REFERENCES claims(claim_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE reference_claim_links (
      ref_claim_link_id INT NOT NULL AUTO_INCREMENT,
      claim_id INT NOT NULL,
      content_relation_id INT NULL,
      task_claim_id INT NULL,
      reference_content_id INT NOT NULL,
      stance ENUM('support','refute','nuance','insufficient') NOT NULL,
      score FLOAT NULL,
      confidence DECIMAL(5,4) NULL,
      support_level DECIMAL(6,4) NULL,
      rationale TEXT NULL,
      evidence_text TEXT NULL,
      evidence_offsets VARCHAR(255) NULL,
      created_by_ai TINYINT(1) DEFAULT 1,
      scrape_status ENUM('full','snippet_only','abstract_only','identity_only','failed') DEFAULT 'full',
      verified_by_user_id INT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(ref_claim_link_id),
      KEY idx_rcl_content_relation(content_relation_id),
      KEY idx_rcl_task_claim(task_claim_id),
      CONSTRAINT rcl_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id),
      CONSTRAINT rcl_task FOREIGN KEY(task_claim_id) REFERENCES claims(claim_id),
      CONSTRAINT rcl_relation FOREIGN KEY(content_relation_id) REFERENCES content_relations(content_relation_id),
      CONSTRAINT rcl_reference FOREIGN KEY(reference_content_id) REFERENCES content(content_id)
    ) ENGINE=InnoDB`,
  ]) await query(ddl);
}

async function loadCompiledRuntime() {
  const [handoff, planning, retrieval, candidates, canonicalDocuments, artifacts, sourceUnits] = await Promise.all([
    import("../../../dist/claimfoundry/cfx/evidenceSearch/buildEvidenceSearchHandoff.js"),
    import("../../../dist/claimfoundry/cfx/retrieval/queryPlanning.js"),
    import("../../../dist/claimfoundry/cfx/retrieval/executeRetrieval.js"),
    import("../../../dist/claimfoundry/cfx/retrieval/candidates.js"),
    import("../../../dist/claimfoundry/cfx/acquisition/canonicalDocuments.js"),
    import("../../../dist/claimfoundry/cfx/artifacts/immutableArtifacts.js"),
    import("../../../dist/claimfoundry/shared/sourceUnits/index.js"),
  ]);
  return { ...handoff, ...planning, ...retrieval, ...candidates, ...canonicalDocuments, ...artifacts, ...sourceUnits };
}

test("F03 fixture traverses the production CFX pipeline and real MySQL without external calls", {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  const database = `cfx_pipeline_test_${process.pid}_${Date.now()}`;
  assert.match(database, /^cfx_pipeline_test_[0-9_]+$/u);
  assert.notEqual(database, process.env.DB_DATABASE);
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: false,
  });
  let pool: mysql.Pool | null = null;
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database,
      connectionLimit: 4,
    });
    const query = rowQuery(pool);
    await createProductionParents(query);
    for (const migrationPath of [
      "migrations/2026-07-31-01-cfx-evidence-scrape-bindings.sql",
      "migrations/2026-08-01-01-cfx-phase2-canonical-documents.sql",
      "migrations/2026-08-01-02-cfx-phase3-semantic-execution.sql",
    ]) {
      const migration = await readFile(migrationPath, "utf8");
      for (const ddl of statements(migration)) await query(ddl);
    }

    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    assert.equal(fixture.results.length, 12);
    const [taskResult] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO content(content_name,url,content_type,topic)
       VALUES ('CF1-F03 production-path fixture','https://fixture.test/cf1-f03','task','Fixture')`,
    );
    const taskContentId = taskResult.insertId;
    const claimIds: number[] = [];
    for (const proposition of fixture.results) {
      const [claimResult] = await pool.query<mysql.ResultSetHeader>(
        "INSERT INTO claims(claim_text,claim_type,veracity_score,confidence_level,last_verified) VALUES (?,'task',0,0,NOW())",
        [proposition.substantiveAssertion],
      );
      claimIds.push(claimResult.insertId);
      await pool.query(
        `INSERT INTO content_claims
         (content_id,claim_id,relationship_type,claim_role,object_claim_text,speaker_entity,
          article_stance,selected_for_evaluation,evaluation_eligible,search_eligible,verdict_eligible,visibility)
         VALUES (?,?,'contains','pillar',?,?,?,1,1,1,1,'workspace_eval')`,
        [taskContentId, claimResult.insertId, proposition.substantiveAssertion,
          proposition.assertionSource, proposition.articleStance],
      );
      await pool.query(
        `INSERT INTO claim_evaluation_targets
         (content_id,claim_id,target_order,target_text,source_excerpt,article_stance,query_hints_json)
         VALUES (?,?,0,?,?,?,JSON_OBJECT())`,
        [taskContentId, claimResult.insertId, proposition.substantiveAssertion,
          proposition.evidenceSearchHandoff.groundingText, proposition.articleStance],
      );
    }

    let planningCalls = 0;
    const planningProvider = {
      async invokeStructured(request: { user: string }) {
        planningCalls += 1;
        const packets = JSON.parse(
          request.user.split("PROPOSITION_PACKETS:\n")[1]!,
        ) as Array<{propositionId:string;immutableSubstantiveAssertion:string}>;
        assert.equal(packets.length, 12);
        return {
          output: {
            plans: packets.map((packet) => ({
              propositionId:packet.propositionId,
              queries: [
                { queryId: "Q2", queryIntent:"entity_predicate", query: `${packet.immutableSubstantiveAssertion} relationship`, provider: "web", rationale: "Fixture literal relation query." },
                { queryId: "Q4", queryIntent:"independent_evidence", query: `${packet.immutableSubstantiveAssertion} independent analysis`, provider: "web", rationale: "Fixture independent evidence query." },
                { queryId: "Q5", queryIntent:"qualification", query: `${packet.immutableSubstantiveAssertion} methodological limitations`, provider: "web", rationale: "Fixture qualification query." },
              ],
            })),
          },
          rawResponse: { id: "fixture-planning-response", fixture: true },
          model: "fixture-deterministic-provider",
          usage: { inputTokens: 1200, cachedInputTokens: 0, outputTokens: 500, totalTokens: 1700 },
          responseId: "fixture-planning-response",
          requestId: "fixture-planning-request",
        };
      },
    };

    const evidenceText = "The study retained every eligible case and reported that the prespecified analysis found no association.";
    const exactExcerpt = "reported that the prespecified analysis found no association";
    let retrievalCalls = 0;
    const retrievalTransport = {
      async search(request: { propositionId: string; queryId: string; requestId: string }) {
        retrievalCalls += 1;
        const candidates = request.propositionId === `P${claimIds[0]}` && request.queryId === "Q1"
          ? [{
              id: "fixture-evidence-1",
              provider: "tavily",
              title: "Fixture evidence document",
              url: "https://example.test/f03-evidence",
              snippet: evidenceText,
              sourceType: "study",
            }]
          : [];
        return {
          provider: "tavily",
          providerRequestId: `fixture-${request.requestId}`,
          rawResponse: { fixture: true, requestId: request.requestId, resultCount: candidates.length },
          candidates,
        };
      },
    };

    let bearingCalls = 0;
    const bearingProvider = {
      async invokeStructured(request: { user: string }) {
        bearingCalls += 1;
        const propositionId = request.user.match(/propositionId: (P[0-9]+)/u)?.[1];
        const candidateId = request.user.match(/candidateId: (CAND-[A-Za-z0-9]+)/u)?.[1];
        assert.ok(propositionId);
        assert.ok(candidateId);
        const charStart = evidenceText.indexOf(exactExcerpt);
        return {
          output: {
            candidateId,
            propositionId,
            accessLevel: "full_text",
            noBearingAssertionsFound: false,
            assertions: [{
              evidenceAssertion: "The prespecified analysis found no association.",
              bearingRelation: "challenges",
              exactExcerpt,
              sourceLocation: {
                page: null,
                section: null,
                paragraph: null,
                blockId: "E0001",
                charStart,
                charEnd: charStart + exactExcerpt.length,
              },
              whyItBears: "The reported result directly challenges the target assertion.",
              confidence: 0.8,
              quality: 0.9,
              limitationsVisibleInText: [],
            }],
          },
          rawResponse: { id: "fixture-bearing-response", fixture: true },
          model: "fixture-deterministic-provider",
          usage: { inputTokens: 200, cachedInputTokens: 0, outputTokens: 100, totalTokens: 300 },
          responseId: "fixture-bearing-response",
          requestId: "fixture-bearing-request",
        };
      },
    };

    const artifacts = new Map<string, unknown>();
    const txPool = transactionPool(pool);
    const result = await runCfxProductionEvidencePipeline({
      query,
      pool: txPool,
      taskContentId,
      claimIds,
      provider: planningProvider,
      bearingProvider,
      retrievalTransport,
      async academicResolver() { return null; },
      async automaticAcquirer({candidate}: any) {
        return {
          acquired:true,
          // Exercise semantic bearing with a genuinely eligible acquired-text
          // version, including the exact model-returned excerpt. A tiny shell
          // correctly short-circuits as snippet-only in production.
          cleanedText:Array.from({length:6}, () => evidenceText).join(" "),
          method:"publisher_html",
          sourceUrl:candidate.url,
          resolvedUrl:candidate.url,
          contentType:"text/html",
          completeness:"complete",
          attempts:[{method:"axios",status:"success",url:candidate.url,resolvedUrl:candidate.url,httpStatus:200,contentType:"text/html",characterCount:136,timingMs:1,diagnostic:null,rawResponse:"<article>fixture evidence</article>",tier:"normal_platform_scrape"}],
        };
      },
      async sourceQualityEnricher() { return {status:"created"}; },
      async sourceCrestProcessor() { return {status:"identity_pending"}; },
      async publishingIdentityProcessor() { return {persistence:null}; },
      runtimeLoader: loadCompiledRuntime,
      bearingProcessor(input: any) {
        return processCfxEvidenceBinding({
          ...input,
          runtimeLoader: () => import("../../../dist/claimfoundry/cfx/evidenceBearing/targetedExtraction.js"),
        });
      },
      artifactStoreFactory() {
        return {
          root: "memory/f03-production-e2e",
          async initialize() {},
          async write(file: string, value: unknown) { artifacts.set(file, value); },
          async finalize() {
            return { root: "memory/f03-production-e2e", aggregateSha256: "e".repeat(64) };
          },
        };
      },
    });

    assert.equal(planningCalls, 1);
    assert.equal(result.claimCount, 12);
    assert.equal(result.retrievalLogicalRequests, retrievalCalls);
    assert.ok(retrievalCalls >= 48 && retrievalCalls <= 60);
    assert.equal(result.candidateCount, 1);
    assert.equal(result.queuedScrapeJobs, 0);
    assert.equal(bearingCalls, 1);
    assert.equal(result.targetedBearingProviderCalls, 1);
    assert.equal(result.results[0]?.bearing?.status, "completed");
    assert.equal(artifacts.has("query-planning/request.json"), true);
    assert.equal(artifacts.has("query-planning/raw_response.json"), true);
    assert.equal([...artifacts.keys()].some((key) => key.startsWith("retrieval/responses/")), true);

    const [canonicalClaims] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT claim_text FROM claims WHERE claim_type='task' ORDER BY claim_id",
    );
    assert.deepEqual(
      canonicalClaims.map((row) => row.claim_text),
      fixture.results.map((row: { substantiveAssertion: string }) => row.substantiveAssertion),
    );
    for (const [table, count] of [
      ["cfx_evidence_acquisition_bindings", 1],
      ["cfx_canonical_documents", 1],
      ["cfx_canonical_document_identities", 1],
      ["cfx_document_discovery_assignments", 1],
      ["scrape_jobs", 0],
      ["cfx_evidence_acquisition_attempts", 1],
      ["cfx_evidence_text_versions", 1],
      ["cfx_targeted_bearing_runs", 1],
      ["reference_claim_task_links", 1],
      ["reference_claim_links", 1],
      ["reference_claim_task_link_provenance", 1],
      ["cfx_evidence_terminal_outbox", 0],
    ] as const) {
      const countResult = await pool.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) count FROM ${table}`);
      const countRows: mysql.RowDataPacket[] = countResult[0];
      assert.equal(Number(countRows[0]!.count), count, table);
    }
    const [jobs] = await pool.query<mysql.RowDataPacket[]>("SELECT status,target_url FROM scrape_jobs");
    assert.deepEqual(jobs, []);
    const [links] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT stance,score,confidence,support_level
         FROM reference_claim_task_links`,
    );
    assert.equal(links[0]!.stance, "refute");
    assert.equal(Number(links[0]!.score), 90);
    assert.equal(Number(links[0]!.confidence), 0.8);
    assert.equal(Number(links[0]!.support_level), -0.72);
    const [documentLinks] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT stance,score,confidence,support_level,evidence_offsets
         FROM reference_claim_links`,
    );
    assert.equal(documentLinks[0]!.stance, "refute");
    assert.equal(Number(documentLinks[0]!.score), 100);
    assert.equal(Number(documentLinks[0]!.confidence), 0.88);
    assert.equal(Number(documentLinks[0]!.support_level), -0.88);
    assert.match(String(documentLinks[0]!.evidence_offsets), /cfx_document_bearing_v1/u);
    const [provenance] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT excerpt_locator_json FROM reference_claim_task_link_provenance",
    );
    const locator = typeof provenance[0]!.excerpt_locator_json === "string"
      ? JSON.parse(provenance[0]!.excerpt_locator_json)
      : provenance[0]!.excerpt_locator_json;
    assert.equal(locator.metricProvenance.confidence, "cfx_model_pair_confidence");
    assert.equal(
      locator.metricProvenance.supportLevel,
      "legacy_stance_multiplier_times_confidence_times_quality",
    );
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});
