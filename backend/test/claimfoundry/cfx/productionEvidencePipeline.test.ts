import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as productionEvidencePipeline from "../../../src/services/cfxProductionEvidencePipeline.js";
import { aggregateCfxCanonicalDocuments } from "../../../src/claimfoundry/cfx/acquisition/canonicalDocuments.js";

const {
  assertCfxProductionSchemaReady,
  runCfxProductionEvidencePipeline,
  selectCfxCanonicalDocumentsForRun,
  selectCfxTopRankedDocumentsPerAssertion,
} = productionEvidencePipeline;
const persistCfxAcquiredText = (productionEvidencePipeline as any).persistCfxAcquiredText;
const legacyDocumentQuality = (productionEvidencePipeline as any).legacyDocumentQuality;

test("document quality preserves the legacy trusted-domain boost without a provider call", () => {
  assert.ok(Math.abs(legacyDocumentQuality({
    retrievalScore:0.7,url:"https://pubmed.ncbi.nlm.nih.gov/123/",
  }) - 0.9) < Number.EPSILON);
  assert.equal(legacyDocumentQuality({
    retrievalScore:0.7,url:"https://example.test/paper",
  }), 0.7);
  assert.equal(legacyDocumentQuality({
    retrievalScore:1.1,url:"https://www.nature.com/paper",
  }), 1.2);
});

test("structured academic acquisition reuses production identity and source-quality seams", async () => {
  const sqlCalls: string[] = [];
  const query = async (sql:string) => {
    sqlCalls.push(sql);
    if (sql.startsWith("INSERT INTO cfx_evidence_acquisition_attempts")) return {insertId:61};
    if (sql.startsWith("SELECT acquired_text_version_id")) return [];
    if (sql.startsWith("INSERT INTO cfx_evidence_text_versions")) return {insertId:71};
    if (sql.startsWith("UPDATE cfx_evidence_text_versions")) return {affectedRows:0};
    if (sql.startsWith("UPDATE cfx_evidence_acquisition_bindings")) return {affectedRows:1};
    if (sql.startsWith("UPDATE content SET content_text=")) return {affectedRows:1};
    throw new Error(`unexpected SQL ${sql}`);
  };
  let identityInput:any = null;
  let qualityInput:any = null;
  let crestInput:any = null;
  const result = await persistCfxAcquiredText({
    query,
    bindingRecord: {
      binding: {bindingId:51,requestedUrl:"https://pubmed.ncbi.nlm.nih.gov/123/"},
      referenceContentId:20,
      sourceUrl:"https://pubmed.ncbi.nlm.nih.gov/123/",
    },
    candidate: {
      canonicalUrl:"https://pubmed.ncbi.nlm.nih.gov/123/",
      url:"https://pubmed.ncbi.nlm.nih.gov/123/",
    },
    academic: {
      cleanText:"A complete structured abstract with measured results.",
      retrievalMode:"abstract_only",
      title:"Measured study",
      authors:["Ada Example"],journal:"Example Journal",publisher:"Example Publisher",
      publicationDate:"2020",publishedAt:2020,publicationTypes:["Journal Article"],
      identifiers:{pmid:"123",pmcid:null,doi:"10.1000/example"},issns:[],
    },
    async publishingIdentityProcessor(input:any) {
      identityInput = input;
      return {persistence:{primaryEntityId:88}};
    },
    async sourceQualityEnricher(input:any) { qualityInput = input; return {status:"created"}; },
    async sourceCrestProcessor(input:any) {
      crestInput = input;
      return {status:"production_enriched_and_evaluated",completed:true};
    },
  } as any);
  assert.equal(result.accessLevel, "abstract");
  assert.equal(identityInput.contentId, 20);
  assert.equal(identityInput.identity.entities.publication_venue.name, "Example Journal");
  assert.equal(identityInput.identity.entities.publishing_organization.name, "Example Publisher");
  assert.deepEqual(identityInput.authors, [{name:"Ada Example"}]);
  assert.equal(qualityInput.referenceContentId, 20);
  assert.equal(qualityInput.metadata.publisher, "Example Publisher");
  assert.equal(crestInput.referenceContentId, 20);
  assert.equal(crestInput.publisherId, 88);
  assert.equal(crestInput.publisherName, "Example Publisher");
  assert.equal(result.sourceCrestAttempted, true);
  assert.equal(result.sourceCrestProcessed, true);
  assert.equal(result.sourceCrest.status, "production_enriched_and_evaluated");
  assert.ok(sqlCalls.some((sql) => sql.startsWith("INSERT INTO cfx_evidence_text_versions")));
});

