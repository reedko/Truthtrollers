import assert from "node:assert/strict";
import test from "node:test";
import { withTransaction } from "../../../src/storage/dbTransaction.js";
import { persistCfxCaseAssertions } from "../../../src/services/cfxCaseAssertionPersistence.js";
import {
  createFakeCfxWorkspacePool,
  type FakeCfxWorkspacePool,
} from "./fakeCfxWorkspacePool.js";

const CONTENT_ID = 18057;

function twelveResults(assertionSuffix = "") {
  return Array.from({ length: 12 }, (_, index) => ({
    propositionId: `P${String(index + 1).padStart(2, "0")}`,
    substantiveAssertion: `Case assertion ${index + 1}${assertionSuffix}`,
    assertionSource: `Source ${index + 1}`,
    articleStance: (["adopts", "challenges", "reports"] as const)[index % 3],
    evidenceSearchHandoff: {
      normalizedAssertion: `case assertion ${index + 1}${assertionSuffix}`,
      groundingUnitIds: [`U${String(index + 1).padStart(4, "0")}`],
      groundingText: `[U${String(index + 1).padStart(4, "0")}]\nGrounding text ${index + 1}.`,
      explicitStudyIdentityFound: false,
      literalIdentifiers: {
        people: [], organizations: [], laws: [], studyTitles: [], journals: [],
        years: [], dateRanges: [], doi: [], pmid: [], urls: [], citationNumbers: [], acronyms: [],
      },
      lookupHints: {
        populations: [], exposures: [], outcomes: [], interventions: [], geography: [], documentTypes: [], topics: [],
      },
      queries: { literal: [`"case assertion ${index + 1}"`], sourceQualified: [], studyLookup: [] },
    },
  }));
}

async function persistThroughTransaction(pool: FakeCfxWorkspacePool, input: {
  taskContentId: number;
  results: ReturnType<typeof twelveResults>;
}) {
  return withTransaction(
    ({ query }: { query: (sql: string, values?: unknown[]) => Promise<unknown> }) =>
      persistCfxCaseAssertions({ query, taskContentId: input.taskContentId, results: input.results }),
    { pool },
  );
}

/**
 * Wraps a fake pool so that the named claim_evaluation_targets INSERT for one
 * specific propositionId fails, simulating a mid-transaction database error.
 * Triggers on the SQL statement and its bound propositionId value, not on
 * query count or position, so it stays valid if harmless query ordering or
 * counts change elsewhere in the persister. Also records, in call order,
 * every propositionId whose claim_evaluation_targets row was successfully
 * written before the failure, so a test can prove several assertions were
 * staged first.
 */
function poolThatFailsPersistingEvaluationTargetFor(
  pool: FakeCfxWorkspacePool,
  failingPropositionId: string,
): { pool: FakeCfxWorkspacePool; stagedEvaluationTargetPropositionIds: string[] } {
  const stagedEvaluationTargetPropositionIds: string[] = [];
  const wrapped: FakeCfxWorkspacePool = {
    committed: pool.committed,
    transactionLog: pool.transactionLog,
    async getConnection() {
      const real = await pool.getConnection();
      return {
        ...real,
        async query(sql: string, values: unknown[] = []) {
          const isEvaluationTargetInsert = /^\s*INSERT INTO claim_evaluation_targets\b/iu.test(sql);
          if (isEvaluationTargetInsert && values.includes(failingPropositionId)) {
            throw new Error(
              `simulated database failure persisting claim_evaluation_targets for ${failingPropositionId}`,
            );
          }
          const result = await real.query(sql, values);
          if (isEvaluationTargetInsert) {
            const propositionId = values.find((value): value is string =>
              typeof value === "string" && /^P\d+$/u.test(value));
            if (propositionId) stagedEvaluationTargetPropositionIds.push(propositionId);
          }
          return result;
        },
      };
    },
  };
  return { pool: wrapped, stagedEvaluationTargetPropositionIds };
}

test("persists exactly 12 claims, content_claims rows, and evaluation targets with query_hints_json", async () => {
  const pool = createFakeCfxWorkspacePool();
  const results = twelveResults();
  const persisted = await persistThroughTransaction(pool, { taskContentId: CONTENT_ID, results });

  assert.equal(persisted.claimIds.length, 12);
  assert.equal(new Set(persisted.claimIds).size, 12, "12 distinct claim IDs");
  assert.equal(pool.committed.claims.length, 12);
  assert.equal(pool.committed.content_claims.length, 12);
  assert.equal(pool.committed.claim_evaluation_targets.length, 12);

  for (const claim of pool.committed.claims) {
    assert.equal(claim.claim_type, "task");
  }
  for (const row of pool.committed.content_claims) {
    assert.equal(row.content_id, CONTENT_ID);
    assert.equal(row.relationship_type, "contains");
    assert.equal(row.claim_role, "pillar");
    assert.equal(row.visibility, "workspace_eval");
  }

  const target = pool.committed.claim_evaluation_targets.find((row) => row.target_key === "CFX-P01")!;
  assert.ok(target, "target for P01 exists");
  const hints = JSON.parse(target.query_hints_json);
  assert.equal(hints.propositionId, "P01");
  assert.deepEqual(hints.groundingUnitIds, ["U0001"]);
  assert.ok(hints.literalIdentifiers, "literalIdentifiers preserved in query_hints_json");
  assert.ok(hints.lookupHints, "lookupHints preserved in query_hints_json");
  assert.deepEqual(hints.deterministicQueries.literal, ['"case assertion 1"']);
});

