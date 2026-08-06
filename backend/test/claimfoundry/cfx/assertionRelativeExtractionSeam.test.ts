import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as productionEvidencePipeline from "../../../src/services/cfxProductionEvidencePipeline.js";
import { aggregateCfxCanonicalDocuments } from "../../../src/claimfoundry/cfx/acquisition/canonicalDocuments.js";
import { runCfxSingleAssertionPacketExtraction } from "../../../src/claimfoundry/cfx/experiments/singleAssertionPacketExtraction/runExtraction.js";
import type { Cf7StructuredModelRequest, Cf7StructuredProvider } from "../../../src/claimfoundry/shared/provider/index.js";

const { runCfxProductionEvidencePipeline } = productionEvidencePipeline as any;
const runCfxAssertionRelativePacketExtractionForPair =
  (productionEvidencePipeline as any).runCfxAssertionRelativePacketExtractionForPair;

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");

const EMPTY_LITERAL_IDENTIFIERS = {
  people: [], organizations: [], laws: [], studyTitles: [], journals: [], years: [],
  dateRanges: [], doi: [], pmid: [], urls: [], citationNumbers: [], acronyms: [],
};
const EMPTY_LOOKUP_HINTS = {
  populations: [], exposures: [], outcomes: [], interventions: [], geography: [],
  documentTypes: [], topics: [],
};

function memoryArtifacts() {
  const store = new Map<string, unknown>();
  return {
    store,
    async write(file: string, value: unknown) { store.set(file, value); },
  };
}

function evidenceInput(overrides: Record<string, unknown> = {}) {
  return {
    propositionId: "P1",
    claimId: 11,
    substantiveAssertion: "The immutable production assertion.",
    literalIdentifiers: { ...EMPTY_LITERAL_IDENTIFIERS, organizations: ["CDC"] },
    lookupHints: { ...EMPTY_LOOKUP_HINTS, topics: ["data manipulation"] },
    ...overrides,
  };
}

function stubExtractionRuntimePiece(capture: { input: any } = { input: null }) {
  return {
    async selectCfxAssertionRelativePackets(input: any) {
      capture.input = input;
      return {
        assertionId: input.assertion.assertionId,
        documentId: input.document.documentId,
        selectedPackets: [{
          packetId: "PACKET-0001", blockIds: ["SOURCE-0001"], charStart: 0, charEnd: 20, text: "stub packet text.",
        }],
        diagnostics: {},
      };
    },
    async runCfxSingleAssertionPacketExtraction(input: any) {
      return {
        status: "completed", acceptedRows: [], rejectedRows: [], rawOutput: null,
        requestHash: "stub-hash", promptHash: "stub-prompt-hash", schemaHash: "stub-schema-hash",
        responseId: "resp", requestId: "req", model: input.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        latencyMs: 1, providerCallCount: 1, error: null,
      };
    },
  };
}

test("packet-selection input carries requiredConceptGroups: [] and the assertion's Option-A aliases, never the fixture expansion_terms", async () => {
  const capture: { input: any } = { input: null };
  await runCfxAssertionRelativePacketExtractionForPair({
    runtime: stubExtractionRuntimePiece(capture),
    provider: {} as Cf7StructuredProvider,
    model: "gpt-4o-mini",
    propositionId: "P1",
    evidenceInput: evidenceInput(),
    documentKey: "DOC-1",
    referenceContentId: 20,
    acquiredText: "The full acquired document text.",
    artifacts: memoryArtifacts(),
  });
  assert.deepEqual(capture.input.assertion.requiredConceptGroups, []);
  assert.deepEqual(capture.input.assertion.aliases, ["CDC", "data manipulation"]);
});

test("acquired text is passed as exactly one SOURCE-0001 block, unmodified", async () => {
  const capture: { input: any } = { input: null };
  const acquiredText = "Paragraph one.\n\nParagraph two with no re-splitting or normalization.";
  await runCfxAssertionRelativePacketExtractionForPair({
    runtime: stubExtractionRuntimePiece(capture),
    provider: {} as Cf7StructuredProvider,
    model: "gpt-4o-mini",
    propositionId: "P1",
    evidenceInput: evidenceInput(),
    documentKey: "DOC-1",
    referenceContentId: 20,
    acquiredText,
    artifacts: memoryArtifacts(),
  });
  assert.deepEqual(capture.input.document.blocks, [{ blockId: "SOURCE-0001", text: acquiredText }]);
});

