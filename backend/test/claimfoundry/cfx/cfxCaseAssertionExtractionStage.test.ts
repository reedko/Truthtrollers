import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runCfxCaseAssertionExtractionStage } from "../../../src/services/cfxCaseAssertionExtractionStage.js";
import {
  createFakeCfxWorkspacePool,
  type FakeCfxWorkspacePool,
} from "./fakeCfxWorkspacePool.js";
import type { Cf7StructuredProvider } from "../../../src/claimfoundry/shared/provider/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");
const f03ArticlePath = path.join(
  repositoryRoot, "backend/test/claim-foundry/fixtures/CF1-F03/article.json",
);
const s1ResponseFixture = path.join(here, "fixtures/cf1F03KnownS1DiscoveryResponse.json");
const s2ResponseFixture = path.join(here, "fixtures/cf1F03KnownS2SubstantiveReviewResponse.json");

const CONTENT_ID = 18057;

async function loadArticleAndFixtures() {
  const article = JSON.parse(await readFile(f03ArticlePath, "utf8")) as { title: string; text: string };
  const s1Response = JSON.parse(await readFile(s1ResponseFixture, "utf8"));
  const s2Response = JSON.parse(await readFile(s2ResponseFixture, "utf8"));
  return { article, s1Response, s2Response };
}

function twoCallStubProvider(responses: unknown[]): Cf7StructuredProvider & { callCount: number } {
  let index = 0;
  return {
    get callCount() { return index; },
    async invokeStructured() {
      const output = responses[index];
      if (output === undefined) throw new Error(`unexpected extra provider call #${index + 1}`);
      index += 1;
      return {
        output,
        rawResponse: { output },
        model: "gpt-4o-mini",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: `resp-${index}`,
        requestId: `req-${index}`,
      };
    },
  };
}

function failingProviderAfter(successes: unknown[]): Cf7StructuredProvider {
  let index = 0;
  return {
    async invokeStructured() {
      if (index < successes.length) {
        const output = successes[index];
        index += 1;
        return {
          output,
          rawResponse: { output },
          model: "gpt-4o-mini",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
          responseId: `resp-${index}`,
          requestId: `req-${index}`,
        };
      }
      return {
        output: { malformed: true },
        rawResponse: { malformed: true },
        model: "gpt-4o-mini",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: "resp-fail",
        requestId: "req-fail",
      };
    },
  };
}

test("successful extraction persists exactly 12 claims inside one committed transaction", async () => {
  const { article, s1Response, s2Response } = await loadArticleAndFixtures();
  const pool: FakeCfxWorkspacePool = createFakeCfxWorkspacePool();
  const provider = twoCallStubProvider([s1Response, s2Response]);

  const result = await runCfxCaseAssertionExtractionStage({
    pool,
    taskContentId: CONTENT_ID,
    title: article.title,
    text: article.text,
    sourceUrl: "https://example.test/f03",
    provider,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.claimIds.length, 12);
  assert.equal(new Set(result.claimIds).size, 12);
  assert.equal(result.propositionIds.length, 12);
  assert.equal(provider.callCount, 2, "exactly one S1 call and one S2 call");

  assert.equal(pool.committed.claims.length, 12);
  assert.equal(pool.committed.content_claims.length, 12);
  assert.equal(pool.committed.claim_evaluation_targets.length, 12);
  assert.deepEqual(pool.transactionLog, ["begin", "commit"], "persistence went through withTransaction and committed");
});

test("S1 failure hard-fails: throws with failedStage 'S1', makes no persistence call, no legacy fallback", async () => {
  const { article } = await loadArticleAndFixtures();
  const pool: FakeCfxWorkspacePool = createFakeCfxWorkspacePool();
  const provider = failingProviderAfter([]); // first call (S1) itself returns malformed output

  await assert.rejects(
    runCfxCaseAssertionExtractionStage({
      pool,
      taskContentId: CONTENT_ID,
      title: article.title,
      text: article.text,
      provider,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { failedStage?: string }).failedStage, "S1");
      assert.match(error.message, /failed at stage S1/u);
      return true;
    },
  );

  assert.equal(pool.committed.claims.length, 0, "no claims persisted when S1 fails");
  assert.equal(pool.committed.content_claims.length, 0);
  assert.equal(pool.committed.claim_evaluation_targets.length, 0);
  assert.deepEqual(pool.transactionLog, [], "withTransaction is never entered when S1 fails");
});

test("S2 failure hard-fails: throws with failedStage 'S2', makes no persistence call, no legacy fallback", async () => {
  const { article, s1Response } = await loadArticleAndFixtures();
  const pool: FakeCfxWorkspacePool = createFakeCfxWorkspacePool();
  const provider = failingProviderAfter([s1Response]); // S1 succeeds, S2 returns malformed output

  await assert.rejects(
    runCfxCaseAssertionExtractionStage({
      pool,
      taskContentId: CONTENT_ID,
      title: article.title,
      text: article.text,
      provider,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { failedStage?: string }).failedStage, "S2");
      assert.match(error.message, /failed at stage S2/u);
      return true;
    },
  );

  assert.equal(pool.committed.claims.length, 0, "no claims persisted when S2 fails");
  assert.equal(pool.committed.content_claims.length, 0);
  assert.equal(pool.committed.claim_evaluation_targets.length, 0);
  assert.deepEqual(pool.transactionLog, [], "withTransaction is never entered when S2 fails");
});

test("the extraction stage makes no retrieval, acquisition, packet-selection, linking, or SourceCrest calls", async () => {
  const source = await readFile(
    fileURLToPath(new URL("../../../src/services/cfxCaseAssertionExtractionStage.js", import.meta.url)),
    "utf8",
  );
  const importLines = source.split("\n").filter((line) => /^\s*import\b/u.test(line)).join("\n");
  for (const pattern of [
    /retrieval\//u, /acquisition\//u, /packetSelectionBridge/u, /singleAssertionPacketExtraction/u,
    /evidenceBearing\//u, /SourceCrest/iu, /finalLinking\//u, /cfxProductionEvidencePipeline/u,
    /cfxEvidenceCoordinator/u, /processTaskClaims/u, /mapArgumentFunctions/u,
  ]) {
    assert.doesNotMatch(importLines, pattern, `extraction stage must not import anything matching ${pattern}`);
  }
});
