import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { runCfxCaseAssertionExtractionStage } from "../../../src/services/cfxCaseAssertionExtractionStage.js";
import { freezeCfxArticleFromText } from "../../../src/claimfoundry/cfx/input/freezeArticle.js";
import type { Cf7StructuredModelResponse, Cf7StructuredProvider } from "../../../src/claimfoundry/shared/provider/index.js";

dotenv.config({ path: path.resolve(".env") });

const enabled = process.env.CFX_REAL_MYSQL_TEST === "1";

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, "../../../src/routes/content/content.scrape.routes.js");
const stagePath = path.join(here, "../../../src/services/cfxCaseAssertionExtractionStage.js");

// -----------------------------------------------------------------------
// Structural checks (no MySQL required) -- always run.
// -----------------------------------------------------------------------

test("CFX is selected by default: the route's extraction switch is the negation of the legacy flag", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(
    source,
    /const legacyCaseAssertionExtractionEnabled = process\.env\.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED === "true";/u,
  );
  assert.match(source, /if \(!legacyCaseAssertionExtractionEnabled\) \{/u);
});

test("the CFX extraction stage this test exercises never imports processTaskClaims or mapArgumentFunctions", async () => {
  const source = await readFile(stagePath, "utf8");
  assert.doesNotMatch(source, /processTaskClaims/u);
  assert.doesNotMatch(source, /mapArgumentFunctions/u);
});

// -----------------------------------------------------------------------
// Real-MySQL integration test -- same conventions as productionPipelineMysql.test.ts:
// gated behind CFX_REAL_MYSQL_TEST=1, an isolated throwaway database created
// and dropped per run, and the same rowQuery/transactionPool bridge (mysql2's
// promise API returns [rows, fields]; the platform's withTransaction/query
// contract expects rows directly).
// -----------------------------------------------------------------------

function rowQuery(connection: mysql.Connection | mysql.PoolConnection) {
  return async (sql: string, values: unknown[] = []) => {
    const [rows] = await connection.query(sql, values);
    return rows;
  };
}

type TransactionLog = Array<"begin" | "commit" | "rollback">;

function instrumentedTransactionPool(pool: mysql.Pool, log: TransactionLog) {
  return {
    async getConnection() {
      const connection = await pool.getConnection();
      return {
        async beginTransaction() { log.push("begin"); return connection.beginTransaction(); },
        async commit() { log.push("commit"); return connection.commit(); },
        async rollback() { log.push("rollback"); return connection.rollback(); },
        release: () => connection.release(),
        query: rowQuery(connection),
      };
    },
  };
}

/** Wraps the same transaction pool so one named claim_evaluation_targets INSERT fails, proving rollback. */
function failingOnEvaluationTargetPool(pool: mysql.Pool, log: TransactionLog, failingPropositionId: string) {
  return {
    async getConnection() {
      const connection = await pool.getConnection();
      const query = rowQuery(connection);
      return {
        async beginTransaction() { log.push("begin"); return connection.beginTransaction(); },
        async commit() { log.push("commit"); return connection.commit(); },
        async rollback() { log.push("rollback"); return connection.rollback(); },
        release: () => connection.release(),
        async query(sql: string, values: unknown[] = []) {
          if (/^\s*INSERT INTO claim_evaluation_targets/iu.test(sql) && values.includes(failingPropositionId)) {
            throw new Error(`simulated database failure persisting claim_evaluation_targets for ${failingPropositionId}`);
          }
          return query(sql, values);
        },
      };
    },
  };
}