test("empty packet selection makes zero extraction model calls (real, unmodified runCfxSingleAssertionPacketExtraction)", async () => {
  let providerInvocations = 0;
  const record = await runCfxAssertionRelativePacketExtractionForPair({
    runtime: {
      async selectCfxAssertionRelativePackets(input: any) {
        return { assertionId: input.assertion.assertionId, documentId: input.document.documentId, selectedPackets: [], diagnostics: {} };
      },
      // The REAL, unmodified extraction runner -- not a fake -- to prove its
      // own empty-packet short-circuit is what makes the call count zero.
      runCfxSingleAssertionPacketExtraction,
    },
    provider: {
      async invokeStructured() { providerInvocations += 1; throw new Error("must never be invoked for empty packets"); },
    } as Cf7StructuredProvider,
    model: "gpt-4o-mini",
    propositionId: "P1",
    evidenceInput: evidenceInput(),
    documentKey: "DOC-1",
    referenceContentId: 20,
    acquiredText: "Text with nothing selected by the stub retriever.",
    artifacts: memoryArtifacts(),
  });
  assert.equal(providerInvocations, 0);
  assert.equal(record.extractionStatus, "empty");
  assert.equal(record.extractionProviderCallCount, 0);
  assert.deepEqual(record.acceptedRows, []);
  assert.deepEqual(record.rejectedRows, []);
  assert.equal(record.emptyPacketSelection, true);
});

test("golden pair: packet payload matches the frozen baseline and the extraction request hash matches the frozen golden request", async () => {
  const baselineRoot = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cfx/CF1-F03/cfx-assertion-relative-block-baseline-20260802",
  );
  const extractionRoot = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cfx/CF1-F03/cfx-single-assertion-packet-extraction-20260802090828",
  );
  const baselineInput = JSON.parse(await readFile(path.join(baselineRoot, "baseline_input.json"), "utf8"));
  const actualOutputs = JSON.parse(await readFile(path.join(baselineRoot, "actual_outputs.json"), "utf8")) as any[];
  const exactRequests = JSON.parse(await readFile(path.join(extractionRoot, "exact-model-requests.json"), "utf8")) as any[];

  const assertionId = "P54895";
  const documentId = "DOC-543bc0ef88817a66db53";
  const goldenPacketEntry = actualOutputs.find((row) => row.assertionId === assertionId && row.documentId === documentId);
  const goldenRequestEntry = exactRequests.find((row) => row.assertionId === assertionId && row.documentId === documentId);
  const goldenPacket = goldenPacketEntry.selectedPackets[0];

  const record = await runCfxAssertionRelativePacketExtractionForPair({
    runtime: {
      // Fakes only the packet-selection call, returning the exact frozen
      // golden packet -- proving the wiring, not re-running the real
      // Python retriever inside an automated test.
      async selectCfxAssertionRelativePackets(input: any) {
        assert.equal(input.assertion.assertionId, assertionId);
        assert.equal(input.document.documentId, documentId);
        return {
          assertionId, documentId,
          selectedPackets: [{
            packetId: goldenPacket.packetId, blockIds: goldenPacket.blockIds,
            charStart: goldenPacket.charStart, charEnd: goldenPacket.charEnd, text: goldenPacket.text,
          }],
          diagnostics: {},
        };
      },
      // The REAL, unmodified extraction runner and request builder.
      runCfxSingleAssertionPacketExtraction,
    },
    provider: {
      async invokeStructured(request: Cf7StructuredModelRequest) {
        return {
          output: { assertionId, documentId, assertions: [] },
          rawResponse: {}, model: request.model,
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
          responseId: "resp", requestId: "req",
        };
      },
    } as Cf7StructuredProvider,
    model: "gpt-4o-mini",
    propositionId: assertionId,
    evidenceInput: evidenceInput({ propositionId: assertionId, substantiveAssertion: baselineInput.scope.assertions[assertionId].text }),
    documentKey: documentId,
    referenceContentId: 20,
    acquiredText: goldenPacket.text,
    artifacts: memoryArtifacts(),
  });

  assert.deepEqual(record.packetIds, [goldenPacket.packetId]);
  assert.deepEqual(record.blockIds, goldenPacket.blockIds);
  assert.deepEqual(record.characterSpans, [{
    packetId: goldenPacket.packetId, charStart: goldenPacket.charStart, charEnd: goldenPacket.charEnd,
  }]);
  assert.equal(record.extractionRequestHash, goldenRequestEntry.requestHash);
});

