import assert from "node:assert/strict";
import test from "node:test";
import * as productionEvidencePipeline from "../../../src/services/cfxProductionEvidencePipeline.js";
import { aggregateCfxCanonicalDocuments } from "../../../src/claimfoundry/cfx/acquisition/canonicalDocuments.js";
import { stableCfxSourceAssertionId } from "../../../src/claimfoundry/cfx/finalLinking/linkSuggestion.js";
import {
  persistCfxSourceAssertions,
  type CfxFinalLinkingPersistenceStore,
} from "../../../src/claimfoundry/cfx/finalLinking/persistence.js";
import {
  ensureClaimSource,
  ensureContentClaim,
  ensureContentRelation,
  findOrCreateCanonicalClaim,
} from "../../../src/services/cfxProductionEvidenceStore.js";

const directPersistenceStore: CfxFinalLinkingPersistenceStore = {
  ensureClaimSource, ensureContentClaim, ensureContentRelation, findOrCreateCanonicalClaim,
};

const { runCfxProductionEvidencePipeline } = productionEvidencePipeline as any;
const projectCfxAssertionRelativeSourceAssertions =
  (productionEvidencePipeline as any).projectCfxAssertionRelativeSourceAssertions;

const EMPTY_LITERAL_IDENTIFIERS = {
  people: [], organizations: [], laws: [], studyTitles: [], journals: [], years: [],
  dateRanges: [], doi: [], pmid: [], urls: [], citationNumbers: [], acronyms: [],
};
const EMPTY_LOOKUP_HINTS = {
  populations: [], exposures: [], outcomes: [], interventions: [], geography: [],
  documentTypes: [], topics: [],
};

function acceptedExtractionRow(overrides: Record<string, unknown> = {}) {
  return {
    assertionId: "P1",
    documentId: "DOC-1",
    rowIndex: 0,
    exactExcerpt: "The stub packet excerpt.",
    sourceAssertion: "A stub source assertion.",
    relevanceType: "affirms",
    reason: "stub reason",
    packetIds: ["PACKET-0001"],
    blockIds: ["SOURCE-0001"],
    normalizedExcerpt: "the stub packet excerpt.",
    grounding: {
      mode: "single_packet", packetSpans: [],
      documentCharStart: 5, documentCharEnd: 30,
    },
    ...overrides,
  };
}

function propositionRecord(overrides: Record<string, unknown> = {}) {
  return {
    propositionId: "P1",
    caseAssertionText: "The immutable production assertion.",
    documentId: "DOC-1",
    extractionModelCallId: "req-001",
    extractionPromptHash: "prompt-hash",
    extractionSchemaHash: "schema-hash",
    acceptedRows: [acceptedExtractionRow()],
    rejectedRows: [],
    ...overrides,
  };
}

function documentMeta() {
  return new Map([["DOC-1", { documentId: "DOC-1", referenceContentId: 20, documentTitle: "A document", documentUrl: "https://example.test/doc" }]]);
}

function stubStableId(input: any) {
  return `SA-STUB-${input.caseAssertionId}-${input.documentId}`;
}

// -- 1. one accepted row -> one projected row -----------------------------