async function createIsolatedSchema(query: ReturnType<typeof rowQuery>) {
  for (const ddl of [
    `CREATE TABLE content (
      content_id INT NOT NULL AUTO_INCREMENT,
      content_name VARCHAR(1000) NULL,
      media_source VARCHAR(255) NULL,
      url TEXT NULL,
      content_type ENUM('task','reference') NOT NULL DEFAULT 'task',
      topic VARCHAR(255) NULL,
      PRIMARY KEY(content_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE claims (
      claim_id INT NOT NULL AUTO_INCREMENT,
      claim_text TEXT NOT NULL,
      claim_type ENUM('task','reference','snippet') NOT NULL DEFAULT 'task',
      triage_status VARCHAR(80) NULL,
      triaged_by VARCHAR(80) NULL,
      triage_reasoning TEXT NULL,
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
      claim_order INT NULL,
      object_claim_text TEXT NULL,
      speaker_entity VARCHAR(1000) NULL,
      article_stance VARCHAR(80) NULL,
      selected_for_evaluation TINYINT(1) NOT NULL DEFAULT 0,
      evaluation_eligible TINYINT(1) NOT NULL DEFAULT 0,
      search_eligible TINYINT(1) NOT NULL DEFAULT 0,
      verdict_eligible TINYINT(1) NOT NULL DEFAULT 0,
      source_eligible TINYINT(1) NOT NULL DEFAULT 0,
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
      target_type VARCHAR(32) NOT NULL DEFAULT 'assertion',
      target_order INT NOT NULL DEFAULT 0,
      target_text TEXT NULL,
      subject_entity VARCHAR(1000) NULL,
      object_text TEXT NULL,
      source_excerpt LONGTEXT NULL,
      article_stance VARCHAR(80) NULL,
      score_transform VARCHAR(32) NULL,
      search_eligible TINYINT(1) NOT NULL DEFAULT 0,
      verdict_eligible TINYINT(1) NOT NULL DEFAULT 0,
      resolution_status VARCHAR(32) NULL,
      mapping_confidence DECIMAL(5,4) NULL,
      mapping_rationale TEXT NULL,
      source_claim_id VARCHAR(64) NULL,
      target_key VARCHAR(64) NULL,
      query_hints_json JSON NULL,
      PRIMARY KEY(evaluation_target_id),
      UNIQUE KEY uq_eval_target(content_id,claim_id,target_order),
      CONSTRAINT cet_content FOREIGN KEY(content_id) REFERENCES content(content_id),
      CONSTRAINT cet_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id)
    ) ENGINE=InnoDB`,
  ]) await query(ddl);
}

function syntheticArticle() {
  const paragraphs = Array.from(
    { length: 12 },
    (_, index) => `Paragraph ${index + 1} makes a distinct, independent statement about test subject ${index + 1}.`,
  );
  return { title: "Synthetic front-half integration article", text: paragraphs.join("\n\n") };
}

function responseEnvelope(callIndex: number): Omit<Cf7StructuredModelResponse, "output"> {
  return {
    rawResponse: { fixture: true, callIndex },
    model: "fixture-deterministic-provider",
    usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
    responseId: `fixture-response-${callIndex}`,
    requestId: `fixture-request-${callIndex}`,
  };
}

/** Odd calls are S1 (discovery), even calls are S2 (substantive review) -- safe to reuse across repeated extraction runs. */
function buildStubProvider(unitIds: string[]): Cf7StructuredProvider & { callCount: number } {
  let calls = 0;
  return {
    get callCount() { return calls; },
    async invokeStructured() {
      calls += 1;
      if (calls % 2 === 1) {
        return {
          output: {
            propositions: unitIds.map((_, index) => ({
              assertion: `Synthetic case assertion ${index + 1}.`,
              assertionSource: `Synthetic source ${index + 1}`,
              whyItMattersToArticleThesis: `Synthetic reason ${index + 1}`,
              groundingUnitIds: [unitIds[index % unitIds.length]!],
            })),
          },
          ...responseEnvelope(calls),
        };
      }
      return {
        output: {
          results: unitIds.map((_, index) => ({
            propositionId: `P${String(index + 1).padStart(2, "0")}`,
            substantiveAssertion: `Synthetic case assertion ${index + 1}.`,
            assertionSource: `Synthetic source ${index + 1}`,
            articleStance: (["adopts", "challenges", "reports"] as const)[index % 3],
          })),
        },
        ...responseEnvelope(calls),
      };
    },
  };
}

function malformedFailingProvider(succeedFirstCall: boolean, validUnitId: string): Cf7StructuredProvider {
  let calls = 0;
  return {
    async invokeStructured() {
      calls += 1;
      // S1's own schema requires exactly 12 distinct propositions
      // (cfxDiscoveryWithUnitsSchema.ts: propositions.length(12)); a
      // "successful S1" stub must satisfy that to actually reach S2.
      if (succeedFirstCall && calls === 1) {
        return {
          output: {
            propositions: Array.from({ length: 12 }, (_, index) => ({
              assertion: `Irrelevant well-formed proposition ${index + 1}.`,
              assertionSource: `x${index + 1}`,
              whyItMattersToArticleThesis: `x${index + 1}`,
              groundingUnitIds: [validUnitId],
            })),
          },
          ...responseEnvelope(calls),
        };
      }
      return { output: { malformed: true }, ...responseEnvelope(calls) };
    },
  };
}