function queryHintsRow(propositionId: string, groundingUnitId: string) {
  return JSON.stringify({
    propositionId,
    groundingUnitIds: [groundingUnitId],
    literalIdentifiers: EMPTY_LITERAL_IDENTIFIERS,
    lookupHints: EMPTY_LOOKUP_HINTS,
    deterministicQueries: { literal: [], sourceQualified: [], studyLookup: [] },
  });
}

function sharedIdentityCandidate(overrides: { candidateId: string; propositionId: string; retrievalRank: number; requestId: string; query: string }) {
  return {
    candidateId: overrides.candidateId,
    propositionId: overrides.propositionId,
    queryId: "Q1",
    provider: "tavily",
    providerRecordId: null,
    title: "Shared evidence document",
    authors: [] as string[],
    publication: null,
    publicationDate: null,
    doi: null,
    pmid: null,
    url: "https://example.test/shared-evidence",
    canonicalUrl: "https://example.test/shared-evidence",
    resolvedUrl: "https://example.test/shared-evidence",
    abstractOrSnippet: "A shared bounded provider snippet.",
    sourceType: "web",
    retrievalScore: 1,
    retrievalRank: overrides.retrievalRank,
    rawArtifactPath: `raw-provider-responses/${overrides.requestId}.json`,
    discoveryPaths: [{
      propositionId: overrides.propositionId, queryId: "Q1", queryIntent: "canonical",
      query: overrides.query, provider: "tavily", retrievalRank: overrides.retrievalRank, requestId: overrides.requestId,
    }],
  };
}

