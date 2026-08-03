import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductionCfxStructuredProvider,
  processCfxDocumentEvidenceBinding,
  processCfxEvidenceOutboxOnce,
} from "../../../src/services/cfxEvidenceCoordinator.js";

test("production structured provider preserves the governed zero-retry call budget", async () => {
  let calls = 0;
  let options:any = null;
  const provider = createProductionCfxStructuredProvider({
    async generate(input:any) {
      calls += 1;
      options = input;
      return {output:{ok:true},rawResponse:{id:"one"},usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
    },
  } as any);
  await provider.invokeStructured({
    system:"",user:"test",responseSchema:{schema:{}},temperature:0.1,
    model:"test",maxOutputTokens:100,timeoutMs:1_000,retryCount:0,store:false,
  });
  assert.equal(calls, 1);
  assert.equal(options.maxRetries, 1);
  assert.equal(options.store, false);
});

test("accepted governed document execution is reused without another semantic call", async () => {
  const query = async (sql:string) => {
    if (sql.includes("FROM cfx_evidence_acquisition_bindings b")) return [{
      binding_id:2,run_id:"run-1",canonical_document_id:80,candidate_id:"candidate-1",
      task_content_id:10,target_claim_id:30,reference_content_id:20,
      acquired_text_version_id:40,access_level:"full_text",extraction_method:"pmc",
      source_url:"https://example.test/paper",resolved_url:null,
      cleaned_text:"An immutable complete reference.",character_count:32,word_count:4,
    }];
    if (sql.includes("FROM content_claims cc")) return [{
      claim_id:30,claim_order:1,claim_text:"The immutable target.",
    }];
    throw new Error(`unexpected SQL ${sql}`);
  };
  let semanticCalls = 0;
  let qualityCalls = 0;
  const result = await processCfxDocumentEvidenceBinding({
    bindingId:2,query,pool:{},
    async runtimeLoader() { return {
      async loadCfxDocumentBearingPrompt() { return {prompt:"p",promptHash:"a".repeat(64)}; },
      cfxDocumentBearingTargetInventoryHash() { return "c".repeat(64); },
      cfxDocumentBearingSchemaHash() { return "b".repeat(64); },
      async runCfxDocumentBearingExtraction() { semanticCalls += 1; return {}; },
    }; },
    async executionClaimer() { return {
      status:"reused",executionId:90,processingToken:null,
      acceptedTargetedBearingRunId:50,attemptCount:1,
    }; },
    async sourceQualityEnricher() { qualityCalls += 1; },
    async sourceCrestProcessor() { qualityCalls += 1; },
  });
  assert.equal(result.status, "reused");
  assert.equal(result.providerCalls, 0);
  assert.equal(result.bearingRunId, 50);
  assert.equal(semanticCalls, 0);
  assert.equal(qualityCalls, 0);
});

test("a pre-provider SourceCrest failure releases the claimed semantic execution", async () => {
  const query = async (sql:string) => {
    if (sql.includes("FROM cfx_evidence_acquisition_bindings b")) return [{
      binding_id:2,run_id:"run-1",canonical_document_id:80,candidate_id:"candidate-1",
      task_content_id:10,target_claim_id:30,reference_content_id:20,
      acquired_text_version_id:40,access_level:"full_text",extraction_method:"pmc",
      source_url:"https://example.test/paper",resolved_url:null,
      cleaned_text:"An immutable complete reference.",character_count:32,word_count:4,
    }];
    if (sql.includes("FROM content_claims cc")) return [{
      claim_id:30,claim_order:1,claim_text:"The immutable target.",
    }];
    throw new Error(`unexpected SQL ${sql}`);
  };
  let semanticCalls = 0;
  const finishes:any[] = [];
  await assert.rejects(processCfxDocumentEvidenceBinding({
    bindingId:2,query,pool:{},sourceQualityAlreadyProcessed:true,
    async runtimeLoader() { return {
      async loadCfxDocumentBearingPrompt() { return {prompt:"p",promptHash:"a".repeat(64)}; },
      cfxDocumentBearingTargetInventoryHash() { return "c".repeat(64); },
      cfxDocumentBearingSchemaHash() { return "b".repeat(64); },
      async runCfxDocumentBearingExtraction() { semanticCalls += 1; return {}; },
    }; },
    async executionClaimer() { return {
      status:"claimed",executionId:90,processingToken:"token-1",
      acceptedTargetedBearingRunId:null,attemptCount:1,
    }; },
    async sourceCrestProcessor() { throw new Error("SourceCrest unavailable"); },
    async executionFinisher(_query:any, input:any) { finishes.push(input); },
  }), /SourceCrest unavailable/u);
  assert.equal(semanticCalls, 0);
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].status, "provider_failed");
  assert.equal(finishes[0].executionId, 90);
  assert.equal(finishes[0].processingToken, "token-1");
});