test("production CFX rejects an empty claim set before loading runtime or touching storage", async () => {
  let runtimeLoads = 0;
  await assert.rejects(
    runCfxProductionEvidencePipeline({
      query: async () => { throw new Error("storage must not be touched"); },
      pool: {},
      taskContentId: 10,
      claimIds: [],
      async runtimeLoader() { runtimeLoads += 1; return {}; },
    }),
    /requires at least one canonical claim/u,
  );
  assert.equal(runtimeLoads, 0);
});

test("production schema gate fails before model runtime when Phase 3 is absent", async () => {
  const query = async (sql:string) => sql.includes("information_schema.tables")
    ? [
        {table_name:"cfx_canonical_documents"},
        {table_name:"cfx_canonical_document_identities"},
        {table_name:"cfx_document_discovery_assignments"},
        {table_name:"cfx_evidence_acquisition_bindings"},
        {table_name:"cfx_evidence_text_versions"},
      ]
    : [{column_name:"canonical_document_id"}];
  await assert.rejects(
    assertCfxProductionSchemaReady(query),
    /CFX_PRODUCTION_SCHEMA_NOT_READY: cfx_document_semantic_executions/u,
  );
});

test("production CFX runs against an arbitrary (non-12) claim count by default", async () => {
  // The pipeline was first proven against the 12-proposition CF1-F03 fixture,
  // but nothing about it is structurally 12-specific -- this proves a 1-claim
  // task is no longer rejected now that the fixture-scoped guardrail is gone.
  let runtimeLoads = 0;
  await assert.rejects(
    runCfxProductionEvidencePipeline({
      query: async () => { throw new Error("expected to fail after runtime load, not before"); },
      pool: {},
      taskContentId: 10,
      claimIds: [11],
      async schemaPreflight() {},
      async runtimeLoader() { runtimeLoads += 1; throw new Error("stop after guardrail passes"); },
    }),
    /stop after guardrail passes/u,
  );
  assert.equal(runtimeLoads, 1);
});

test("expectedClaimCount, when explicitly supplied, restores exact-count enforcement", async () => {
  await assert.rejects(
    runCfxProductionEvidencePipeline({
      query: async () => { throw new Error("storage must not be touched"); },
      pool: {},
      taskContentId: 10,
      claimIds: [11],
      expectedClaimCount: 12,
      async runtimeLoader() { throw new Error("must not load runtime"); },
    }),
    /requires exactly 12 canonical claims/u,
  );
});