function buildTwoPropositionSharedDocumentHarness() {
  const sqlCalls: Array<{ sql: string; values: unknown[] }> = [];
  let contentRelationCreated = false;
  const query = async (sql: string, values: unknown[] = []) => {
    sqlCalls.push({ sql, values });
    if (sql.includes("FROM claims c") && sql.includes("JOIN content_claims")) {
      return [
        { claim_id: 11, claim_text: "Assertion one.", speaker_entity: "Source A", evaluation_target_id: 12, target_order: 0, source_excerpt: "Grounding text one.", article_stance: "adopts", population_scope: null, query_hints_json: queryHintsRow("P1", "U0001") },
        { claim_id: 12, claim_text: "Assertion two.", speaker_entity: "Source B", evaluation_target_id: 13, target_order: 0, source_excerpt: "Grounding text two.", article_stance: "adopts", population_scope: null, query_hints_json: queryHintsRow("P2", "U0002") },
      ];
    }
    if (sql.startsWith("SELECT d.canonical_document_id")) return [];
    if (sql.startsWith("INSERT INTO cfx_canonical_documents")) return { insertId: 80, affectedRows: 1 };
    if (sql.startsWith("INSERT INTO cfx_canonical_document_identities")) return { insertId: 81, affectedRows: 1 };
    if (sql.startsWith("UPDATE cfx_canonical_documents")) return { affectedRows: 1 };
    if (sql.startsWith("INSERT INTO cfx_document_discovery_assignments")) return { insertId: 82, affectedRows: 1 };
    if (sql.startsWith("SELECT canonical_document_id FROM cfx_canonical_documents")) return [{ canonical_document_id: 80 }];
    if (sql.startsWith("SELECT binding_id,scrape_job_id,reference_content_id")) return [];
    if (sql.startsWith("SELECT content_id FROM content")) return [];
    if (/^INSERT INTO content\s*\(/u.test(sql)) return { insertId: 20 };
    if (sql.startsWith("SELECT content_relation_id")) return contentRelationCreated ? [{ content_relation_id: 30 }] : [];
    if (sql.startsWith("INSERT INTO content_relations")) { contentRelationCreated = true; return { insertId: 30 }; }
    if (sql.startsWith("SELECT ref_claim_link_id FROM reference_claim_links")) return [];
    if (sql.startsWith("INSERT INTO reference_claim_links")) return { insertId: 35 };
    if (sql.startsWith("INSERT INTO scrape_jobs")) return { insertId: 40 };
    if (sql.startsWith("INSERT INTO cfx_evidence_acquisition_bindings")) return { insertId: 50 };
    if (sql.startsWith("INSERT INTO cfx_evidence_acquisition_attempts")) return { insertId: 60 };
    if (sql.startsWith("SELECT acquired_text_version_id")) return [];
    if (sql.startsWith("INSERT INTO cfx_evidence_text_versions")) return { insertId: 70 };
    if (sql.startsWith("UPDATE cfx_evidence_text_versions")) return { affectedRows: 0 };
    if (sql.startsWith("UPDATE cfx_evidence_acquisition_bindings")) return { affectedRows: 1 };
    if (sql.startsWith("UPDATE content SET content_text=")) return { affectedRows: 1 };
    if (sql.startsWith("SELECT scrape_job_id FROM cfx_evidence_acquisition_bindings")) return [{ scrape_job_id: null }];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const connection = { async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, query };
  const pool = { async getConnection() { return connection; } };

  const candA = sharedIdentityCandidate({ candidateId: "CAND-P1-A", propositionId: "P1", retrievalRank: 1, requestId: "REQ-P1-Q1", query: "assertion one" });
  const candB = sharedIdentityCandidate({ candidateId: "CAND-P2-B", propositionId: "P2", retrievalRank: 1, requestId: "REQ-P2-Q1", query: "assertion two" });

  let acquisitionCalls = 0;
  const packetSelectionCalls: string[] = [];
  const packetSelectionOptionsCalls: any[] = [];
  const extractionCalls: string[] = [];
  const runtime: Record<string, unknown> = {
    aggregateCfxCanonicalDocuments,
    dedupeCfxCandidates(rows: any[]) { return { candidates: rows, audit: [], duplicateCount: 0 }; },
    canonicalHash() { return "a".repeat(64); },
    async loadCfxQueryPlanningPrompt() { return { prompt: "governed", promptHash: "b".repeat(64) }; },
    async runCfxQueryPlanning(input: any) {
      await input.beforeInvoke({ model: "gpt-4o-mini", messages: [] });
      await input.afterResponse({ rawResponse: { id: "plan-1" }, responseId: "plan-1", requestId: null, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedInputTokens: 0 }, latencyMs: 1 });
      return { plan: { propositions: [] }, providerCallCount: 1 };
    },
    async executeCfxRetrieval(input: any) {
      const requestP1 = { requestId: "REQ-P1-Q1", propositionId: "P1", queryId: "Q1", query: "assertion one", provider: "web", topK: 5, pubmedFallbacks: [] };
      const requestP2 = { requestId: "REQ-P2-Q1", propositionId: "P2", queryId: "Q1", query: "assertion two", provider: "web", topK: 5, pubmedFallbacks: [] };
      await input.beforeRequest(requestP1);
      await input.afterResponse({ request: requestP1, response: { results: [candA] }, provider: "tavily", providerRequestId: "web-1", latencyMs: 1 });
      await input.beforeRequest(requestP2);
      await input.afterResponse({ request: requestP2, response: { results: [candB] }, provider: "tavily", providerRequestId: "web-2", latencyMs: 1 });
      return { outcomes: [{ request: requestP1, candidates: [candA] }, { request: requestP2, candidates: [candB] }], requestCount: 2, providerRequestCount: 2, providerFailureCount: 0 };
    },
    async selectCfxAssertionRelativePackets(input: any, options: any) {
      packetSelectionCalls.push(input.assertion.assertionId);
      packetSelectionOptionsCalls.push(options);
      return {
        assertionId: input.assertion.assertionId, documentId: input.document.documentId,
        selectedPackets: [{ packetId: "PACKET-0001", blockIds: ["SOURCE-0001"], charStart: 0, charEnd: 20, text: "stub packet text." }],
        diagnostics: {},
      };
    },
    async runCfxSingleAssertionPacketExtraction(input: any) {
      extractionCalls.push(input.assertionId);
      return {
        status: "completed", acceptedRows: [], rejectedRows: [], rawOutput: null,
        requestHash: `hash-${input.assertionId}`, promptHash: "p".repeat(64), schemaHash: "s".repeat(64),
        responseId: "resp", requestId: "req", model: input.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 }, latencyMs: 1,
        providerCallCount: 1, error: null,
      };
    },
  };

  const artifacts = new Map<string, unknown>();
  let runtimeLoaderCalls = 0;
  const runPipeline = (extra: Record<string, unknown>) => runCfxProductionEvidencePipeline({
    query, pool, taskContentId: 10, claimIds: [11, 12], expectedClaimCount: 2, documentsPerAssertion: 1,
    async schemaPreflight() {}, provider: {}, bearingProvider: {}, retrievalTransport: {},
    async runtimeLoader() { runtimeLoaderCalls += 1; return runtime; },
    async academicResolver() { return null; },
    async persistedTextResolver() { return null; },
    async automaticAcquirer() {
      acquisitionCalls += 1;
      return {
        acquired: true,
        cleanedText: Array.from({ length: 90 }, (_, index) => `substantive evidence sentence ${index}.`).join(" "),
        method: "publisher_html", sourceUrl: "https://example.test/shared-evidence", resolvedUrl: "https://example.test/shared-evidence",
        contentType: "text/html", completeness: "complete",
        attempts: [{ method: "axios", status: "success", url: "https://example.test/shared-evidence", resolvedUrl: "https://example.test/shared-evidence", httpStatus: 200, contentType: "text/html", characterCount: 108, timingMs: 1, diagnostic: null, rawResponse: "<article>complete</article>", tier: "normal_platform_scrape" }],
      };
    },
    async queueRetry() { return { created: true, scrapeJobId: 40, status: "pending" }; },
    async sourceQualityEnricher() { return { status: "created" }; },
    async sourceCrestProcessor() { return { status: "identity_pending" }; },
    async publishingIdentityProcessor() { return { persistence: null }; },
    artifactStoreFactory() {
      return { root: "memory/run", async initialize() {}, async write(file: string, value: unknown) { artifacts.set(file, value); }, async finalize() { return { root: "memory/run", aggregateSha256: "c".repeat(64) }; } };
    },
    resolvePacketSelectionPythonExecutable() { return { executable: "stub-python3", source: "configured" }; },
    async validatePacketSelectionPythonRuntime() { return { executable: "stub-python3", pythonVersion: "Python 3.12.0" }; },
    ...extra,
  });

  return {
    runPipeline, sqlCalls, artifacts, get acquisitionCalls() { return acquisitionCalls; },
    packetSelectionCalls, packetSelectionOptionsCalls, extractionCalls,
    get runtimeLoaderCalls() { return runtimeLoaderCalls; },
  };
}