test("multipart document extraction is stopped before claiming or calling a provider", async () => {
  const query = async (sql:string) => {
    if (sql.includes("FROM cfx_evidence_acquisition_bindings b")) return [{
      binding_id:2,run_id:"run-1",canonical_document_id:80,candidate_id:"candidate-1",
      task_content_id:10,target_claim_id:30,reference_content_id:20,
      acquired_text_version_id:40,access_level:"full_text",extraction_method:"pmc",
      source_url:"https://example.test/paper",resolved_url:null,
      cleaned_text:"A long immutable reference.",character_count:27,word_count:4,
    }];
    if (sql.includes("FROM content_claims cc")) return [{
      claim_id:30,claim_order:1,claim_text:"The immutable target.",
    }];
    throw new Error(`unexpected SQL ${sql}`);
  };
  let claimCalls = 0;
  let providerCalls = 0;
  const result = await processCfxDocumentEvidenceBinding({
    bindingId:2,query,pool:{},maximumProviderCalls:1,
    async runtimeLoader() { return {
      async loadCfxDocumentBearingPrompt() { return {prompt:"p",promptHash:"a".repeat(64)}; },
      buildCfxDocumentBearingRequests() { return [{partId:"1"},{partId:"2"}]; },
      async runCfxDocumentBearingExtraction() { providerCalls += 1; return {}; },
    }; },
    async executionClaimer() { claimCalls += 1; return {}; },
  });
  assert.equal(result.status, "multipart_authorization_required");
  assert.equal(result.requestPartCount, 2);
  assert.equal(result.providerCalls, 0);
  assert.equal(claimCalls, 0);
  assert.equal(providerCalls, 0);
});