test("projection: one accepted extraction row produces exactly one projected source assertion", () => {
  const rows = projectCfxAssertionRelativeSourceAssertions({
    runtime: { stableCfxSourceAssertionId: stubStableId },
    runId: "run-1",
    documentMetaByKey: documentMeta(),
    propositionRecords: [propositionRecord()],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceAssertionId, "SA-STUB-P1-DOC-1");
  assert.equal(rows[0].caseAssertionId, "P1");
  assert.equal(rows[0].caseAssertionText, "The immutable production assertion.");
  assert.equal(rows[0].documentId, "DOC-1");
  assert.equal(rows[0].documentTitle, "A document");
  assert.equal(rows[0].documentUrl, "https://example.test/doc");
  assert.equal(rows[0].sourceAssertion, "A stub source assertion.");
  assert.equal(rows[0].exactExcerpt, "The stub packet excerpt.");
  assert.equal(rows[0].documentCharStart, 5);
  assert.equal(rows[0].documentCharEnd, 30);
  assert.deepEqual(rows[0].sourceBlockIds, ["SOURCE-0001"]);
  assert.deepEqual(rows[0].sourcePacketIds, ["PACKET-0001"]);
  assert.equal(rows[0].extractionRunId, "run-1");
  assert.equal(rows[0].extractionModelCallId, "req-001");
  assert.equal(rows[0].extractionPromptHash, "prompt-hash");
  assert.equal(rows[0].extractionSchemaHash, "schema-hash");
  assert.ok(!("relevanceType" in rows[0]), "relevanceType must never appear on a projected row");
});

// -- 2. rejected rows produce none -----------------------------------------

test("projection: rejected extraction rows produce no projected source assertions", () => {
  const rows = projectCfxAssertionRelativeSourceAssertions({
    runtime: { stableCfxSourceAssertionId: stubStableId },
    runId: "run-1",
    documentMetaByKey: documentMeta(),
    propositionRecords: [propositionRecord({
      acceptedRows: [],
      rejectedRows: [{ assertionId: "P1", documentId: "DOC-1", rowIndex: 0, rawRow: {}, reasons: [{ code: "EXACT_EXCERPT_NOT_LITERAL", message: "no" }] }],
    })],
  });
  assert.deepEqual(rows, []);
});

// -- 3. stable IDs match the golden projection contract ---------------------

test("projection: sourceAssertionId matches the frozen golden CF1-F03 stable-ID contract", () => {
  const rows = projectCfxAssertionRelativeSourceAssertions({
    runtime: { stableCfxSourceAssertionId },
    runId: "cfx-single-assertion-packet-extraction-20260802090828",
    documentMetaByKey: new Map([["DOC-543bc0ef88817a66db53", {
      documentId: "DOC-543bc0ef88817a66db53", referenceContentId: 1,
      documentTitle: "[PDF] The Facts Behind the “CDC Whistleblower” Accusations Spotlighted ...",
      documentUrl: "https://vaccinateyourfamily.org/wp-content/uploads/2020/09/Whistleblower_QA012017_updatedSept2020.pdf",
    }]]),
    propositionRecords: [{
      propositionId: "P54895",
      caseAssertionText: "The CDC manipulated data linking the MMR vaccine to autism.",
      documentId: "DOC-543bc0ef88817a66db53",
      extractionModelCallId: "request-001",
      extractionPromptHash: "irrelevant-to-id",
      extractionSchemaHash: "irrelevant-to-id",
      acceptedRows: [{
        exactExcerpt: "There is absolutely no evidence that the CDC concealed or omitted any data in this or other studies that have shown there is no connection between vaccines and autism.",
        sourceAssertion: "The CDC manipulated data linking the MMR vaccine to autism.",
        packetIds: ["PACKET-0001"],
        blockIds: ["SOURCE-0001"],
        grounding: { documentCharStart: 4910, documentCharEnd: 5077 },
      }],
      rejectedRows: [],
    }],
  });
  assert.equal(rows.length, 1);
  // Frozen golden ID from artifacts/claim-foundry/cfx/CF1-F03/
  // cfx-final-source-links-20260802144343/source-claim-inputs.json.
  assert.equal(rows[0].sourceAssertionId, "SA-e67aea71901d32dc6319246d");
});

// -- 6/7: reuse the real, unmodified persistCfxSourceAssertions() directly --

function inMemoryProvenanceDatabase() {
  const claims: Array<{ claim_id: number; claim_text: string; claim_type: string }> = [];
  const contentClaims: Array<{ cc_id: number; content_id: number; claim_id: number }> = [];
  const claimSources: Array<{ claim_source_id: number; claim_id: number; reference_content_id: number }> = [];
  const provenance = new Map<string, Record<string, unknown>>();
  let nextId = 1000;
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith("SELECT claim_id FROM claims WHERE claim_text=")) {
      const row = claims.find((c) => c.claim_text === values[0] && c.claim_type === values[1]);
      return row ? [{ claim_id: row.claim_id }] : [];
    }
    if (sql.startsWith("INSERT INTO claims(")) {
      const claim_id = ++nextId;
      claims.push({ claim_id, claim_text: values[0] as string, claim_type: values[1] as string });
      return { insertId: claim_id };
    }
    if (sql.startsWith("SELECT cc_id FROM content_claims WHERE content_id=")) {
      const row = contentClaims.find((c) => c.content_id === values[0] && c.claim_id === values[1]);
      return row ? [{ cc_id: row.cc_id }] : [];
    }
    if (sql.startsWith("INSERT INTO content_claims")) {
      const cc_id = ++nextId;
      contentClaims.push({ cc_id, content_id: values[0] as number, claim_id: values[1] as number });
      return { insertId: cc_id };
    }
    if (sql.startsWith("SELECT claim_source_id FROM claim_sources WHERE claim_id=")) {
      const row = claimSources.find((c) => c.claim_id === values[0] && c.reference_content_id === values[1]);
      return row ? [{ claim_source_id: row.claim_source_id }] : [];
    }
    if (sql.startsWith("INSERT INTO claim_sources")) {
      const claim_source_id = ++nextId;
      claimSources.push({ claim_source_id, claim_id: values[0] as number, reference_content_id: values[1] as number });
      return { insertId: claim_source_id };
    }
    if (sql.includes("FROM cfx_source_assertion_provenance") && sql.includes("FOR UPDATE")) {
      const row = provenance.get(values[0] as string);
      return row ? [row] : [];
    }
    if (sql.startsWith("INSERT INTO cfx_source_assertion_provenance")) {
      const [
        source_assertion_id, claim_id, claim_source_id, case_assertion_id,
        task_claim_id, source_document_id, reference_content_id, exact_excerpt,
        excerpt_start, excerpt_end, source_block_ids_json, source_packet_ids_json,
        extraction_run_id, extraction_model_call_id, extraction_prompt_sha256,
        extraction_schema_sha256,
      ] = values;
      provenance.set(source_assertion_id as string, {
        source_assertion_id, claim_id, claim_source_id, case_assertion_id,
        task_claim_id, source_document_id, reference_content_id, exact_excerpt,
        excerpt_start, excerpt_end, source_block_ids_json, source_packet_ids_json,
        extraction_run_id, extraction_model_call_id, extraction_prompt_sha256,
        extraction_schema_sha256,
      });
      return { insertId: 1, affectedRows: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  return { query };
}

function persistableRow(overrides: Record<string, unknown> = {}) {
  return {
    sourceAssertionId: stableCfxSourceAssertionId({
      caseAssertionId: "P1", documentId: "DOC-1",
      exactExcerpt: "The stub packet excerpt.", sourceAssertion: "A stub source assertion.",
    }),
    caseAssertionId: "P1",
    caseAssertionText: "The immutable production assertion.",
    documentId: "DOC-1",
    documentTitle: "A document",
    documentUrl: "https://example.test/doc",
    sourceAssertion: "A stub source assertion.",
    exactExcerpt: "The stub packet excerpt.",
    documentCharStart: 5,
    documentCharEnd: 30,
    sourceBlockIds: ["SOURCE-0001"],
    sourcePacketIds: ["PACKET-0001"],
    extractionRunId: "run-1",
    extractionModelCallId: "req-001",
    extractionPromptHash: "prompt-hash",
    extractionSchemaHash: "schema-hash",
    ...overrides,
  };
}

test("persistence: re-running identical rows through persistCfxSourceAssertions is idempotent", async () => {
  const database = inMemoryProvenanceDatabase();
  const taskClaimIds = new Map([["P1", 11]]);
  const documents = new Map([["DOC-1", { documentId: "DOC-1", referenceContentId: 20 }]]);
  const rows = [persistableRow()];
  const first = await persistCfxSourceAssertions({ query: database.query, store: directPersistenceStore, taskClaimIds, documents, rows });
  const second = await persistCfxSourceAssertions({ query: database.query, store: directPersistenceStore, taskClaimIds, documents, rows });
  assert.equal(first[0]!.persistenceStatus, "inserted");
  assert.equal(second[0]!.persistenceStatus, "reused");
  assert.equal(first[0]!.sourceAssertionId, second[0]!.sourceAssertionId);
  assert.equal(first[0]!.evidenceClaimId, second[0]!.evidenceClaimId);
  assert.equal(first[0]!.claimSourceId, second[0]!.claimSourceId);
});

test("persistence: conflicting provenance for the same stable sourceAssertionId fails closed", async () => {
  const database = inMemoryProvenanceDatabase();
  const taskClaimIds = new Map([["P1", 11]]);
  const documents = new Map([["DOC-1", { documentId: "DOC-1", referenceContentId: 20 }]]);
  await persistCfxSourceAssertions({ query: database.query, store: directPersistenceStore, taskClaimIds, documents, rows: [persistableRow()] });
  // Same sourceAssertionId (same caseAssertionId/documentId/excerpt/assertion)
  // but a conflicting grounding offset -- e.g. a second run whose acquired
  // text shifted the excerpt's position in the document.
  const conflicting = [persistableRow({ documentCharStart: 6, documentCharEnd: 31 })];
  await assert.rejects(
    () => persistCfxSourceAssertions({ query: database.query, store: directPersistenceStore, taskClaimIds, documents, rows: conflicting }),
    /sourceAssertionId collision/,
  );
});

// -- 4,5,8,9,10,11: full pipeline wiring ------------------------------------

function queryHintsRow(propositionId: string, groundingUnitId: string) {
  return JSON.stringify({
    propositionId,
    groundingUnitIds: [groundingUnitId],
    literalIdentifiers: EMPTY_LITERAL_IDENTIFIERS,
    lookupHints: EMPTY_LOOKUP_HINTS,
    deterministicQueries: { literal: [], sourceQualified: [], studyLookup: [] },
  });
}

function candidate() {
  return {
    candidateId: "CAND-P1-A",
    propositionId: "P1",
    queryId: "Q1",
    provider: "tavily",
    providerRecordId: null,
    title: "A document",
    authors: [] as string[],
    publication: null,
    publicationDate: null,
    doi: null,
    pmid: null,
    url: "https://example.test/doc",
    canonicalUrl: "https://example.test/doc",
    resolvedUrl: "https://example.test/doc",
    abstractOrSnippet: "A bounded provider snippet.",
    sourceType: "web",
    retrievalScore: 1,
    retrievalRank: 1,
    rawArtifactPath: "raw-provider-responses/REQ-P1-Q1.json",
    discoveryPaths: [{
      propositionId: "P1", queryId: "Q1", queryIntent: "canonical",
      query: "assertion one", provider: "tavily", retrievalRank: 1, requestId: "REQ-P1-Q1",
    }],
  };
}

function buildPersistencePipelineHarness(options: { acceptedRows?: any[] } = {}) {
  const acceptedRows = "acceptedRows" in options ? options.acceptedRows! : [acceptedExtractionRow()];

  const claims: Array<{ claim_id: number; claim_text: string; claim_type: string }> = [];
  const contentClaims: Array<{ cc_id: number; content_id: number; claim_id: number }> = [];
  const claimSources: Array<{ claim_source_id: number; claim_id: number; reference_content_id: number }> = [];
  const provenance = new Map<string, Record<string, unknown>>();
  let nextId = 1000;

  let transactionBegins = 0;
  let transactionCommits = 0;
  let transactionRollbacks = 0;
  let contentRelationCreated = false;

  const sqlCalls: Array<{ sql: string; values: unknown[] }> = [];
  const query = async (sql: string, values: unknown[] = []) => {
    sqlCalls.push({ sql, values });
    if (sql.includes("FROM claims c") && sql.includes("JOIN content_claims")) {
      return [
        { claim_id: 11, claim_text: "Assertion one.", speaker_entity: "Source A", evaluation_target_id: 12, target_order: 0, source_excerpt: "Grounding text one.", article_stance: "adopts", population_scope: null, query_hints_json: queryHintsRow("P1", "U0001") },
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
    if (sql.startsWith("SELECT claim_id FROM claims WHERE claim_text=")) {
      const row = claims.find((c) => c.claim_text === values[0] && c.claim_type === values[1]);
      return row ? [{ claim_id: row.claim_id }] : [];
    }
    if (sql.startsWith("INSERT INTO claims(")) {
      const claim_id = ++nextId;
      claims.push({ claim_id, claim_text: values[0] as string, claim_type: values[1] as string });
      return { insertId: claim_id };
    }
    if (sql.startsWith("SELECT cc_id FROM content_claims WHERE content_id=")) {
      const row = contentClaims.find((c) => c.content_id === values[0] && c.claim_id === values[1]);
      return row ? [{ cc_id: row.cc_id }] : [];
    }
    if (sql.startsWith("INSERT INTO content_claims")) {
      const cc_id = ++nextId;
      contentClaims.push({ cc_id, content_id: values[0] as number, claim_id: values[1] as number });
      return { insertId: cc_id };
    }
    if (sql.startsWith("SELECT claim_source_id FROM claim_sources WHERE claim_id=")) {
      const row = claimSources.find((c) => c.claim_id === values[0] && c.reference_content_id === values[1]);
      return row ? [{ claim_source_id: row.claim_source_id }] : [];
    }
    if (sql.startsWith("INSERT INTO claim_sources")) {
      const claim_source_id = ++nextId;
      claimSources.push({ claim_source_id, claim_id: values[0] as number, reference_content_id: values[1] as number });
      return { insertId: claim_source_id };
    }
    if (sql.includes("FROM cfx_source_assertion_provenance") && sql.includes("FOR UPDATE")) {
      const row = provenance.get(values[0] as string);
      return row ? [row] : [];
    }
    if (sql.startsWith("INSERT INTO cfx_source_assertion_provenance")) {
      const [source_assertion_id] = values;
      provenance.set(source_assertion_id as string, { source_assertion_id });
      return { insertId: 1, affectedRows: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const connection = {
    async beginTransaction() { transactionBegins += 1; },
    async commit() { transactionCommits += 1; },
    async rollback() { transactionRollbacks += 1; },
    release() {},
    query,
  };
  const pool = { async getConnection() { return connection; } };

  let acquisitionCalls = 0;
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
      await input.beforeRequest(requestP1);
      await input.afterResponse({ request: requestP1, response: { results: [candidate()] }, provider: "tavily", providerRequestId: "web-1", latencyMs: 1 });
      return { outcomes: [{ request: requestP1, candidates: [candidate()] }], requestCount: 1, providerRequestCount: 1, providerFailureCount: 0 };
    },
    async selectCfxAssertionRelativePackets(input: any) {
      return {
        assertionId: input.assertion.assertionId, documentId: input.document.documentId,
        selectedPackets: [{ packetId: "PACKET-0001", blockIds: ["SOURCE-0001"], charStart: 0, charEnd: 20, text: "stub packet text." }],
        diagnostics: {},
      };
    },
    async runCfxSingleAssertionPacketExtraction(input: any) {
      return {
        status: acceptedRows.length ? "completed" : "completed",
        acceptedRows, rejectedRows: [], rawOutput: null,
        requestHash: `hash-${input.assertionId}`, promptHash: "p".repeat(64), schemaHash: "s".repeat(64),
        responseId: "resp", requestId: "req-001", model: input.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 }, latencyMs: 1,
        providerCallCount: 1, error: null,
      };
    },
    stableCfxSourceAssertionId,
    persistCfxSourceAssertions,
  };

  const artifacts = new Map<string, unknown>();
  const runPipeline = (extra: Record<string, unknown>) => runCfxProductionEvidencePipeline({
    query, pool, taskContentId: 10, claimIds: [11], expectedClaimCount: 1, documentsPerAssertion: 1,
    async schemaPreflight() {}, provider: {}, bearingProvider: {}, retrievalTransport: {},
    async runtimeLoader() { return runtime; },
    async academicResolver() { return null; },
    async persistedTextResolver() { return null; },
    async automaticAcquirer() {
      acquisitionCalls += 1;
      return {
        acquired: true,
        cleanedText: Array.from({ length: 90 }, (_, index) => `substantive evidence sentence ${index}.`).join(" "),
        method: "publisher_html", sourceUrl: "https://example.test/doc", resolvedUrl: "https://example.test/doc",
        contentType: "text/html", completeness: "complete",
        attempts: [{ method: "axios", status: "success", url: "https://example.test/doc", resolvedUrl: "https://example.test/doc", httpStatus: 200, contentType: "text/html", characterCount: 108, timingMs: 1, diagnostic: null, rawResponse: "<article>complete</article>", tier: "normal_platform_scrape" }],
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
    runPipeline, sqlCalls, artifacts,
    get acquisitionCalls() { return acquisitionCalls; },
    get transactionBegins() { return transactionBegins; },
    get transactionCommits() { return transactionCommits; },
    get transactionRollbacks() { return transactionRollbacks; },
  };
}

test("pipeline wiring: taskClaimIds and documents maps carry live production IDs and persistence runs in one explicit transaction", async () => {
  // The pipeline already opens other withTransaction() blocks unrelated to
  // this seam (e.g. candidate-binding creation), so the meaningful
  // assertion is the delta persistence adds, not an absolute count.
  const baselineHarness = buildPersistencePipelineHarness();
  await baselineHarness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: false,
  });

  const harness = buildPersistencePipelineHarness();
  const result = await harness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: true,
  });

  assert.equal(harness.transactionBegins, baselineHarness.transactionBegins + 1,
    "persistence must add exactly one explicit transaction for the whole run");
  assert.equal(harness.transactionCommits, harness.transactionBegins);
  assert.equal(harness.transactionRollbacks, 0);
  assert.equal(result.assertionRelativeExtractionSummary.persistedSourceAssertions, 1);

  const provenanceInsert = harness.sqlCalls.find(({ sql }) => sql.startsWith("INSERT INTO cfx_source_assertion_provenance"));
  assert.ok(provenanceInsert, "one source-assertion provenance row must be inserted");
  // task_claim_id (5th bound value) is the live production claim_id (11) for
  // proposition P1, sourced from the same evidence-input row the rest of the
  // pipeline uses -- not a fabricated or fixture-only value.
  assert.equal(provenanceInsert!.values[4], 11);
  // reference_content_id (7th bound value) is the live content_id (20) the
  // pipeline actually created for this reference document.
  assert.equal(provenanceInsert!.values[6], 20);

  const projected = harness.artifacts.get("assertion-relative-extraction/source-assertion-projection.json") as any[];
  assert.equal(projected.length, 1);
  const persistedResult = harness.artifacts.get("assertion-relative-extraction/source-assertion-persistence-result.json") as any;
  assert.equal(persistedResult.transactionOutcome, "committed");
  assert.equal(persistedResult.failure, null);
  assert.equal(persistedResult.persisted[0].taskClaimId, 11);
  assert.equal(persistedResult.persisted[0].referenceContentId, 20);
});

test("pipeline wiring: no reference_claim_task_links rows are written and no link-suggestion function is invoked", async () => {
  const harness = buildPersistencePipelineHarness();
  await harness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: true,
  });
  const linkSql = harness.sqlCalls.filter(({ sql }) =>
    /INSERT INTO reference_claim_task_links/u.test(sql) || /UPDATE reference_claim_task_links/u.test(sql));
  assert.deepEqual(linkSql, []);
  // The fake runtime never defines buildCfxLinkSuggestionRequest,
  // validateCfxLinkSuggestions, persistCfxLinkSuggestions, or
  // persistAcceptedBearingAssertions -- if the pipeline tried to call any of
  // them, this run would have thrown "is not a function" instead of resolving.
});

test("pipeline wiring: the persistence flag alone (assertionRelativeExtraction off) changes nothing -- legacy bearing path still runs, unmodified", async () => {
  let bearingCallsBaseline = 0;
  const baselineHarness = buildPersistencePipelineHarness();
  await baselineHarness.runPipeline({
    async bearingProcessor() { bearingCallsBaseline += 1; return { status: "completed", providerCalls: 1 }; },
  });

  let bearingCalls = 0;
  const harness = buildPersistencePipelineHarness();
  await harness.runPipeline({
    // assertionRelativeExtraction omitted -- defaults to false.
    assertionRelativeSourceAssertionPersistence: true,
    async bearingProcessor() { bearingCalls += 1; return { status: "completed", providerCalls: 1 }; },
  });
  assert.equal(bearingCalls, 1);
  assert.equal(harness.transactionBegins, baselineHarness.transactionBegins,
    "no additional transaction when assertionRelativeExtraction is off, regardless of the persistence flag");
  const provenanceInsert = harness.sqlCalls.find(({ sql }) => sql.startsWith("INSERT INTO cfx_source_assertion_provenance"));
  assert.equal(provenanceInsert, undefined);
});

test("pipeline wiring: empty accepted rows produce no persistence writes", async () => {
  const baselineHarness = buildPersistencePipelineHarness({ acceptedRows: [] });
  await baselineHarness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: false,
  });

  const harness = buildPersistencePipelineHarness({ acceptedRows: [] });
  const result = await harness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: true,
  });
  assert.equal(harness.transactionBegins, baselineHarness.transactionBegins,
    "an empty projected-rows array must never open the persistence transaction");
  const provenanceInsert = harness.sqlCalls.find(({ sql }) => sql.startsWith("INSERT INTO cfx_source_assertion_provenance"));
  assert.equal(provenanceInsert, undefined);
  assert.equal(result.assertionRelativeExtractionSummary.persistedSourceAssertions, 0);
  const projected = harness.artifacts.get("assertion-relative-extraction/source-assertion-projection.json") as any[];
  assert.deepEqual(projected, []);
});