test("one document selected by two propositions: one acquisition, two independent packet-selection calls, two independent extraction calls", async () => {
  let bearingCalls = 0;
  const harness = buildTwoPropositionSharedDocumentHarness();
  const result = await harness.runPipeline({
    assertionRelativeExtraction: true,
    async bearingProcessor() { bearingCalls += 1; return { status: "completed", providerCalls: 1 }; },
  });

  assert.equal(harness.acquisitionCalls, 1, "the shared canonical document must be acquired exactly once");
  assert.deepEqual(harness.packetSelectionCalls.sort(), ["P1", "P2"], "packet selection must run once per proposition, independently");
  assert.deepEqual(harness.extractionCalls.sort(), ["P1", "P2"], "extraction must run once per proposition, independently");
  assert.equal(bearingCalls, 0, "the old bearingProcessor path must not run when assertionRelativeExtraction is enabled");

  assert.equal(result.results.length, 1, "one canonical document result row");
  const [documentResult] = result.results;
  assert.equal(documentResult.assertionRelativeExtraction.status, "attempted");
  const propositionIds = documentResult.assertionRelativeExtraction.propositions.map((row: any) => row.propositionId).sort();
  assert.deepEqual(propositionIds, ["P1", "P2"]);
  for (const row of documentResult.assertionRelativeExtraction.propositions) {
    assert.equal(row.referenceContentId, documentResult.referenceContentId, "each proposition's extraction shares the one document's referenceContentId");
    assert.equal(row.documentId, documentResult.documentKey);
  }
});