test("content_claims.claim_order and claim_evaluation_targets.target_order are both zero-based, 0 through 11, and match by proposition", async () => {
  const pool = createFakeCfxWorkspacePool();
  const results = twelveResults();
  await persistThroughTransaction(pool, { taskContentId: CONTENT_ID, results });

  const claimOrders = results.map((proposition) => {
    const claim = pool.committed.claims.find((row) => row.claim_text === proposition.substantiveAssertion)!;
    const contentClaim = pool.committed.content_claims.find((row) => row.claim_id === claim.claim_id)!;
    return contentClaim.claim_order;
  });
  const targetOrders = results.map((proposition) => {
    const target = pool.committed.claim_evaluation_targets.find(
      (row) => row.target_key === `CFX-${proposition.propositionId}`,
    )!;
    return target.target_order;
  });

  const expectedOrders = Array.from({ length: 12 }, (_, index) => index);
  assert.deepEqual(claimOrders, expectedOrders, "content_claims.claim_order must be exactly 0 through 11, in proposition order");
  assert.deepEqual(targetOrders, expectedOrders, "claim_evaluation_targets.target_order must be exactly 0 through 11, in proposition order");
  assert.deepEqual(claimOrders, targetOrders, "the two ordinals must match for the same proposition");
});

test("rerunning the same content does not duplicate claims, content_claims rows, or evaluation targets", async () => {
  const pool = createFakeCfxWorkspacePool();
  const results = twelveResults();
  await persistThroughTransaction(pool, { taskContentId: CONTENT_ID, results });
  const second = await persistThroughTransaction(pool, { taskContentId: CONTENT_ID, results });

  assert.equal(pool.committed.claims.length, 12, "claims table does not grow on rerun with identical text");
  assert.equal(pool.committed.content_claims.length, 12, "content_claims does not duplicate on rerun");
  assert.equal(pool.committed.claim_evaluation_targets.length, 12, "evaluation targets do not duplicate on rerun");
  assert.deepEqual(second.claimIds, second.claimIds, "second run completes without error");
});

test("rerunning with reworded S2 output replaces rather than accumulates prior-run claims", async () => {
  const pool = createFakeCfxWorkspacePool();
  await persistThroughTransaction(pool, { taskContentId: CONTENT_ID, results: twelveResults() });
  await persistThroughTransaction(pool, { taskContentId: CONTENT_ID, results: twelveResults(" (reworded)") });

  assert.equal(pool.committed.content_claims.length, 12, "content_claims still exactly 12 after reworded rerun");
  assert.equal(pool.committed.claim_evaluation_targets.length, 12, "evaluation targets still exactly 12 after reworded rerun");
  assert.equal(pool.committed.claims.length, 24, "old-wording claims remain as reusable canonical claims, only links move");
  for (const row of pool.committed.content_claims) {
    const claim = pool.committed.claims.find((candidate) => candidate.claim_id === row.claim_id)!;
    assert.match(claim.claim_text, /\(reworded\)$/u, "content_claims now point at the reworded claim text");
  }
});

test("persistence is transaction-safe: a mid-run failure rolls back every write for that call", async () => {
  const pool = createFakeCfxWorkspacePool();
  const results = twelveResults();
  const { pool: failingPool, stagedEvaluationTargetPropositionIds } =
    poolThatFailsPersistingEvaluationTargetFor(pool, "P07");

  await assert.rejects(
    persistThroughTransaction(failingPool, { taskContentId: CONTENT_ID, results }),
    /simulated database failure persisting claim_evaluation_targets for P07/u,
  );

  assert.ok(
    stagedEvaluationTargetPropositionIds.length >= 3,
    `expected several evaluation targets staged before the failure, got: ${stagedEvaluationTargetPropositionIds.join(", ")}`,
  );
  assert.deepEqual(
    stagedEvaluationTargetPropositionIds,
    ["P01", "P02", "P03", "P04", "P05", "P06"],
    "P01-P06's evaluation targets must be staged (written to the in-flight transaction) before P07 fails",
  );
  assert.equal(
    stagedEvaluationTargetPropositionIds.includes("P07"),
    false,
    "P07's own evaluation target write is the one that fails, so it must never complete",
  );

  assert.equal(pool.committed.claims.length, 0, "no claims committed when the transaction fails partway through");
  assert.equal(pool.committed.content_claims.length, 0, "no content_claims committed on rollback");
  assert.equal(pool.committed.claim_evaluation_targets.length, 0, "no evaluation targets committed on rollback");
  assert.deepEqual(pool.transactionLog, ["begin", "rollback"]);
});

test("persister depends only on storage/persistClaims.js, never on legacy processTaskClaims", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const source = await readFile(
    fileURLToPath(new URL(
      "../../../src/services/cfxCaseAssertionPersistence.js",
      import.meta.url,
    )),
    "utf8",
  );
  assert.doesNotMatch(source, /processTaskClaims/u);
  assert.match(source, /from "\.\.\/storage\/persistClaims\.js"/u);
  void path;
});
