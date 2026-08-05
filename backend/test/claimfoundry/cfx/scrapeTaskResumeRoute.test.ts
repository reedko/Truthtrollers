import assert from "node:assert/strict";
import test from "node:test";
import createContentScrapeRoutes from "../../../src/routes/content/content.scrape.routes.js";

function response(): { statusCode: number; body: any; status(code: number): any; json(body: unknown): any; headersSent: boolean } {
  return {
    statusCode: 200, body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    headersSent: false,
  };
}

function neverCalled(name: string) {
  return async () => { throw new Error(`${name} must not be called in resume mode`); };
}

function resumeHandler(
  query: (sql: string, values?: unknown[]) => Promise<any>,
  overrides: {
    pool?: unknown;
    runCaseAssertionExtractionStage?: (...args: any[]) => Promise<any>;
    runProductionEvidencePipeline?: (...args: any[]) => Promise<any>;
    testOpenAiConnection?: () => Promise<any>;
  } = {},
) {
  const router = createContentScrapeRoutes({
    query,
    pool: overrides.pool ?? {},
    runCaseAssertionExtractionStage: overrides.runCaseAssertionExtractionStage ?? neverCalled("runCaseAssertionExtractionStage"),
    runProductionEvidencePipeline: overrides.runProductionEvidencePipeline ?? neverCalled("runProductionEvidencePipeline"),
    testOpenAiConnection: overrides.testOpenAiConnection ?? neverCalled("testOpenAiConnection"),
  } as any);
  const layer = (router as any).stack.find((entry: any) => entry.route?.path === "/api/scrape-task");
  return layer.route.stack.at(-1).handle;
}

// -- validation: fail-closed paths, nothing beyond the loader is reached ----

test("resume mode: mutually exclusive with url/raw_html/raw_text/force", async () => {
  const handler = resumeHandler(async () => { throw new Error("query must not be called"); });
  const res = response();
  await handler({ body: { cfx_resume_content_id: 18334, url: "https://example.test" }, user: null }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /cannot be combined/);
});

test("resume mode: cfx_resume_content_id must be a positive integer", async () => {
  const handler = resumeHandler(async () => { throw new Error("query must not be called"); });
  const res = response();
  await handler({ body: { cfx_resume_content_id: -3 }, user: null }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /positive integer/);
});

test("resume mode: fails closed with 404 when the content row does not exist", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const handler = resumeHandler(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT content_id FROM content WHERE content_id=?")) return [];
    throw new Error(`unexpected query: ${sql}`);
  });
  const res = response();
  await handler({ body: { cfx_resume_content_id: 999999 }, user: null }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(calls.length, 1, "must not query case assertions once the content row is confirmed missing");
});

test("resume mode: fails closed with 409 when the content row has zero persisted case assertions", async () => {
  const handler = resumeHandler(async (sql: string) => {
    if (sql.startsWith("SELECT content_id FROM content WHERE content_id=?")) return [{ content_id: 18334 }];
    if (sql.includes("FROM content_claims cc") && sql.includes("selected_for_evaluation=1")) return [];
    throw new Error(`unexpected query: ${sql}`);
  });
  const res = response();
  await handler({ body: { cfx_resume_content_id: 18334 }, user: null }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.caseAssertionCount, 0);
});

// -- behavioral: full resume orchestration through the injected dependency seam --

test("resume mode: skips connectivity check and extraction, loads content-scoped claimIds in order, calls the pipeline exactly once with preserved query/pool/taskContentId/userId and no extra arguments", async () => {
  let connectionChecks = 0;
  let extractionCalls = 0;
  let pipelineCalls = 0;
  let capturedArgs: any = null;
  const fakePool = { marker: "route-pool" };
  const fakeQuery = async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith("SELECT content_id FROM content WHERE content_id=?")) {
      return values[0] === 18334 ? [{ content_id: 18334 }] : [];
    }
    if (sql.includes("FROM content_claims cc") && sql.includes("selected_for_evaluation=1")) {
      assert.equal(values[0], 18334, "case-assertion lookup must be scoped by the target content_id, not claim_id");
      // Deliberately not sorted numerically -- proves claim_order is preserved
      // as returned, not re-sorted by the route.
      return [{ claim_id: 54892 }, { claim_id: 54456 }, { claim_id: 54893 }];
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const handler = resumeHandler(fakeQuery, {
    pool: fakePool,
    testOpenAiConnection: async () => { connectionChecks += 1; return { accessible: true }; },
    runCaseAssertionExtractionStage: async () => { extractionCalls += 1; throw new Error("must not be called"); },
    runProductionEvidencePipeline: async (args: any) => {
      pipelineCalls += 1;
      capturedArgs = args;
      return { status: "completed", results: [] };
    },
  });
  const res = response();
  await handler({ body: { cfx_resume_content_id: 18334 }, user: { user_id: 42 } }, res);

  assert.equal(connectionChecks, 0, "resume mode must not run the OpenAI connectivity check");
  assert.equal(extractionCalls, 0, "resume mode must not run S0/S1/S2");
  assert.equal(pipelineCalls, 1, "the evidence pipeline must be called exactly once");
  assert.deepEqual(capturedArgs.claimIds, [54892, 54456, 54893], "persisted claimIds must flow through in loaded order");
  assert.equal(capturedArgs.query, fakeQuery, "the route's own query function must be passed through unchanged");
  assert.equal(capturedArgs.pool, fakePool, "the route's own pool must be passed through unchanged");
  assert.equal(capturedArgs.taskContentId, 18334);
  assert.equal(capturedArgs.userId, 42);
  assert.deepEqual(
    Object.keys(capturedArgs).sort(),
    ["claimIds", "pool", "query", "taskContentId", "userId"],
    "no custom provider or literal assertion-relative flags may be passed",
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.contentId, 18334);
  assert.deepEqual(res.body.resume, { contentId: 18334, skippedStages: ["S0", "S1", "S2"], caseAssertionCount: 3 });
});

test("resume mode: userId defaults to null when the request has no authenticated user", async () => {
  let capturedArgs: any = null;
  const handler = resumeHandler(
    async (sql: string) => {
      if (sql.startsWith("SELECT content_id FROM content WHERE content_id=?")) return [{ content_id: 18334 }];
      if (sql.includes("FROM content_claims cc") && sql.includes("selected_for_evaluation=1")) return [{ claim_id: 1 }];
      throw new Error(`unexpected query: ${sql}`);
    },
    {
      runProductionEvidencePipeline: async (args: any) => { capturedArgs = args; return { status: "completed", results: [] }; },
    },
  );
  const res = response();
  await handler({ body: { cfx_resume_content_id: 18334 }, user: undefined }, res);
  assert.equal(capturedArgs.userId, null);
  assert.equal(res.statusCode, 200);
});