test("production CFX plans, retrieves, automatically acquires, and runs bounded bearing", async () => {
  const sqlCalls: Array<{sql:string; values:unknown[]}> = [];
  let contentRelationCreated = false;
  const query = async (sql:string, values:unknown[] = []) => {
    sqlCalls.push({sql, values});
    if (sql.includes("FROM claims c") && sql.includes("JOIN content_claims")) return [{
      claim_id: 11,
      claim_text: "The immutable production assertion.",
      object_claim_text: "The immutable production assertion.",
      speaker_entity: "Example Institute",
      content_article_stance: "endorses",
      evaluation_target_id: 12,
      target_order: 0,
      target_text: "The immutable production assertion.",
      source_excerpt: "The source passage contains the immutable production assertion.",
      target_article_stance: "endorses",
      study_title: null,
      study_authors: null,
      study_year: null,
      study_identifier: null,
      population_scope: null,
      query_hints_json: JSON.stringify({primaryQueryText:"legacy query is diagnostic only"}),
    }];
    if (sql.startsWith("SELECT d.canonical_document_id")) return [];
    if (sql.startsWith("INSERT INTO cfx_canonical_documents")) return {insertId:80,affectedRows:1};
    if (sql.startsWith("INSERT INTO cfx_canonical_document_identities")) return {insertId:81,affectedRows:1};
    if (sql.startsWith("UPDATE cfx_canonical_documents")) return {affectedRows:1};
    if (sql.startsWith("INSERT INTO cfx_document_discovery_assignments")) return {insertId:82,affectedRows:1};
    if (sql.startsWith("SELECT canonical_document_id FROM cfx_canonical_documents")) return [{canonical_document_id:80}];
    if (sql.startsWith("SELECT binding_id,scrape_job_id,reference_content_id")) return [];
    if (sql.startsWith("SELECT content_id FROM content")) return [];
    if (/^INSERT INTO content\s*\(/u.test(sql)) return {insertId: 20};
    if (sql.startsWith("SELECT content_relation_id")) {
      return contentRelationCreated ? [{content_relation_id:30}] : [];
    }
    if (sql.startsWith("INSERT INTO content_relations")) {
      contentRelationCreated = true;
      return {insertId: 30};
    }
    if (sql.startsWith("SELECT ref_claim_link_id FROM reference_claim_links")) return [];
    if (sql.startsWith("INSERT INTO reference_claim_links")) return {insertId: 35};
    if (sql.startsWith("INSERT INTO scrape_jobs")) return {insertId: 40};
    if (sql.startsWith("INSERT INTO cfx_evidence_acquisition_bindings")) return {insertId: 50};
    if (sql.startsWith("INSERT INTO cfx_evidence_acquisition_attempts")) return {insertId: 60};
    if (sql.startsWith("SELECT acquired_text_version_id")) return [];
    if (sql.startsWith("INSERT INTO cfx_evidence_text_versions")) return {insertId: 70};
    if (sql.startsWith("UPDATE cfx_evidence_text_versions")) return {affectedRows: 0};
    if (sql.startsWith("UPDATE cfx_evidence_acquisition_bindings")) return {affectedRows: 1};
    if (sql.startsWith("UPDATE content SET content_text=")) return {affectedRows: 1};
    // Re-read after persistCfxAcquiredText's fallback path queues a job via
    // the mocked queueRetry (which does not itself write through this query
    // function) -- reflects the queued job id back for accurate reporting.
    if (sql.startsWith("SELECT scrape_job_id FROM cfx_evidence_acquisition_bindings")) {
      return [{ scrape_job_id: queueRetryCalls ? 40 : null }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, query,
  };
  const pool = { async getConnection() { return connection; } };
  let planningCalls = 0;
  let retrievalCalls = 0;
  let bearingCalls = 0;
  let sourceQualityCalls = 0;
  const candidate = {
    candidateId: "CAND-00000000000000000001",
    propositionId: "P11",
    queryId: "Q1",
    provider: "tavily",
    providerRecordId: "result-1",
    title: "Evidence document",
    authors: [],
    publication: null,
    publicationDate: null,
    doi: null,
    pmid: null,
    url: "https://example.test/evidence",
    canonicalUrl: "https://example.test/evidence",
    resolvedUrl: "https://example.test/evidence",
    abstractOrSnippet: "A bounded provider snippet that may bear on the assertion.",
    sourceType: "web",
    retrievalRank: 1,
    rawArtifactPath: "raw-provider-responses/REQ-P11-Q1.json",
    discoveryPaths: [{
      propositionId:"P11",queryId:"Q1",queryIntent:"canonical",query:"immutable production assertion",
      provider:"tavily",retrievalRank:1,requestId:"REQ-P11-Q1",
    }],
  };
  const deferredCandidate = {
    ...candidate,
    candidateId: "CAND-00000000000000000002",
    providerRecordId: "result-2",
    title: "Deferred evidence document",
    url: "https://example.test/deferred-evidence",
    canonicalUrl: "https://example.test/deferred-evidence",
    resolvedUrl: "https://example.test/deferred-evidence",
    retrievalRank: 2,
    discoveryPaths: [{
      ...candidate.discoveryPaths[0],
      retrievalRank: 2,
    }],
  };
  const runtime = {
    aggregateCfxCanonicalDocuments,
    buildCfxEvidenceSearchHandoff(input:any) {
      assert.equal(input.review.substantiveAssertion, "The immutable production assertion.");
      return {
        groundingText: "[U11]\nThe source passage contains the immutable production assertion.",
        literalIdentifiers: {people:[],organizations:["Example Institute"],laws:[],studyTitles:[],journals:[],years:[],dateRanges:[],doi:[],pmid:[],urls:[],citationNumbers:[],acronyms:[]},
        lookupHints: {populations:[],exposures:[],outcomes:[],interventions:[],geography:[],documentTypes:[],topics:[]},
        queries: {literal:["The immutable production assertion"],sourceQualified:[],studyLookup:[]},
      };
    },
    canonicalHash() { return "a".repeat(64); },
    async loadCfxQueryPlanningPrompt() { return {prompt:"governed",promptHash:"b".repeat(64)}; },
    async runCfxQueryPlanning(input:any) {
      planningCalls += 1;
      await input.beforeInvoke({model:"gpt-4o-mini",messages:[]});
      await input.afterResponse({rawResponse:{id:"plan-1"},responseId:"plan-1",requestId:null,usage:{inputTokens:1,outputTokens:1,totalTokens:2,cachedInputTokens:0},latencyMs:1});
      return {plan:{propositions:[]},providerCallCount:1};
    },
    async executeCfxRetrieval(input:any) {
      retrievalCalls += 1;
      const request = {requestId:"REQ-P11-Q1",propositionId:"P11",queryId:"Q1",queryIntent:"canonical",query:"immutable",provider:"web",topK:5,pubmedFallbacks:[]};
      await input.beforeRequest(request);
      await input.afterResponse({request,response:{results:[candidate,deferredCandidate]},provider:"tavily",providerRequestId:"web-1",latencyMs:1});
      return {outcomes:[{request,candidates:[candidate,deferredCandidate]}],requestCount:1,providerRequestCount:1,providerFailureCount:0};
    },
    dedupeCfxCandidates(rows:any[]) { return {candidates:rows,audit:[],duplicateCount:0}; },
  };
  const artifacts = new Map<string,unknown>();
  let queueRetryCalls = 0;
  const result = await runCfxProductionEvidencePipeline({
    query,
    pool,
    taskContentId: 10,
    claimIds: [11],
    expectedClaimCount: 1,
    documentsPerAssertion: 1,
    async schemaPreflight() {},
    provider: {},
    bearingProvider: {},
    retrievalTransport: {},
    async runtimeLoader() { return runtime; },
    async academicResolver() { return null; },
    async automaticAcquirer() {
      return {
        acquired:true,
        cleanedText:Array.from({length:90}, (_, index) => `substantive evidence sentence ${index}.`).join(" "),
        method:"publisher_html",
        sourceUrl:"https://example.test/evidence",
        resolvedUrl:"https://example.test/evidence",
        contentType:"text/html",
        completeness:"complete",
        attempts:[{method:"axios",status:"success",url:"https://example.test/evidence",resolvedUrl:"https://example.test/evidence",httpStatus:200,contentType:"text/html",characterCount:108,timingMs:1,diagnostic:null,rawResponse:"<article>complete</article>",tier:"normal_platform_scrape"}],
      };
    },
    async queueRetry(input:any) {
      queueRetryCalls += 1;
      assert.equal(input.bindingId, 50);
      return { created: true, scrapeJobId: 40, status: "pending" };
    },
    async sourceQualityEnricher(input:any) {
      sourceQualityCalls += 1;
      assert.equal(input.referenceContentId, 20);
      return {status:"created"};
    },
    async sourceCrestProcessor() { return {status:"identity_pending"}; },
    async publishingIdentityProcessor() { return {persistence:null}; },
    async bearingProcessor(input:any) {
      bearingCalls += 1;
      assert.equal(input.bindingId, 50);
      assert.equal(input.sourceQualityAlreadyProcessed, true);
      assert.equal(input.sourceCrestAlreadyProcessed, true);
      return {status:"completed",providerCalls:1,evidenceAssertionCount:1};
    },
    artifactStoreFactory() {
      return {
        root:"memory/run",
        async initialize() {},
        async write(file:string,value:unknown) { artifacts.set(file,value); },
        async finalize() { return {root:"memory/run",aggregateSha256:"c".repeat(64)}; },
      };
    },
  });
  assert.equal(planningCalls, 1);
  assert.equal(retrievalCalls, 1);
  assert.equal(bearingCalls, 1);
  assert.equal(sourceQualityCalls, 1);
  assert.equal(queueRetryCalls, 0);
  assert.equal(result.queuedScrapeJobs, 0);
  assert.equal(result.targetedBearingProviderCalls, 1);
  assert.equal(result.canonicalDocumentCount, 2);
  assert.equal(result.selectedCanonicalDocumentCount, 1);
  assert.equal(result.deferredCanonicalDocumentCount, 1);
  assert.equal(sqlCalls.filter(({sql}) => /^INSERT INTO content\s*\(/u.test(sql)).length, 1);
  assert.equal(sqlCalls.filter(({sql}) => sql.startsWith("INSERT INTO content_relations")).length, 1);
  assert.equal(sqlCalls.filter(({sql}) => sql.startsWith("INSERT INTO cfx_evidence_acquisition_bindings")).length, 1);
  // Automatic acquisition succeeded, so user-assisted scrape recovery was
  // correctly not queued.
  assert.equal(sqlCalls.some(({sql}) => sql.startsWith("INSERT INTO scrape_jobs")), false);
  assert.equal(sqlCalls.some(({sql}) => /INSERT INTO claim_links\b/u.test(sql)), false);
  assert.equal(artifacts.has("query-planning/request.json"), true);
  assert.equal(artifacts.has("query-planning/raw_response.json"), true);
  assert.equal(artifacts.has("retrieval/responses/REQ-P11-Q1.json"), true);
});

test("production document selection has a deterministic hard ceiling", () => {
  const documents = Array.from({length:25}, (_, index) => ({
    documentKey:`DOC-${String(index).padStart(2,"0")}`,
    canonicalIdentityKind:index % 2 ? "canonical_url" : "pmid",
    discoveryAssignments:[{
      propositionId:`P${index % 12}`,queryId:index % 3 ? "Q4" : "Q5",
      queryIntent:index % 3 ? "independent_evidence" : "qualification",
      provider:index % 2 ? "tavily" : "pubmed",
    }],
  }));
  const selected = selectCfxCanonicalDocumentsForRun(documents, 12);
  assert.equal(selected.length, 12);
  assert.deepEqual(
    selected.map((row:any) => row.documentKey),
    selectCfxCanonicalDocumentsForRun([...documents].reverse(), 12)
      .map((row:any) => row.documentKey),
  );
  assert.throws(() => selectCfxCanonicalDocumentsForRun(documents, 19), /1 through 18/u);
});

test("active production selector reproduces assertion-local top five before union dedupe", () => {
  const inputs = [{propositionId:"P1"},{propositionId:"P2"}];
  const document = (key:string, assignments:any[]) => ({
    documentKey:key,
    representative:{candidateId:`C-${key}`},
    discoveryAssignments:assignments,
  });
  const documents = [
    document("DOC-SHARED", [
      {propositionId:"P1",queryId:"Q1",queryIntent:"canonical",rank:2,candidateId:"C-S1"},
      {propositionId:"P2",queryId:"Q1",queryIntent:"canonical",rank:1,candidateId:"C-S2"},
    ]),
    ...Array.from({length:6}, (_, index) => document(`DOC-P1-${index}`, [{
      propositionId:"P1",queryId:index < 2 ? "Q1" : "Q2",queryIntent:"canonical",
      rank:index + 1,candidateId:`C-P1-${index}`,
    }])),
    ...Array.from({length:5}, (_, index) => document(`DOC-P2-${index}`, [{
      propositionId:"P2",queryId:"Q2",queryIntent:"entity_predicate",
      rank:index + 1,candidateId:`C-P2-${index}`,
    }])),
  ];
  const selected = selectCfxTopRankedDocumentsPerAssertion(inputs, documents, 5);
  assert.equal(selected.policy, "former_assertion_specific_search_rank_top_five");
  assert.equal(selected.perAssertion[0].selected.length, 5);
  assert.equal(selected.perAssertion[1].selected.length, 5);
  assert.equal(selected.perAssertion[0].selected[0].documentKey, "DOC-P1-0");
  assert.equal(selected.perAssertion[0].selected[2].documentKey, "DOC-SHARED");
  assert.equal(selected.perAssertion[1].selected[0].documentKey, "DOC-SHARED");
  assert.equal(selected.documents.length, 9);
  assert.throws(
    () => selectCfxTopRankedDocumentsPerAssertion(inputs, documents, 6),
    /1 through 5/u,
  );
});

test("production evidence route defaults to CFX and keeps legacy behind explicit rollback", async () => {
  const source = await readFile(new URL("../../../src/routes/evidence/evidence.routes.js", import.meta.url), "utf8");
  assert.match(source, /CFX_LEGACY_EVIDENCE_ENABLED === "true"/u);
  assert.match(source, /runCfxProductionEvidencePipeline/u);
  assert.doesNotMatch(source, /CFX_PRODUCTION_EVIDENCE_ENABLED/u);
});
