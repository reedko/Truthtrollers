import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { runCfxCaseAssertionExtractionStage } from "../../../src/services/cfxCaseAssertionExtractionStage.js";
import { freezeCfxArticleFromText } from "../../../src/claimfoundry/cfx/input/freezeArticle.js";
import {
  loadProductionCfxEvidenceInputs,
  CfxQueryInputError,
} from "../../../src/services/cfxProductionEvidencePipeline.js";
import { loadVerifiedCfxEvidenceInputs } from "../../../src/claimfoundry/cfx/retrieval/loadEvidenceInputs.js";
import {
  loadCfxQueryPlanningPrompt,
  buildCfxQueryPlanningRequest,
} from "../../../src/claimfoundry/cfx/retrieval/queryPlanning.js";
import type { Cf7StructuredModelResponse, Cf7StructuredProvider } from "../../../src/claimfoundry/shared/provider/index.js";
import type { CfxEvidenceInput } from "../../../src/claimfoundry/cfx/retrieval/types.js";

dotenv.config({ path: path.resolve(".env") });

const enabled = process.env.CFX_REAL_MYSQL_TEST === "1";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");
const goldenHandoffRunDirectory = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/" +
    "cfx-s2-evidence-search-cfx-substantive-review-cf1-f03-20260730234738-20260731051936",
);

// -----------------------------------------------------------------------
// Same real-MySQL conventions as freshArticleExtractionMysql.test.ts /
// productionPipelineMysql.test.ts: CFX_REAL_MYSQL_TEST=1 gate, isolated
// throwaway database created and dropped per run, and the rowQuery bridge
// reconciling mysql2's [rows, fields] tuple with the platform's direct-rows
// query contract.
// -----------------------------------------------------------------------

