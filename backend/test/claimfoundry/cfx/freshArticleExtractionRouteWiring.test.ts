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

function scrapeTaskHandler(
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
    ...(overrides.runCaseAssertionExtractionStage ? { runCaseAssertionExtractionStage: overrides.runCaseAssertionExtractionStage } : {}),
    ...(overrides.runProductionEvidencePipeline ? { runProductionEvidencePipeline: overrides.runProductionEvidencePipeline } : {}),
    ...(overrides.testOpenAiConnection ? { testOpenAiConnection: overrides.testOpenAiConnection } : {}),
  } as any);
  const layer = (router as any).stack.find((entry: any) => entry.route?.path === "/api/scrape-task");
  return layer.route.stack.at(-1).handle;
}

// A minimal MODE 1 (raw_text) request body that reaches the case-assertion
// extraction call with the fewest possible DB round trips: no thumbnail (skips
// image download), no authors/content refs, no fallback publisher (so
// processPublishingIdentity's persistPublishers/persistAuthors both no-op
// without any query), non-PDF/non-Facebook url.
function freshRequestBody(url: string) {
  return {
    url,
    raw_text: "This is a short test article body used only to drive route wiring.",
    content_name: "Route wiring test article",
    media_source: "Test",
  };
}

// Minimal fake query covering exactly the SQL the MODE 1 path issues before
// reaching case-assertion extraction: the URL-dedup check, and
// createContentInternal's InsertContentAndTopics call + its content_id lookup.
function freshIngestionQuery(url: string, contentId: number) {
  return async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith("SELECT content_id, content_name FROM content WHERE url = ?")) return [];
    if (sql.trim().startsWith("CALL InsertContentAndTopics")) return { affectedRows: 1 };
    if (sql.startsWith("SELECT content_id, thumbnail FROM content WHERE url = ?")) {
      assert.equal(values[0], url);
      return [{ content_id: contentId, thumbnail: null }];
    }
    throw new Error(`unexpected query: ${sql}`);
  };
}

// -- fresh path: full behavioral orchestration proof -----------------------

test("fresh path: connectivity check, extraction, and pipeline are each called exactly once, in order; extraction claimIds flow into the pipeline; route query/pool/taskContentId/userId are preserved; resume loader is not used", async () => {
  const url = "https://example.test/fresh-article-wiring";
  const contentId = 90001;
  const fakePool = { marker: "route-pool" };
  const fakeQuery = freshIngestionQuery(url, contentId);

  let connectionChecks = 0;
  let extractionCalls = 0;
  let pipelineCalls = 0;
  let extractionArgs: any = null;
  let pipelineArgs: any = null;
  const callOrder: string[] = [];

  const handler = scrapeTaskHandler(fakeQuery, {
    pool: fakePool,
    testOpenAiConnection: async () => { connectionChecks += 1; callOrder.push("connectivity"); return { accessible: true }; },
    runCaseAssertionExtractionStage: async (args: any) => {
      extractionCalls += 1;
      extractionArgs = args;
      callOrder.push("extraction");
      return { claimIds: [70001, 70002, 70003], propositionIds: ["P01", "P02", "P03"], status: "completed" };
    },
    runProductionEvidencePipeline: async (args: any) => {
      pipelineCalls += 1;
      pipelineArgs = args;
      callOrder.push("pipeline");
      return { status: "completed", results: [] };
    },
  });

  const res = response();
  await handler({ body: freshRequestBody(url), user: { user_id: 7 } }, res);

  assert.equal(connectionChecks, 1, "the OpenAI connectivity check must run exactly once");
  assert.equal(extractionCalls, 1, "case-assertion extraction must run exactly once");
  assert.equal(pipelineCalls, 1, "the evidence pipeline must run exactly once");
  assert.deepEqual(callOrder, ["connectivity", "extraction", "pipeline"], "extraction must be called before the pipeline");

  assert.equal(extractionArgs.taskContentId, contentId);
  assert.equal(extractionArgs.pool, fakePool);

  assert.deepEqual(pipelineArgs.claimIds, [70001, 70002, 70003], "the pipeline must receive exactly the claimIds extraction returned");
  assert.equal(pipelineArgs.query, fakeQuery, "the route's own query function must be passed through unchanged");
  assert.equal(pipelineArgs.pool, fakePool, "the route's own pool must be passed through unchanged");
  assert.equal(pipelineArgs.taskContentId, contentId);
  assert.equal(pipelineArgs.userId, 7);
  assert.deepEqual(
    Object.keys(pipelineArgs).sort(),
    ["claimIds", "pool", "query", "taskContentId", "userId"],
    "no custom provider or literal assertion-relative flags may be passed",
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.contentId, contentId);
  assert.equal(res.body.resume, undefined, "the resume response field must not appear on a fresh-ingestion response");
});

