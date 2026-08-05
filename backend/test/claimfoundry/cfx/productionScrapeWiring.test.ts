import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("bound production scrape preserves raw evidence before parsing and exits before semantic work", async () => {
  const route = await readFile(
    "src/routes/content/content.scrape.routes.js",
    "utf8",
  );
  const start = route.indexOf('router.post("/api/scrape-reference"');
  const section = route.slice(start);
  const rawReceipt = section.indexOf("persistRawEvidenceScrapeReceipt");
  const parse = section.indexOf("await scrapeReference");
  const earlyReturn = section.indexOf("acquisitionOnly: true");
  const semanticWork = section.indexOf("await processTaskClaims");
  assert.ok(start >= 0);
  assert.ok(rawReceipt >= 0 && rawReceipt < parse);
  assert.ok(parse < earlyReturn && earlyReturn < semanticWork);
  assert.match(section, /UPDATE content SET content_text = \?/);
});

test("acquisition-only scrape suppresses secondary network enrichment", async () => {
  const source = await readFile("src/core/scrapeReference.js", "utf8");
  assert.match(
    source,
    /if \(!acquisitionOnly && !authors\.length[\s\S]*followProfileLinks/,
  );
  assert.match(source, /if \(chainUrl && !acquisitionOnly\)/);
  assert.match(source, /else if \(\$ && !acquisitionOnly\)/);
  assert.match(source, /if \(!acquisitionOnly\) \(async \(\) =>/);
});

test("task, reference, and CFX acquisition share the production document extraction seam", async () => {
  const [task, reference, cfx] = await Promise.all([
    readFile("src/core/scrapeTask.js", "utf8"),
    readFile("src/core/scrapeReference.js", "utf8"),
    readFile("src/services/cfxAutomaticAcquisition.js", "utf8"),
  ]);
  assert.match(task, /extractProductionReadableHtml/u);
  assert.match(reference, /extractProductionReadableHtml/u);
  assert.match(cfx, /extractProductionHtmlDocument/u);
  assert.match(cfx, /extractProductionPdfDocument/u);
  assert.match(cfx, /productionDocumentType/u);
});

test("extension recovery retains specialized PDF and Facebook capture before the backend reference route", async () => {
  const extension = await readFile(
    new URL("../../../../extension/src/background.js", import.meta.url),
    "utf8",
  );
  const pdf = extension.indexOf("/api/parse-pdf-blob");
  const facebook = extension.indexOf("Facebook post HTML + provenance extraction");
  const backend = extension.indexOf("/api/scrape-reference");
  assert.ok(pdf >= 0 && pdf < backend);
  assert.ok(facebook >= 0 && facebook < backend);
  assert.match(extension, /extractCompactPageForScrape/u);
});

test("/api/scrape-task defaults to CFX: with CFX_LEGACY_EVIDENCE_ENABLED unset, the injected evidence pipeline is called", async () => {
  const saved = process.env.CFX_LEGACY_EVIDENCE_ENABLED;
  delete process.env.CFX_LEGACY_EVIDENCE_ENABLED;
  try {
    const url = "https://example.test/production-scrape-wiring-cfx-default";
    const contentId = 90101;
    let pipelineCalls = 0;
    const router = createContentScrapeRoutes({
      query: async (sql: string, values: unknown[] = []) => {
        if (sql.startsWith("SELECT content_id, content_name FROM content WHERE url = ?")) return [];
        if (sql.trim().startsWith("CALL InsertContentAndTopics")) return { affectedRows: 1 };
        if (sql.startsWith("SELECT content_id, thumbnail FROM content WHERE url = ?")) return [{ content_id: contentId, thumbnail: null }];
        throw new Error(`unexpected query: ${sql}`);
      },
      pool: {},
      testOpenAiConnection: async () => ({ accessible: true }),
      runCaseAssertionExtractionStage: async () => ({ claimIds: [1], propositionIds: ["P01"], status: "completed" }),
      runProductionEvidencePipeline: async () => { pipelineCalls += 1; return { status: "completed", results: [] }; },
    } as any);
    const layer = (router as any).stack.find((entry: any) => entry.route?.path === "/api/scrape-task");
    const handler = layer.route.stack.at(-1).handle;
    const res = response();
    await handler({
      body: { url, raw_text: "Production scrape wiring test article.", content_name: "Wiring test" },
      user: null,
    }, res);
    assert.equal(pipelineCalls, 1, "the CFX evidence pipeline must run by default");
    assert.equal(res.statusCode, 200);
  } finally {
    if (saved === undefined) delete process.env.CFX_LEGACY_EVIDENCE_ENABLED;
    else process.env.CFX_LEGACY_EVIDENCE_ENABLED = saved;
  }
});

// runEvidenceEngine (the legacy evidence path) is not part of the new
// dependency-injection seam and makes its own live model/retrieval calls
// with no query-gated step before them, so -- exactly as with the legacy
// case-assertion extractor in freshArticleExtractionRouteWiring.test.ts --
// branch selection for the legacy rollback is proven structurally rather
// than by actually executing it.
test("keeps legacy evidence gathering behind an explicit rollback flag, matching /api/run-evidence", async () => {
  const route = await readFile("src/routes/content/content.scrape.routes.js", "utf8");
  const start = route.indexOf("🔵 [/api/scrape-task] RECEIVED REQUEST");
  assert.ok(start >= 0);
  const nextRoute = route.indexOf('router.post("/api/scrape-reference"');
  assert.ok(nextRoute > start);
  const section = route.slice(start, nextRoute);
  assert.match(section, /CFX_LEGACY_EVIDENCE_ENABLED === "true"/u);
  const legacyCall = section.indexOf("await runEvidenceEngine(");
  const cfxCall = section.indexOf("await runProductionEvidencePipeline(");
  const legacyBranchStart = section.lastIndexOf("if (legacyEvidenceEnabled)", legacyCall);
  const cfxBranchStart = section.lastIndexOf("} else {", cfxCall);
  assert.ok(legacyCall >= 0 && cfxCall >= 0);
  assert.ok(legacyBranchStart >= 0 && legacyBranchStart < legacyCall);
  assert.ok(cfxBranchStart >= 0 && cfxBranchStart < cfxCall);
  // The legacy per-reference broad claim-matching pass (processTaskClaims +
  // matchClaimsToTaskClaims) must stay retired regardless of which evidence
  // engine ran -- CFX's document-centric bearing call already does
  // extraction + matching in one pass, so re-running legacy's second pass on
  // top of it would exactly reproduce the duplicate-call problem this
  // feature exists to eliminate.
  assert.match(route, /const LEGACY_REFERENCE_CLAIM_EXTRACTION_RETIRED = true;/u);
});

test("production terminal transition and EvidenceRun delivery are one transaction", async () => {
  const route = await readFile(
    "src/routes/content/content.scrape.routes.js",
    "utf8",
  );
  for (const status of ["completed", "failed"]) {
    const terminal = route.indexOf(`terminalStatus: "${status}"`);
    assert.ok(terminal >= 0);
    const before = route.slice(Math.max(0, terminal - 1_000), terminal);
    assert.match(before, /const transition = async/);
    const after = route.slice(terminal, terminal + 1_000);
    assert.match(after, /withTransaction/);
  }
});