test("default configuration keeps the old bearing path exclusive: the new packet-selection/extraction runtime functions are never called", async () => {
  let bearingCalls = 0;
  const harness = buildTwoPropositionSharedDocumentHarness();
  await harness.runPipeline({
    // assertionRelativeExtraction omitted -- must default to false.
    async bearingProcessor() { bearingCalls += 1; return { status: "completed", providerCalls: 1 }; },
  });
  assert.equal(bearingCalls, 1, "bearingProcessor is document-centric: once for the one shared selected document, unchanged from before this seam existed");
  assert.deepEqual(harness.packetSelectionCalls, []);
  assert.deepEqual(harness.extractionCalls, []);
});

test("the new assertion-relative path never invokes source-assertion or link persistence SQL", async () => {
  const harness = buildTwoPropositionSharedDocumentHarness();
  await harness.runPipeline({ assertionRelativeExtraction: true });
  const persistenceLikeSql = harness.sqlCalls.filter(({ sql }) =>
    /INSERT INTO cfx_source_assertion_provenance/u.test(sql)
    || /INSERT INTO reference_claim_task_links/u.test(sql)
    || /UPDATE reference_claim_task_links/u.test(sql)
    || /UPDATE cfx_source_assertion_provenance/u.test(sql));
  assert.deepEqual(persistenceLikeSql, []);
});

test("assertion-relative extraction artifacts are captured per document/proposition pair and omit queryIntent", async () => {
  const harness = buildTwoPropositionSharedDocumentHarness();
  await harness.runPipeline({ assertionRelativeExtraction: true });
  const written = [...harness.artifacts.keys()].filter((key) => key.startsWith("assertion-relative-extraction/"));
  assert.ok(written.some((key) => key.endsWith("/packet-selection-input.json")));
  assert.ok(written.some((key) => key.endsWith("/packet-selection-output.json")));
  assert.ok(written.some((key) => key.endsWith("/extraction-result.json")));
  for (const key of written) {
    const value = JSON.stringify(harness.artifacts.get(key));
    assert.ok(!value.includes("queryIntent"), `${key} must not include queryIntent`);
  }
});

test("Python runtime gate: a failing validator rejects the whole pipeline before query planning/retrieval/runtimeLoader run", async () => {
  const harness = buildTwoPropositionSharedDocumentHarness();
  await assert.rejects(
    harness.runPipeline({
      assertionRelativeExtraction: true,
      resolvePacketSelectionPythonExecutable() { return { executable: "/broken/python3", source: "configured" }; },
      async validatePacketSelectionPythonRuntime() {
        throw new Error("CFX packet-selection CLI failed to start under /broken/python3 (exit 1): ModuleNotFoundError: No module named 'numpy'");
      },
    }),
    /packet-selection CLI failed to start/,
  );
  assert.equal(harness.runtimeLoaderCalls, 0, "must fail before the CFX runtime (query planning/retrieval) is even loaded");
  assert.deepEqual(harness.packetSelectionCalls, [], "must fail before any per-document packet selection is attempted");
});

test("Python runtime gate: the resolved executable is exactly what reaches the packet-selection subprocess call, once per run", async () => {
  const harness = buildTwoPropositionSharedDocumentHarness();
  let resolveCalls = 0;
  await harness.runPipeline({
    assertionRelativeExtraction: true,
    resolvePacketSelectionPythonExecutable() { resolveCalls += 1; return { executable: "/governed/.venv-cfx/bin/python3", source: "local_venv" }; },
    async validatePacketSelectionPythonRuntime(input: any) {
      assert.equal(input.executable, "/governed/.venv-cfx/bin/python3", "validation must run against the exact resolved executable");
      return { executable: input.executable, pythonVersion: "Python 3.12.13" };
    },
  });
  assert.equal(resolveCalls, 1, "resolution must happen exactly once per pipeline run, not once per document/proposition");
  assert.ok(harness.packetSelectionOptionsCalls.length >= 1, "packet selection must actually run for at least one pair");
  for (const options of harness.packetSelectionOptionsCalls) {
    assert.equal(options.pythonExecutable, "/governed/.venv-cfx/bin/python3", "every packet-selection call must receive the governed resolved executable, never a bare default");
  }
});