test("terminal completion executes one document extraction and persists only suggestion/provenance", async () => {
  const calls: Array<{sql:string; values:unknown[]}> = [];
  const query = async (sql:string, values:unknown[] = []) => {
    calls.push({sql, values});
    if (sql.includes("FROM cfx_evidence_terminal_outbox") && sql.includes("FOR UPDATE")) return [{
      outbox_id: 1, binding_id: 2, scrape_job_id: 3,
      terminal_status: "completed", result_content_id: 20,
      error_message: null, payload_json: {},
    }];
    if (sql.includes("FROM cfx_evidence_acquisition_bindings b")) return [{
      binding_id: 2, run_id: "run-1", proposition_id: "P01",
      canonical_document_id: 80,
      candidate_id: "candidate-1", task_content_id: 10,
      target_claim_id: 30, reference_content_id: 20,
      target_assertion: "The immutable target.", acquired_text_version_id: 40,
      access_level: "abstract", extraction_method: "pubmed",
      source_url: "https://example.test/paper", resolved_url: null,
      cleaned_text: "The study reported no association.", character_count: 34,
      word_count: 5,
    }];
    if (sql.includes("FROM content_claims cc")) return [{
      claim_id:30,claim_order:1,claim_text:"The immutable target.",
    }];
    if (sql.startsWith("INSERT INTO cfx_targeted_bearing_runs")) return {insertId: 50};
    if (sql.startsWith("SELECT content_relation_id")) return [{content_relation_id: 60}];
    if (sql.startsWith("SELECT claim_id")) return [];
    if (sql.startsWith("INSERT INTO claims")) return {insertId: 70};
    if (sql.startsWith("SELECT cc_id")) return [];
    if (sql.startsWith("INSERT INTO content_claims")) return {insertId: 71};
    if (sql.startsWith("SELECT claim_source_id")) return [];
    if (sql.startsWith("INSERT INTO claim_sources")) return {insertId: 72};
    if (sql.startsWith("INSERT INTO reference_claim_task_links")) return {affectedRows: 1};
    if (sql.startsWith("SELECT reference_claim_task_links_id")) return [{
      reference_claim_task_links_id: 73, verified_by_user_id: null,
      stance: "refute", score: 90, confidence: 0.8, support_level: -0.72,
    }];
    if (sql.startsWith("INSERT INTO reference_claim_task_link_provenance")) return {insertId: 74};
    if (sql.includes("FROM claim_evaluation_targets")) return [];
    if (sql.startsWith("UPDATE cfx_evidence_terminal_outbox")) return {affectedRows: 1};
    return {affectedRows: 1};
  };
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, query,
  };
  const pool = { async getConnection() { return connection; } };
  let modelCalls = 0;
  let sourceQualityCalls = 0;
  let sourceCrestCalls = 0;
  let executionFinishCalls = 0;
  const result = await processCfxEvidenceOutboxOnce({
    query, pool, provider: {},
    async runtimeLoader() {
      return {
        async loadCfxDocumentBearingPrompt() { return {prompt:"prompt",promptHash:"a".repeat(64)}; },
        cfxDocumentBearingTargetInventoryHash() { return "c".repeat(64); },
        cfxDocumentBearingSchemaHash() { return "b".repeat(64); },
        async runCfxDocumentBearingExtraction(input:any) {
          modelCalls += 1;
          await input.beforeInvoke({model:"gpt-4o-mini",messages:[]});
          await input.afterResponse({rawResponse:{id:"resp-1"},parsedOutput:{},metadata:{responseId:"resp-1"}});
          const assertion = {
            evidenceAssertion: "The study reported no association.",
            bearingRelation: "challenges", exactExcerpt: "reported no association",
            sourceLocation: {charStart:10,charEnd:33,blockId:"E0001"},
            whyItBears: "Direct result.", confidence: 0.8, quality: 0.9,
            limitationsVisibleInText: [],
          };
          return {
            structurallyValid:true,
            acceptedTargets:[{propositionId:"P01",claimId:30,assertions:[assertion]}],
            diagnostics: [], rawOutput: {}, promptHash: "a".repeat(64),
            schemaHash: "b".repeat(64), responseId: "resp-1", model:"gpt-4o-mini",
            usage:{inputTokens:10,outputTokens:5,totalTokens:15,cachedInputTokens:0},
            latencyMs:10,providerCallCount:1,
          };
        },
      };
    },
    async sourceQualityEnricher() {
      sourceQualityCalls += 1;
      return {status:"preserved_existing"};
    },
    async sourceCrestProcessor() {
      sourceCrestCalls += 1;
      return {status:"preserved_existing"};
    },
    async executionClaimer() {
      return {
        status:"claimed",executionId:90,processingToken:"token-1",
        acceptedTargetedBearingRunId:null,attemptCount:1,
      };
    },
    async executionFinisher() { executionFinishCalls += 1; },
  });
  assert.equal(modelCalls, 1);
  assert.equal(sourceQualityCalls, 1);
  assert.equal(sourceCrestCalls, 1);
  assert.equal(executionFinishCalls, 1);
  assert.equal(result.status, "completed");
  assert.equal(result.evidenceAssertionLinkCount, 1);
  assert.equal(calls.some(({sql}) => /INSERT INTO claim_links\b/u.test(sql)), false);
  assert.equal(calls.some(({sql}) => /claim_link_audit/u.test(sql)), false);
});