test("fresh path never touches the resume loader (no cfx_resume_content_id in the request)", async () => {
  const url = "https://example.test/fresh-article-no-resume";
  const contentId = 90002;
  const queryCalls: string[] = [];
  const fakeQuery = async (sql: string, values: unknown[] = []) => {
    queryCalls.push(sql);
    return freshIngestionQuery(url, contentId)(sql, values);
  };
  let extractionCalls = 0;
  const handler = scrapeTaskHandler(fakeQuery, {
    testOpenAiConnection: async () => ({ accessible: true }),
    runCaseAssertionExtractionStage: async () => { extractionCalls += 1; return { claimIds: [1], propositionIds: ["P01"], status: "completed" }; },
    runProductionEvidencePipeline: async () => ({ status: "completed", results: [] }),
  });
  const res = response();
  await handler({ body: freshRequestBody(url), user: null }, res);
  assert.equal(extractionCalls, 1);
  // None of the resume-specific queries (content-existence-by-id,
  // selected_for_evaluation loader) were ever issued.
  assert.ok(!queryCalls.some((sql) => sql.startsWith("SELECT content_id FROM content WHERE content_id=?")));
  assert.ok(!queryCalls.some((sql) => sql.includes("selected_for_evaluation=1")));
  assert.equal(res.statusCode, 200);
});

// -- extraction mode switch: behavioral, via the injected CFX seam ---------

test("CFX is the default extraction path: with the legacy flag unset, the injected extraction stage is called", async () => {
  const saved = process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
  delete process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
  try {
    const url = "https://example.test/fresh-article-cfx-default";
    const contentId = 90003;
    let extractionCalls = 0;
    const handler = scrapeTaskHandler(freshIngestionQuery(url, contentId), {
      testOpenAiConnection: async () => ({ accessible: true }),
      runCaseAssertionExtractionStage: async () => { extractionCalls += 1; return { claimIds: [1], propositionIds: ["P01"], status: "completed" }; },
      runProductionEvidencePipeline: async () => ({ status: "completed", results: [] }),
    });
    const res = response();
    await handler({ body: freshRequestBody(url), user: null }, res);
    assert.equal(extractionCalls, 1);
    assert.equal(res.statusCode, 200);
  } finally {
    if (saved === undefined) delete process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
    else process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED = saved;
  }
});

// The legacy extractor (processTaskClaims/mapArgumentFunctions) is not part
// of the new dependency-injection seam, and it makes its own live model call
// as its very first action -- with no query-gated step before that call, so
// no fake query can prevent it from actually reaching OpenAI. Driving this
// branch through a live request (confirmed experimentally: it made 3 real,
// billed calls before this fix) is unsafe. This is exactly the case the
// route-DI task anticipated with "otherwise preserve the current rollback
// test without introducing fetch stubs": a minimal, unavoidable structural
// check for this one fact only, not a behavioral drive-through.
test("legacy rollback: the extraction mode switch takes the legacy branch, not the CFX branch, when CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED=true", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/routes/content/content.scrape.routes.js", "utf8");
  const switchIndex = source.indexOf("const legacyCaseAssertionExtractionEnabled = process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED");
  assert.ok(switchIndex >= 0, "the extraction mode switch must exist");
  const ifIndex = source.indexOf("if (!legacyCaseAssertionExtractionEnabled) {", switchIndex);
  const elseIndex = source.indexOf("} else {", ifIndex);
  assert.ok(ifIndex > switchIndex && elseIndex > ifIndex, "CFX must be the `if (!flag)` branch, legacy the `else`");
  const cfxBranch = source.slice(ifIndex, elseIndex);
  assert.match(cfxBranch, /runCaseAssertionExtractionStage/u, "the CFX branch must call the injectable extraction seam");
});

// -- startup validation: already behavioral, unchanged ----------------------

test("startup rejects CFX_LEGACY_EVIDENCE_ENABLED=true without CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED=true", () => {
  const savedLegacyEvidence = process.env.CFX_LEGACY_EVIDENCE_ENABLED;
  const savedLegacyExtraction = process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
  try {
    process.env.CFX_LEGACY_EVIDENCE_ENABLED = "true";
    delete process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
    assert.throws(
      () => createContentScrapeRoutes({ query: async () => [], pool: null }),
      /Incompatible CFX flag combination/u,
      "the incompatible combination must be rejected before the router (and any DB-touching startup work) is created",
    );
  } finally {
    if (savedLegacyEvidence === undefined) delete process.env.CFX_LEGACY_EVIDENCE_ENABLED;
    else process.env.CFX_LEGACY_EVIDENCE_ENABLED = savedLegacyEvidence;
    if (savedLegacyExtraction === undefined) delete process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
    else process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED = savedLegacyExtraction;
  }
});

test("startup does not reject when both flags are legacy, or when both are left at their CFX defaults", () => {
  const savedLegacyEvidence = process.env.CFX_LEGACY_EVIDENCE_ENABLED;
  const savedLegacyExtraction = process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
  try {
    delete process.env.CFX_LEGACY_EVIDENCE_ENABLED;
    delete process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
    assert.doesNotThrow(() => createContentScrapeRoutes({ query: async () => [], pool: null }));

    process.env.CFX_LEGACY_EVIDENCE_ENABLED = "true";
    process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED = "true";
    assert.doesNotThrow(() => createContentScrapeRoutes({ query: async () => [], pool: null }));
  } finally {
    if (savedLegacyEvidence === undefined) delete process.env.CFX_LEGACY_EVIDENCE_ENABLED;
    else process.env.CFX_LEGACY_EVIDENCE_ENABLED = savedLegacyEvidence;
    if (savedLegacyExtraction === undefined) delete process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
    else process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED = savedLegacyExtraction;
  }
});