test("front-half CFX extraction integration: real MySQL persistence, reload, and the stubbed evidence-pipeline boundary", {
  skip: !enabled,
  timeout: 60_000,
}, async (t) => {
  const database = `cfx_fresh_article_test_${process.pid}_${Date.now()}`;
  assert.match(database, /^cfx_fresh_article_test_[0-9_]+$/u);
  assert.notEqual(database, process.env.DB_DATABASE);
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
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
    const adminQuery = rowQuery(pool);
    await createIsolatedSchema(adminQuery);

    const article = syntheticArticle();
    const frozen = freezeCfxArticleFromText({ title: article.title, text: article.text });
    assert.ok(frozen.sourceUnits.length > 0);
    const unitIds = frozen.sourceUnits.map((unit) => unit.unitId);

    const [taskResult] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO content(content_name,url,content_type,topic) VALUES ('Front-half fixture','https://example.test/front-half','task','Fixture')",
    );
    const taskContentId = taskResult.insertId;

    await t.test("successful extraction: persistence, reload, ordinals, and stubbed evidence-pipeline boundary", async () => {
      const provider = buildStubProvider(unitIds);
      const log: TransactionLog = [];
      const extraction = await runCfxCaseAssertionExtractionStage({
        pool: instrumentedTransactionPool(pool!, log),
        taskContentId,
        title: article.title,
        text: article.text,
        sourceUrl: "https://example.test/front-half",
        provider,
      });

      // 3. Exactly 12 claim IDs reach the evidence-pipeline boundary.
      assert.equal(extraction.claimIds.length, 12);
      assert.equal(new Set(extraction.claimIds).size, 12);

      // 7. The transaction commits once on success.
      assert.deepEqual(log, ["begin", "commit"]);

      let evidencePipelineCalls = 0;
      let evidencePipelineClaimIds: number[] | null = null;
      function stubRunCfxProductionEvidencePipeline(input: { claimIds: number[] }) {
        evidencePipelineCalls += 1;
        evidencePipelineClaimIds = input.claimIds;
        return { status: "stubbed_before_query_planning" };
      }
      stubRunCfxProductionEvidencePipeline({ claimIds: extraction.claimIds });
      assert.equal(evidencePipelineCalls, 1);
      assert.deepEqual(evidencePipelineClaimIds, extraction.claimIds);

      // 4. Exactly 12 claims, content_claims, and claim_evaluation_targets rows persist.
      for (const [table, expected] of [["claims", 12], ["content_claims", 12], ["claim_evaluation_targets", 12]] as const) {
        const [[row]] = await pool!.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) count FROM ${table}`);
        assert.equal(Number(row!.count), expected, table);
      }

      // 5. claim_order and target_order are 0 through 11 and match.
      const [contentClaimRows] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT claim_id, claim_order FROM content_claims WHERE content_id=? ORDER BY claim_order",
        [taskContentId],
      );
      const [targetRows] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT claim_id, target_order FROM claim_evaluation_targets WHERE content_id=? ORDER BY target_order",
        [taskContentId],
      );
      assert.deepEqual(contentClaimRows.map((row) => row.claim_order), Array.from({ length: 12 }, (_, index) => index));
      assert.deepEqual(targetRows.map((row) => row.target_order), Array.from({ length: 12 }, (_, index) => index));
      assert.deepEqual(
        contentClaimRows.map((row) => row.claim_id),
        targetRows.map((row) => row.claim_id),
        "claim_order and target_order must refer to the same claims in the same order",
      );

      // 6. substantive assertion, assertion source, article stance, grounding excerpt,
      //    proposition identity, and full query_hints_json survive persistence and reload.
      const [reloaded] = await pool!.query<mysql.RowDataPacket[]>(
        `SELECT c.claim_text, cc.speaker_entity, cc.article_stance AS cc_stance, cc.claim_order,
                cet.article_stance AS cet_stance, cet.source_excerpt, cet.target_key, cet.query_hints_json
           FROM claims c
           JOIN content_claims cc ON cc.claim_id=c.claim_id AND cc.content_id=?
           JOIN claim_evaluation_targets cet ON cet.claim_id=c.claim_id AND cet.content_id=cc.content_id
          ORDER BY cc.claim_order`,
        [taskContentId],
      );
      assert.equal(reloaded.length, 12);
      reloaded.forEach((row, index) => {
        const n = index + 1;
        assert.equal(row.claim_text, `Synthetic case assertion ${n}.`);
        assert.equal(row.speaker_entity, `Synthetic source ${n}`);
        const expectedStance = (["adopts", "challenges", "reports"] as const)[index % 3];
        assert.equal(row.cc_stance, expectedStance);
        assert.equal(row.cet_stance, expectedStance);
        assert.equal(row.target_key, `CFX-P${String(n).padStart(2, "0")}`);
        assert.ok(row.source_excerpt && row.source_excerpt.length > 0, "grounding excerpt must survive persistence");
        const hints = typeof row.query_hints_json === "string" ? JSON.parse(row.query_hints_json) : row.query_hints_json;
        assert.equal(hints.propositionId, `P${String(n).padStart(2, "0")}`);
        assert.ok(Array.isArray(hints.groundingUnitIds) && hints.groundingUnitIds.length > 0);
        assert.ok(hints.literalIdentifiers, "literalIdentifiers must survive persistence");
        assert.ok(hints.lookupHints, "lookupHints must survive persistence");
        assert.ok(hints.deterministicQueries, "deterministicQueries must survive persistence");
      });
    });

    await t.test("re-running the same article is idempotent", async () => {
      const provider = buildStubProvider(unitIds);
      const log: TransactionLog = [];
      const second = await runCfxCaseAssertionExtractionStage({
        pool: instrumentedTransactionPool(pool!, log),
        taskContentId,
        title: article.title,
        text: article.text,
        sourceUrl: "https://example.test/front-half",
        provider,
      });
      assert.equal(second.claimIds.length, 12);
      for (const [table, expected] of [["claims", 12], ["content_claims", 12], ["claim_evaluation_targets", 12]] as const) {
        const [[row]] = await pool!.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) count FROM ${table}`);
        assert.equal(Number(row!.count), expected, `${table} must not duplicate on rerun`);
      }
    });

    await t.test("injected persistence failure rolls back all rows and never reaches the evidence-pipeline boundary", async () => {
      const [[before]] = await pool!.query<mysql.RowDataPacket[]>("SELECT COUNT(*) count FROM claims");
      const provider = buildStubProvider(unitIds);
      const log: TransactionLog = [];
      let evidencePipelineCalls = 0;

      await assert.rejects(
        (async () => {
          const extraction = await runCfxCaseAssertionExtractionStage({
            pool: failingOnEvaluationTargetPool(pool!, log, "P07"),
            taskContentId,
            title: article.title,
            text: article.text,
            provider,
          });
          evidencePipelineCalls += 1;
          void extraction;
        })(),
        /simulated database failure persisting claim_evaluation_targets for P07/u,
      );

      assert.equal(evidencePipelineCalls, 0, "the evidence-pipeline boundary must never be reached on persistence failure");
      assert.deepEqual(log, ["begin", "rollback"]);
      const [[afterClaims]] = await pool!.query<mysql.RowDataPacket[]>("SELECT COUNT(*) count FROM claims");
      const [[afterContentClaims]] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) count FROM content_claims WHERE content_id != ? OR content_id = ?", [taskContentId, taskContentId],
      );
      void afterContentClaims;
      // Rolled back to exactly the pre-existing row count from the two prior successful sub-tests (12, not 12+partial).
      assert.equal(Number(afterClaims.count), Number(before.count));
    });

    await t.test("S1 failure: no persistence, no evidence-pipeline call, no legacy fallback", async () => {
      const [[beforeClaims]] = await pool!.query<mysql.RowDataPacket[]>("SELECT COUNT(*) count FROM claims");
      const [[beforeTargets]] = await pool!.query<mysql.RowDataPacket[]>("SELECT COUNT(*) count FROM claim_evaluation_targets");
      let evidencePipelineCalls = 0;
      const log: TransactionLog = [];

      await assert.rejects(
        runCfxCaseAssertionExtractionStage({
          pool: instrumentedTransactionPool(pool!, log),
          taskContentId,
          title: article.title,
          text: article.text,
          provider: malformedFailingProvider(false, unitIds[0]!),
        }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal((error as { failedStage?: string }).failedStage, "S1");
          return true;
        },
      );

      const [[afterClaims]] = await pool!.query<mysql.RowDataPacket[]>("SELECT COUNT(*) count FROM claims");
      const [[afterTargets]] = await pool!.query<mysql.RowDataPacket[]>("SELECT COUNT(*) count FROM claim_evaluation_targets");
      assert.equal(Number(afterClaims.count), Number(beforeClaims.count), "no new claims on S1 failure");
      assert.equal(Number(afterTargets.count), Number(beforeTargets.count), "no new evaluation targets on S1 failure");
      assert.deepEqual(log, [], "withTransaction must never be entered when S1 fails");
      assert.equal(evidencePipelineCalls, 0);
    });

    await t.test("S2 failure: no persistence, no evidence-pipeline call, no legacy fallback", async () => {
      const [[beforeClaims]] = await pool!.query<mysql.RowDataPacket[]>("SELECT COUNT(*) count FROM claims");
      let evidencePipelineCalls = 0;
      const log: TransactionLog = [];

      await assert.rejects(
        runCfxCaseAssertionExtractionStage({
          pool: instrumentedTransactionPool(pool!, log),
          taskContentId,
          title: article.title,
          text: article.text,
          provider: malformedFailingProvider(true, unitIds[0]!),
        }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal((error as { failedStage?: string }).failedStage, "S2");
          return true;
        },
      );

      const [[afterClaims]] = await pool!.query<mysql.RowDataPacket[]>("SELECT COUNT(*) count FROM claims");
      assert.equal(Number(afterClaims.count), Number(beforeClaims.count), "no new claims on S2 failure");
      assert.deepEqual(log, [], "withTransaction must never be entered when S2 fails");
      assert.equal(evidencePipelineCalls, 0);
    });
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});