function rowQuery(connection: mysql.Connection | mysql.PoolConnection | mysql.Pool) {
  return async (sql: string, values: unknown[] = []) => {
    const [rows] = await connection.query(sql, values);
    return rows as Record<string, unknown>[];
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
      population_scope VARCHAR(1000) NULL,
      query_hints_json JSON NULL,
      PRIMARY KEY(evaluation_target_id),
      UNIQUE KEY uq_eval_target(content_id,claim_id,target_order),
      CONSTRAINT cet_content FOREIGN KEY(content_id) REFERENCES content(content_id),
      CONSTRAINT cet_claim FOREIGN KEY(claim_id) REFERENCES claims(claim_id)
    ) ENGINE=InnoDB`,
  ]) await query(ddl);
}

/**
 * The frozen fixture's groundingText is `[U####]\n<fragment>` blocks joined
 * by "\n\n", one block per grounding unit. Splitting it back apart recovers
 * the underlying article fragments this test replays through a synthetic
 * article -- without needing the original CF1-F03 raw article text, which
 * this artifact directory does not retain.
 */
function extractGroundingFragments(groundingText: string): string[] {
  return groundingText.split("\n\n").map((block) => {
    const match = /^\[U[0-9]+\]\n([\s\S]*)$/u.exec(block);
    if (!match) {
      throw new Error(`Could not parse a grounding block out of groundingText: ${block.slice(0, 60)}`);
    }
    return match[1]!;
  });
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

/**
 * Replays the golden CF1-F03 fixture's own substantiveAssertion/assertionSource/
 * articleStance as a "mocked successful S1/S2" pair: call 1 is S1 discovery
 * (assertion/assertionSource/groundingUnitIds), call 2 is S2 substantive
 * review (propositionId/substantiveAssertion/assertionSource/articleStance).
 * S2's real handoff-attachment logic (attachCfxEvidenceSearchHandoffs) still
 * runs for real afterward -- this provider supplies no evidenceSearchHandoff
 * itself, matching how a real model response is shaped.
 */
function buildFixtureReplayProvider(input: {
  propositionOrder: string[];
  fixtureByProposition: Map<string, CfxEvidenceInput>;
  groundingUnitIdsByProposition: Map<string, string[]>;
}): Cf7StructuredProvider & { callCount: number } {
  let calls = 0;
  return {
    get callCount() { return calls; },
    async invokeStructured() {
      calls += 1;
      if (calls === 1) {
        return {
          output: {
            propositions: input.propositionOrder.map((propositionId) => {
              const fixture = input.fixtureByProposition.get(propositionId)!;
              return {
                assertion: fixture.substantiveAssertion,
                assertionSource: fixture.assertionSource,
                whyItMattersToArticleThesis: `Grounds ${propositionId} in the replayed CF1-F03 fixture text.`,
                groundingUnitIds: input.groundingUnitIdsByProposition.get(propositionId)!,
              };
            }),
          },
          ...responseEnvelope(calls),
        };
      }
      return {
        output: {
          results: input.propositionOrder.map((propositionId) => {
            const fixture = input.fixtureByProposition.get(propositionId)!;
            return {
              propositionId,
              substantiveAssertion: fixture.substantiveAssertion,
              assertionSource: fixture.assertionSource,
              articleStance: fixture.articleStance,
            };
          }),
        },
        ...responseEnvelope(calls),
      };
    },
  };
}

test("real-MySQL query-input integration: fresh article -> CFX extraction -> persistence -> reload -> golden-fixture equivalence -> query-planning request (no provider, no retrieval)", {
  skip: !enabled,
  timeout: 60_000,
}, async (t) => {
  const database = `cfx_query_input_test_${process.pid}_${Date.now()}`;
  assert.match(database, /^cfx_query_input_test_[0-9_]+$/u);
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
    await createIsolatedSchema(rowQuery(pool));

    // ---- Build a synthetic article whose fragments ARE the golden fixture's
    // own grounding-unit text (recovered from its persisted groundingText),
    // in propositionId order. Feeding this through the real S0 freezer and
    // the real S2 handoff-builder reproduces the fixture's literalIdentifiers/
    // lookupHints/deterministicQueries exactly, since those are pure
    // functions of (substantiveAssertion, assertionSource, grounding unit
    // text) with no dependency on unit-ID labels or citationMetadata (which
    // freezeCfxArticleFromText never populates).
    const verifiedFixture = await loadVerifiedCfxEvidenceInputs(goldenHandoffRunDirectory);
    assert.equal(verifiedFixture.inputs.length, 12);
    const orderedFixtureInputs = [...verifiedFixture.inputs].sort(
      (left, right) => left.propositionId.localeCompare(right.propositionId),
    );
    const fragmentsByProposition = orderedFixtureInputs.map((input) => extractGroundingFragments(input.groundingText));
    fragmentsByProposition.forEach((fragments, index) => {
      assert.equal(
        fragments.length,
        orderedFixtureInputs[index]!.groundingUnitIds.length,
        `recovered fragment count must match groundingUnitIds count for ${orderedFixtureInputs[index]!.propositionId}`,
      );
    });
    const allFragments = fragmentsByProposition.flat();
    const articleTitle = "CF1-F03 fixture replay (query-input integration)";
    const articleText = allFragments.join("\n\n");
    const article = freezeCfxArticleFromText({ title: articleTitle, text: articleText });
    assert.equal(
      article.sourceUnits.length,
      allFragments.length,
      "the synthetic article must segment into exactly one source unit per recovered fragment",
    );

    const groundingUnitIdsByProposition = new Map<string, string[]>();
    let cursor = 0;
    fragmentsByProposition.forEach((fragments, index) => {
      const unitIds = article.sourceUnits.slice(cursor, cursor + fragments.length).map((unit) => unit.unitId);
      groundingUnitIdsByProposition.set(orderedFixtureInputs[index]!.propositionId, unitIds);
      cursor += fragments.length;
    });

    const propositionOrder = orderedFixtureInputs.map((input) => input.propositionId);
    const fixtureByProposition = new Map(orderedFixtureInputs.map((input) => [input.propositionId, input]));

    const [taskResult] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO content(content_name,url,content_type,topic) VALUES ('Query-input integration fixture','https://example.test/query-input','task','Fixture')",
    );
    const taskContentId = taskResult.insertId;

    let mainClaimIds: number[] = [];
    let mainReloaded: CfxEvidenceInput[] = [];

    await t.test("fresh-article extraction -> real MySQL persistence -> reload -> golden-fixture equivalence -> query-planning request", async () => {
      const provider = buildFixtureReplayProvider({ propositionOrder, fixtureByProposition, groundingUnitIdsByProposition });
      const log: TransactionLog = [];
      const extraction = await runCfxCaseAssertionExtractionStage({
        pool: instrumentedTransactionPool(pool!, log),
        taskContentId,
        title: articleTitle,
        text: articleText,
        sourceUrl: "https://example.test/query-input",
        provider,
      });

      // 13: no model provider beyond the two mocked S1/S2 calls this stage itself makes.
      assert.equal(provider.callCount, 2, "exactly one S1 discovery call and one S2 substantive-review call");
      assert.equal(extraction.claimIds.length, 12);
      assert.equal(new Set(extraction.claimIds).size, 12);
      assert.deepEqual(log, ["begin", "commit"]);
      mainClaimIds = extraction.claimIds;

      // 1: exactly 12 case assertions persist and reload.
      mainReloaded = await loadProductionCfxEvidenceInputs({
        query: rowQuery(pool!),
        taskContentId,
        claimIds: mainClaimIds,
      }) as CfxEvidenceInput[];
      assert.equal(mainReloaded.length, 12, "exactly 12 case assertions persist and reload");

      const reloadedByProposition = new Map(mainReloaded.map((input) => [input.propositionId, input]));
      for (const fixtureInput of orderedFixtureInputs) {
        const propositionId = fixtureInput.propositionId;
        const actual = reloadedByProposition.get(propositionId);
        assert.ok(actual, `reloaded input for ${propositionId} must exist`);

        // 2, 6: propositionId is the persisted CFX identity, not a synthetic P<claimId>.
        assert.equal(actual!.propositionId, propositionId);
        assert.equal(actual!.substantiveAssertion, fixtureInput.substantiveAssertion);
        assert.equal(actual!.assertionSource, fixtureInput.assertionSource);
        assert.equal(actual!.articleStance, fixtureInput.articleStance);

        // 4: DB-backed loading is semantically identical to the proven offline
        // loader for the same underlying handoff content (substantiveAssertion/
        // assertionSource/groundingUnitText), computed fresh by the real S2
        // handoff-builder from this test's synthetic article.
        assert.deepEqual(actual!.literalIdentifiers, fixtureInput.literalIdentifiers, `literalIdentifiers must match the golden fixture for ${propositionId}`);
        assert.deepEqual(actual!.lookupHints, fixtureInput.lookupHints, `lookupHints must match the golden fixture for ${propositionId}`);
        assert.deepEqual(actual!.deterministicQueries, fixtureInput.deterministicQueries, `deterministicQueries must match the golden fixture for ${propositionId}`);

        // 3, 7: multiple real grounding unit IDs -- independently derived from
        // this test's own frozen article, never from claimId -- survive the
        // MySQL JSON round trip unchanged and in order.
        const expectedUnitIds = groundingUnitIdsByProposition.get(propositionId)!;
        assert.ok(expectedUnitIds.length >= 2, "sanity: this fixture's propositions are multi-unit");
        assert.deepEqual(actual!.groundingUnitIds, expectedUnitIds, `groundingUnitIds must survive the DB round trip unchanged and in order for ${propositionId}`);

        // groundingText's underlying content (independent of the synthetic
        // unit-ID labels this test's own reconstruction assigns) matches the
        // golden fixture's.
        assert.deepEqual(
          extractGroundingFragments(actual!.groundingText),
          extractGroundingFragments(fixtureInput.groundingText),
          `groundingText content must match the golden fixture for ${propositionId}`,
        );
      }

      // 8: the production loader never calls buildCfxEvidenceSearchHandoff.
      const { readFile } = await import("node:fs/promises");
      const loaderSource = await readFile(
        path.join(repositoryRoot, "backend/src/services/cfxProductionEvidencePipeline.js"),
        "utf8",
      );
      assert.doesNotMatch(loaderSource, /buildCfxEvidenceSearchHandoff/u);

      // 5: the query-planning request (built, never invoked against a
      // provider) carries the rich grounding text, identifiers, and hints.
      const prompt = await loadCfxQueryPlanningPrompt();
      const request = buildCfxQueryPlanningRequest({ inputs: mainReloaded, prompt });
      const packetsMatch = /PROPOSITION_PACKETS:\n([\s\S]+)$/u.exec(request.user);
      assert.ok(packetsMatch, "query-planning request must embed the proposition packets");
      const packets = JSON.parse(packetsMatch![1]!) as Array<Record<string, unknown>>;
      assert.equal(packets.length, 12, "the query-planning request must carry all 12 propositions");
      for (const packet of packets) {
        assert.ok(typeof packet.propositionId === "string" && reloadedByProposition.has(packet.propositionId as string));
        assert.ok(typeof packet.groundingText === "string" && (packet.groundingText as string).length > 0);
        assert.ok(packet.literalIdentifiers, "packet must carry literalIdentifiers");
        assert.ok(packet.lookupHints, "packet must carry lookupHints");
      }
    });

    await t.test("a missing query_hints_json for one of the 12 claims fails the whole reload batch before query-planning request construction", async () => {
      const targetClaimId = mainClaimIds[6]!;
      const query = rowQuery(pool!);
      const [[before]] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT query_hints_json FROM claim_evaluation_targets WHERE claim_id=? AND content_id=?",
        [targetClaimId, taskContentId],
      );
      try {
        await query(
          "UPDATE claim_evaluation_targets SET query_hints_json=NULL WHERE claim_id=? AND content_id=?",
          [targetClaimId, taskContentId],
        );
        let requestBuilt = false;
        await assert.rejects(
          (async () => {
            const reloaded = await loadProductionCfxEvidenceInputs({ query, taskContentId, claimIds: mainClaimIds });
            const prompt = await loadCfxQueryPlanningPrompt();
            buildCfxQueryPlanningRequest({ inputs: reloaded as CfxEvidenceInput[], prompt });
            requestBuilt = true;
          })(),
          (error: unknown) => {
            assert.ok(error instanceof CfxQueryInputError);
            assert.equal(error.code, "MISSING_QUERY_HINTS");
            assert.equal(error.claimId, targetClaimId);
            assert.equal(error.contentId, taskContentId);
            return true;
          },
        );
        // 12: one bad claim among the 12 prevents the entire query-planning batch from being built.
        assert.equal(requestBuilt, false, "the query-planning request must never be built when any one of the 12 claims fails to reload");
      } finally {
        await query(
          "UPDATE claim_evaluation_targets SET query_hints_json=? WHERE claim_id=? AND content_id=?",
          [JSON.stringify(before!.query_hints_json), targetClaimId, taskContentId],
        );
      }
    });

    await t.test("an incomplete rich query_hints_json for one of the 12 claims fails the whole batch and names the missing fields", async () => {
      const targetClaimId = mainClaimIds[2]!;
      const query = rowQuery(pool!);
      const [[before]] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT query_hints_json FROM claim_evaluation_targets WHERE claim_id=? AND content_id=?",
        [targetClaimId, taskContentId],
      );
      const beforeHints = before!.query_hints_json as Record<string, unknown>;
      const incomplete = {
        propositionId: beforeHints.propositionId,
        groundingUnitIds: beforeHints.groundingUnitIds,
      };
      try {
        await query(
          "UPDATE claim_evaluation_targets SET query_hints_json=? WHERE claim_id=? AND content_id=?",
          [JSON.stringify(incomplete), targetClaimId, taskContentId],
        );
        let requestBuilt = false;
        await assert.rejects(
          (async () => {
            const reloaded = await loadProductionCfxEvidenceInputs({ query, taskContentId, claimIds: mainClaimIds });
            const prompt = await loadCfxQueryPlanningPrompt();
            buildCfxQueryPlanningRequest({ inputs: reloaded as CfxEvidenceInput[], prompt });
            requestBuilt = true;
          })(),
          (error: unknown) => {
            assert.ok(error instanceof CfxQueryInputError);
            assert.equal(error.code, "INVALID_QUERY_HINTS_SHAPE");
            assert.ok(error.missingFields!.includes("literalIdentifiers"));
            assert.ok(error.missingFields!.includes("lookupHints"));
            assert.ok(error.missingFields!.includes("deterministicQueries"));
            return true;
          },
        );
        assert.equal(requestBuilt, false);
      } finally {
        await query(
          "UPDATE claim_evaluation_targets SET query_hints_json=? WHERE claim_id=? AND content_id=?",
          [JSON.stringify(beforeHints), targetClaimId, taskContentId],
        );
      }
    });

    await t.test("malformed query_hints_json (simulated at the query boundary -- a real MySQL JSON column cannot itself store invalid JSON) fails the whole batch before request construction", async () => {
      const targetClaimId = mainClaimIds[9]!;
      const realQuery = rowQuery(pool!);
      const query = async (sql: string, values: unknown[] = []) => {
        const rows = await realQuery(sql, values);
        if (!/query_hints_json/u.test(sql)) return rows;
        return rows.map((row) => (
          Number(row.claim_id) === targetClaimId
            ? { ...row, query_hints_json: "{not valid json" }
            : row
        ));
      };
      let requestBuilt = false;
      await assert.rejects(
        (async () => {
          const reloaded = await loadProductionCfxEvidenceInputs({ query, taskContentId, claimIds: mainClaimIds });
          const prompt = await loadCfxQueryPlanningPrompt();
          buildCfxQueryPlanningRequest({ inputs: reloaded as CfxEvidenceInput[], prompt });
          requestBuilt = true;
        })(),
        (error: unknown) => {
          assert.ok(error instanceof CfxQueryInputError);
          assert.equal(error.code, "MALFORMED_QUERY_HINTS_JSON");
          assert.equal(error.claimId, targetClaimId);
          return true;
        },
      );
      assert.equal(requestBuilt, false);
    });
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});
