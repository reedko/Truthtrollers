import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as productionEvidencePipeline from "../../../src/services/cfxProductionEvidencePipeline.js";
import { aggregateCfxCanonicalDocuments } from "../../../src/claimfoundry/cfx/acquisition/canonicalDocuments.js";
import {
  buildCfxLinkSuggestionRequest,
  cfxLinkSuggestionPromptHash,
  cfxLinkSuggestionSchemaHash,
  validateCfxLinkSuggestions,
} from "../../../src/claimfoundry/cfx/finalLinking/linkSuggestion.js";
import { persistCfxLinkSuggestions, persistCfxSourceAssertions } from "../../../src/claimfoundry/cfx/finalLinking/persistence.js";
import { canonicalHash } from "../../../src/claimfoundry/shared/sourceUnits/index.js";
import type { Cf7StructuredModelRequest, Cf7StructuredProvider } from "../../../src/claimfoundry/shared/provider/index.js";

const { runCfxProductionEvidencePipeline } = productionEvidencePipeline as any;
const runCfxLinkSuggestionForCaseAssertion =
  (productionEvidencePipeline as any).runCfxLinkSuggestionForCaseAssertion;

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

function realRuntimePiece() {
  return {
    buildCfxLinkSuggestionRequest,
    validateCfxLinkSuggestions,
    cfxLinkSuggestionPromptHash,
    cfxLinkSuggestionSchemaHash,
    canonicalHash,
  };
}

function sourceAssertionRow(overrides: Record<string, unknown> = {}) {
  return {
    sourceAssertionId: "SA-1",
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

function linkResultOutput(caseAssertionId: string, linkResults: unknown[]) {
  return { caseAssertionId, linkResults };
}

function memoryArtifacts() {
  const store = new Map<string, unknown>();
  return { store, async write(file: string, value: unknown) { store.set(file, value); } };
}

// -- 1. one case assertion, three source assertions -> one model call ------

test("runCfxLinkSuggestionForCaseAssertion: one batched call carries all supplied source assertions for the case assertion", async () => {
  const sourceAssertions = ["SA-1", "SA-2", "SA-3"].map((id) => sourceAssertionRow({ sourceAssertionId: id }));
  let invocations = 0;
  let capturedRequest: Cf7StructuredModelRequest | null = null;
  const provider: Cf7StructuredProvider = {
    async invokeStructured(request) {
      invocations += 1;
      capturedRequest = request;
      return {
        output: linkResultOutput("P1", sourceAssertions.map((row) => ({
          sourceAssertionId: row.sourceAssertionId, suggestedStance: "support", suggestedScore: 0.8, rationale: "ok",
        }))),
        rawResponse: {}, model: request.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: "resp-1", requestId: "req-1",
      };
    },
  };
  const record = await runCfxLinkSuggestionForCaseAssertion({
    runtime: realRuntimePiece(), provider, model: "gpt-4o-mini",
    caseAssertionId: "P1", caseAssertionText: "The immutable production assertion.",
    sourceAssertions, artifacts: memoryArtifacts(),
  });
  assert.equal(invocations, 1);
  assert.equal(record.approvedSuggestions.length, 3);
  assert.deepEqual(record.approvedSuggestions.map((row: any) => row.sourceAssertionId).sort(), ["SA-1", "SA-2", "SA-3"]);
  assert.ok(capturedRequest);
});

// -- 3/4. insufficient creates no link; support/refute/nuance do -----------

test("runCfxLinkSuggestionForCaseAssertion: insufficient is separated from approved support/refute/nuance decisions, never coerced", async () => {
  const sourceAssertions = ["SA-1", "SA-2", "SA-3", "SA-4"].map((id) => sourceAssertionRow({ sourceAssertionId: id }));
  const provider: Cf7StructuredProvider = {
    async invokeStructured(request) {
      return {
        output: linkResultOutput("P1", [
          { sourceAssertionId: "SA-1", suggestedStance: "support", suggestedScore: 0.9, rationale: "supports" },
          { sourceAssertionId: "SA-2", suggestedStance: "refute", suggestedScore: 0.7, rationale: "refutes" },
          { sourceAssertionId: "SA-3", suggestedStance: "nuance", suggestedScore: 0.4, rationale: "nuances" },
          { sourceAssertionId: "SA-4", suggestedStance: "insufficient", suggestedScore: 0, rationale: "no bearing" },
        ]),
        rawResponse: {}, model: request.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: "resp-1", requestId: "req-1",
      };
    },
  };
  const record = await runCfxLinkSuggestionForCaseAssertion({
    runtime: realRuntimePiece(), provider, model: "gpt-4o-mini",
    caseAssertionId: "P1", caseAssertionText: "The immutable production assertion.",
    sourceAssertions, artifacts: memoryArtifacts(),
  });
  assert.deepEqual(record.approvedSuggestions.map((row: any) => row.sourceAssertionId).sort(), ["SA-1", "SA-2", "SA-3"]);
  assert.deepEqual(record.insufficientSuggestions.map((row: any) => row.sourceAssertionId), ["SA-4"]);
  assert.ok(!record.approvedSuggestions.some((row: any) => row.sourceAssertionId === "SA-4"),
    "insufficient must never appear among approved suggestions");
  assert.ok(!record.approvedSuggestions.some((row: any) => row.suggestedStance === "nuance" && row.sourceAssertionId === "SA-4"),
    "insufficient must never be coerced into nuance");
});

// -- 5/6/7. proven validator fail-closed behaviors --------------------------

test("runCfxLinkSuggestionForCaseAssertion: unknown sourceAssertionId fails closed (rejected, never approved)", async () => {
  const sourceAssertions = [sourceAssertionRow({ sourceAssertionId: "SA-1" })];
  const provider: Cf7StructuredProvider = {
    async invokeStructured(request) {
      return {
        output: linkResultOutput("P1", [
          { sourceAssertionId: "SA-UNKNOWN", suggestedStance: "support", suggestedScore: 0.5, rationale: "x" },
        ]),
        rawResponse: {}, model: request.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: "resp-1", requestId: "req-1",
      };
    },
  };
  const record = await runCfxLinkSuggestionForCaseAssertion({
    runtime: realRuntimePiece(), provider, model: "gpt-4o-mini",
    caseAssertionId: "P1", caseAssertionText: "The immutable production assertion.",
    sourceAssertions, artifacts: memoryArtifacts(),
  });
  assert.deepEqual(record.approvedSuggestions, []);
  assert.ok(record.rejectedRows.some((row: any) =>
    row.reasons.some((reason: any) => reason.code === "UNKNOWN_SOURCE_ASSERTION_ID")));
});

test("runCfxLinkSuggestionForCaseAssertion: duplicate sourceAssertionId decisions fail closed", async () => {
  const sourceAssertions = ["SA-1", "SA-2"].map((id) => sourceAssertionRow({ sourceAssertionId: id }));
  const provider: Cf7StructuredProvider = {
    async invokeStructured(request) {
      return {
        output: linkResultOutput("P1", [
          { sourceAssertionId: "SA-1", suggestedStance: "support", suggestedScore: 0.5, rationale: "x" },
          { sourceAssertionId: "SA-1", suggestedStance: "refute", suggestedScore: 0.5, rationale: "y" },
        ]),
        rawResponse: {}, model: request.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: "resp-1", requestId: "req-1",
      };
    },
  };
  const record = await runCfxLinkSuggestionForCaseAssertion({
    runtime: realRuntimePiece(), provider, model: "gpt-4o-mini",
    caseAssertionId: "P1", caseAssertionText: "The immutable production assertion.",
    sourceAssertions, artifacts: memoryArtifacts(),
  });
  assert.deepEqual(record.approvedSuggestions, []);
  assert.ok(record.rejectedRows.some((row: any) =>
    row.reasons.some((reason: any) => reason.code === "DUPLICATE_SOURCE_ASSERTION_ID")));
});

test("runCfxLinkSuggestionForCaseAssertion: a missing required decision fails closed per the proven validator contract", async () => {
  const sourceAssertions = ["SA-1", "SA-2"].map((id) => sourceAssertionRow({ sourceAssertionId: id }));
  const provider: Cf7StructuredProvider = {
    async invokeStructured(request) {
      return {
        // Only SA-1 gets a decision; SA-2's required decision is missing.
        output: linkResultOutput("P1", [
          { sourceAssertionId: "SA-1", suggestedStance: "support", suggestedScore: 0.5, rationale: "x" },
        ]),
        rawResponse: {}, model: request.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: "resp-1", requestId: "req-1",
      };
    },
  };
  const record = await runCfxLinkSuggestionForCaseAssertion({
    runtime: realRuntimePiece(), provider, model: "gpt-4o-mini",
    caseAssertionId: "P1", caseAssertionText: "The immutable production assertion.",
    sourceAssertions, artifacts: memoryArtifacts(),
  });
  // SA-1 is still individually valid and accepted; the proven validator's
  // contract is per-row acceptance plus a separate MISSING_SOURCE_ASSERTION_ID
  // rejection for the count mismatch -- it does not invalidate SA-1's row.
  assert.deepEqual(record.approvedSuggestions.map((row: any) => row.sourceAssertionId), ["SA-1"]);
  assert.ok(record.rejectedRows.some((row: any) =>
    row.reasons.some((reason: any) => reason.code === "MISSING_SOURCE_ASSERTION_ID")));
});

// -- 10/11. persistCfxLinkSuggestions reused directly: idempotency + fail-closed on verified data --

function inMemoryLinkDatabase() {
  const relations = new Map<string, number>(); // `${content_id}:${reference_content_id}` -> relation id
  const links = new Map<number, Record<string, unknown>>(); // by relation:claim:claim key packed into id map
  const linksByKey = new Map<string, number>();
  let nextId = 5000;
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith("SELECT content_relation_id")) {
      const key = `${values[0]}:${values[1]}`;
      const id = relations.get(key);
      return id ? [{ content_relation_id: id }] : [];
    }
    if (sql.startsWith("INSERT INTO content_relations")) {
      const id = ++nextId;
      relations.set(`${values[0]}:${values[1]}`, id);
      return { insertId: id };
    }
    if (sql.startsWith("SELECT reference_claim_task_links_id,verified_by_user_id")) {
      const key = `${values[0]}:${values[1]}:${values[2]}`;
      const id = linksByKey.get(key);
      if (!id) return [];
      const row = links.get(id)!;
      return [{ reference_claim_task_links_id: id, verified_by_user_id: row.verified_by_user_id }];
    }
    if (sql.startsWith("UPDATE reference_claim_task_links")) {
      const linkId = values[values.length - 1] as number;
      const row = links.get(linkId);
      if (row) {
        row.stance = values[0]; row.support_level = values[1]; row.rationale = values[2];
        if (!row.quote) row.quote = values[3];
      }
      return { affectedRows: row ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO reference_claim_task_links")) {
      const id = ++nextId;
      const [content_relation_id, reference_claim_id, task_claim_id, stance, support_level, rationale, quote] = values;
      links.set(id, { content_relation_id, reference_claim_id, task_claim_id, stance, support_level, rationale, quote, verified_by_user_id: null });
      linksByKey.set(`${content_relation_id}:${reference_claim_id}:${task_claim_id}`, id);
      return { insertId: id };
    }
    if (sql.startsWith("UPDATE cfx_source_assertion_provenance")) {
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  return { query, links, linksByKey, seedVerifiedLink(relationId: number, referenceClaimId: number, taskClaimId: number, verifiedByUserId: number) {
    const id = ++nextId;
    links.set(id, { content_relation_id: relationId, reference_claim_id: referenceClaimId, task_claim_id: taskClaimId, stance: "support", support_level: 1, rationale: "human", quote: "human quote", verified_by_user_id: verifiedByUserId });
    linksByKey.set(`${relationId}:${referenceClaimId}:${taskClaimId}`, id);
    relations.set("10:20", relationId);
    return id;
  } };
}

function persistedSourceAssertionRow(overrides: Record<string, unknown> = {}) {
  return {
    ...sourceAssertionRow(),
    taskClaimId: 11,
    referenceContentId: 20,
    evidenceClaimId: 30,
    claimSourceId: 40,
    persistenceStatus: "inserted" as const,
    ...overrides,
  };
}

test("persistCfxLinkSuggestions: re-running identical approved links is idempotent", async () => {
  const database = inMemoryLinkDatabase();
  const rows = [persistedSourceAssertionRow()];
  const suggestion = { sourceAssertionId: "SA-1", caseAssertionId: "P1", suggestedStance: "support" as const, suggestedScore: 0.8, rationale: "ok", rowIndex: 0 };
  const args = {
    query: database.query, taskContentId: 10, rows, suggestions: [suggestion],
    suggestionRunId: "run-1", suggestionModelCallIds: new Map([["P1", "req-1"]]),
    suggestionPromptHash: "p".repeat(64), suggestionSchemaHash: "s".repeat(64), model: "gpt-4o-mini",
  };
  const first = await persistCfxLinkSuggestions(args);
  const second = await persistCfxLinkSuggestions(args);
  assert.equal(first[0]!.persistenceStatus, "inserted");
  assert.equal(second[0]!.persistenceStatus, "updated");
  assert.equal(first[0]!.referenceClaimTaskLinkId, second[0]!.referenceClaimTaskLinkId);
});

test("persistCfxLinkSuggestions: a human-verified existing link fails closed against a conflicting AI suggestion", async () => {
  const database = inMemoryLinkDatabase();
  const existingLinkId = database.seedVerifiedLink(9001, 30, 11, 777);
  const rows = [persistedSourceAssertionRow({ evidenceClaimId: 30, taskClaimId: 11, referenceContentId: 20 })];
  const suggestion = { sourceAssertionId: "SA-1", caseAssertionId: "P1", suggestedStance: "refute" as const, suggestedScore: 0.9, rationale: "conflicts with verified value", rowIndex: 0 };
  const persisted = await persistCfxLinkSuggestions({
    query: database.query, taskContentId: 10, rows, suggestions: [suggestion],
    suggestionRunId: "run-1", suggestionModelCallIds: new Map([["P1", "req-1"]]),
    suggestionPromptHash: "p".repeat(64), suggestionSchemaHash: "s".repeat(64), model: "gpt-4o-mini",
  });
  assert.equal(persisted[0]!.persistenceStatus, "verified_value_preserved");
  const storedRow = database.links.get(existingLinkId)!;
  assert.equal(storedRow.stance, "support", "the human-verified stance must not be overwritten by the AI suggestion");
});

// -- 2,8,9,12,13,14: full pipeline wiring -----------------------------------

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

async function buildLinkSuggestionPipelineHarness(options: {
  acceptedRowsByProposition?: Record<string, any[]>;
  linkOutputByCase?: Record<string, Array<Record<string, unknown>>>;
} = {}) {
  const acceptedRowsByProposition = options.acceptedRowsByProposition ?? {
    P1: [{
      assertionId: "P1", documentId: "DOC-1", rowIndex: 0,
      exactExcerpt: "Excerpt one.", sourceAssertion: "Source assertion one.",
      relevanceType: "affirms", reason: "r", packetIds: ["PACKET-0001"], blockIds: ["SOURCE-0001"],
      normalizedExcerpt: "excerpt one.", grounding: { mode: "single_packet", packetSpans: [], documentCharStart: 0, documentCharEnd: 12 },
    }],
    P2: [{
      assertionId: "P2", documentId: "DOC-1", rowIndex: 0,
      exactExcerpt: "Excerpt two.", sourceAssertion: "Source assertion two.",
      relevanceType: "affirms", reason: "r", packetIds: ["PACKET-0001"], blockIds: ["SOURCE-0001"],
      normalizedExcerpt: "excerpt two.", grounding: { mode: "single_packet", packetSpans: [], documentCharStart: 0, documentCharEnd: 12 },
    }],
  };

  const claims: Array<{ claim_id: number; claim_text: string; claim_type: string }> = [];
  const contentClaims: Array<{ cc_id: number; content_id: number; claim_id: number }> = [];
  const claimSources: Array<{ claim_source_id: number; claim_id: number; reference_content_id: number }> = [];
  const provenance = new Map<string, Record<string, unknown>>();
  const relations = new Map<string, number>();
  const links = new Map<number, Record<string, unknown>>();
  const linksByKey = new Map<string, number>();
  let nextId = 1000;

  let transactionBegins = 0;
  let transactionCommits = 0;
  let transactionRollbacks = 0;
  let contentRelationCreated = false;
  const events: string[] = [];

  const sqlCalls: Array<{ sql: string; values: unknown[] }> = [];
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
    if (sql.startsWith("SELECT content_relation_id")) {
      const key = `${values[0]}:${values[1]}`;
      const id = relations.get(key);
      if (id) return [{ content_relation_id: id }];
      return contentRelationCreated ? [{ content_relation_id: 30 }] : [];
    }
    if (sql.startsWith("INSERT INTO content_relations")) {
      contentRelationCreated = true;
      const id = relations.get(`${values[0]}:${values[1]}`) ?? 30;
      relations.set(`${values[0]}:${values[1]}`, id);
      return { insertId: id };
    }
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
    if (sql.startsWith("SELECT reference_claim_task_links_id,verified_by_user_id")) {
      const key = `${values[0]}:${values[1]}:${values[2]}`;
      const id = linksByKey.get(key);
      if (!id) return [];
      const row = links.get(id)!;
      return [{ reference_claim_task_links_id: id, verified_by_user_id: row.verified_by_user_id }];
    }
    if (sql.startsWith("UPDATE reference_claim_task_links")) {
      const linkId = values[values.length - 1] as number;
      const row = links.get(linkId);
      if (row) { row.stance = values[0]; row.support_level = values[1]; row.rationale = values[2]; }
      return { affectedRows: row ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO reference_claim_task_links")) {
      const id = ++nextId;
      const [content_relation_id, reference_claim_id, task_claim_id, stance, support_level, rationale, quote] = values;
      links.set(id, { content_relation_id, reference_claim_id, task_claim_id, stance, support_level, rationale, quote });
      linksByKey.set(`${content_relation_id}:${reference_claim_id}:${task_claim_id}`, id);
      return { insertId: id };
    }
    if (sql.startsWith("UPDATE cfx_source_assertion_provenance")) {
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const connection = {
    async beginTransaction() { transactionBegins += 1; events.push("begin-transaction"); },
    async commit() { transactionCommits += 1; events.push("commit"); },
    async rollback() { transactionRollbacks += 1; events.push("rollback"); },
    release() {},
    query,
  };
  const pool = { async getConnection() { return connection; } };

  const candA = sharedIdentityCandidate({ candidateId: "CAND-P1-A", propositionId: "P1", retrievalRank: 1, requestId: "REQ-P1-Q1", query: "assertion one" });
  const candB = sharedIdentityCandidate({ candidateId: "CAND-P2-B", propositionId: "P2", retrievalRank: 1, requestId: "REQ-P2-Q1", query: "assertion two" });

  let acquisitionCalls = 0;
  const linkSuggestionCallCasesInOrder: string[] = [];
  const linkOutputByCase = options.linkOutputByCase ?? {
    P1: [{ sourceAssertionId: "__PLACEHOLDER__", suggestedStance: "support", suggestedScore: 0.8, rationale: "supports" }],
    P2: [{ sourceAssertionId: "__PLACEHOLDER__", suggestedStance: "refute", suggestedScore: 0.6, rationale: "refutes" }],
  };
  const runtime: Record<string, unknown> = {
    aggregateCfxCanonicalDocuments,
    dedupeCfxCandidates(rows: any[]) { return { candidates: rows, audit: [], duplicateCount: 0 }; },
    canonicalHash,
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
    async selectCfxAssertionRelativePackets(input: any) {
      return {
        assertionId: input.assertion.assertionId, documentId: input.document.documentId,
        selectedPackets: [{ packetId: "PACKET-0001", blockIds: ["SOURCE-0001"], charStart: 0, charEnd: 20, text: "stub packet text." }],
        diagnostics: {},
      };
    },
    async runCfxSingleAssertionPacketExtraction(input: any) {
      const acceptedRows = acceptedRowsByProposition[input.assertionId] ?? [];
      return {
        status: "completed", acceptedRows, rejectedRows: [], rawOutput: null,
        requestHash: `hash-${input.assertionId}`, promptHash: "p".repeat(64), schemaHash: "s".repeat(64),
        responseId: "resp", requestId: `extract-req-${input.assertionId}`, model: input.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 }, latencyMs: 1,
        providerCallCount: 1, error: null,
      };
    },
    stableCfxSourceAssertionId(input: any) { return `SA-${input.caseAssertionId}`; },
    persistCfxSourceAssertions,
    buildCfxLinkSuggestionRequest,
    validateCfxLinkSuggestions,
    cfxLinkSuggestionPromptHash,
    cfxLinkSuggestionSchemaHash,
    persistCfxLinkSuggestions,
  };

  const linkSuggestionProvider: Cf7StructuredProvider = {
    async invokeStructured(request) {
      events.push(`model-call:${request.model}`);
      const caseAssertionId = request.user.match(/ASSERTION_ID: (P\d+)/)?.[1] ?? "";
      linkSuggestionCallCasesInOrder.push(caseAssertionId);
      const suppliedIds = [...request.user.matchAll(/\[SOURCE_ASSERTION_ID: (SA-[^\]]+)\]/g)].map((m) => m[1]);
      const template = linkOutputByCase[caseAssertionId] ?? [];
      const linkResults = suppliedIds.map((id, index) => ({ ...(template[index] ?? template[0]), sourceAssertionId: id }));
      return {
        output: linkResultOutput(caseAssertionId, linkResults),
        rawResponse: {}, model: request.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: `link-resp-${caseAssertionId}`, requestId: `link-req-${caseAssertionId}`,
      };
    },
  };

  const artifacts = new Map<string, unknown>();
  const runPipeline = (extra: Record<string, unknown>) => runCfxProductionEvidencePipeline({
    query, pool, taskContentId: 10, claimIds: [11, 12], expectedClaimCount: 2, documentsPerAssertion: 1,
    async schemaPreflight() {}, provider: {}, bearingProvider: {}, retrievalTransport: {},
    linkSuggestionProvider,
    async runtimeLoader() { return runtime; },
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
    ...extra,
  });

  return {
    runPipeline, sqlCalls, artifacts, events, linkSuggestionCallCasesInOrder,
    get acquisitionCalls() { return acquisitionCalls; },
    get transactionBegins() { return transactionBegins; },
    get transactionCommits() { return transactionCommits; },
    get transactionRollbacks() { return transactionRollbacks; },
  };
}

test("pipeline wiring: two case assertions produce two independent model calls, each scoped to its own candidates", async () => {
  const harness = await buildLinkSuggestionPipelineHarness();
  const result = await harness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: true,
    assertionRelativeLinkSuggestion: true,
  });
  assert.deepEqual(harness.linkSuggestionCallCasesInOrder.sort(), ["P1", "P2"]);
  assert.equal(result.assertionRelativeExtractionSummary.linkSuggestionCalls, 2);
  assert.equal(result.assertionRelativeExtractionSummary.approvedLinks, 2, "one support + one refute, no insufficient");
  assert.equal(result.assertionRelativeExtractionSummary.persistedLinks, 2);
});

test("pipeline wiring: model calls occur before the link-persistence transaction opens", async () => {
  const harness = await buildLinkSuggestionPipelineHarness();
  await harness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: true,
    assertionRelativeLinkSuggestion: true,
  });
  const lastBeginIndex = harness.events.lastIndexOf("begin-transaction");
  const modelCallIndices = harness.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.startsWith("model-call:"))
    .map(({ index }) => index);
  assert.ok(modelCallIndices.length >= 2);
  assert.ok(modelCallIndices.every((index) => index < lastBeginIndex),
    "every link-suggestion model call must precede the (final, link-persistence) transaction begin");
});

test("pipeline wiring: link persistence runs in exactly one additional explicit transaction beyond source-assertion persistence", async () => {
  const baseline = await buildLinkSuggestionPipelineHarness();
  await baseline.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: true,
    assertionRelativeLinkSuggestion: false,
  });
  const harness = await buildLinkSuggestionPipelineHarness();
  await harness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: true,
    assertionRelativeLinkSuggestion: true,
  });
  assert.equal(harness.transactionBegins, baseline.transactionBegins + 1);
  assert.equal(harness.transactionCommits, harness.transactionBegins);
  assert.equal(harness.transactionRollbacks, 0);
});

test("pipeline wiring: insufficient decisions produce no reference_claim_task_links row", async () => {
  const harness = await buildLinkSuggestionPipelineHarness({
    linkOutputByCase: {
      P1: [{ sourceAssertionId: "__PLACEHOLDER__", suggestedStance: "insufficient", suggestedScore: 0, rationale: "no bearing" }],
      P2: [{ sourceAssertionId: "__PLACEHOLDER__", suggestedStance: "support", suggestedScore: 0.7, rationale: "supports" }],
    },
  });
  const result = await harness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: true,
    assertionRelativeLinkSuggestion: true,
  });
  assert.equal(result.assertionRelativeExtractionSummary.approvedLinks, 1);
  assert.equal(result.assertionRelativeExtractionSummary.persistedLinks, 1);
  assert.equal(result.assertionRelativeExtractionSummary.insufficientDecisions, 1);
  const linkInserts = harness.sqlCalls.filter(({ sql }) => sql.startsWith("INSERT INTO reference_claim_task_links"));
  assert.equal(linkInserts.length, 1);
});

test("pipeline wiring: rejected extraction rows never reach link suggestion", async () => {
  const harness = await buildLinkSuggestionPipelineHarness({
    acceptedRowsByProposition: {
      P1: [{
        assertionId: "P1", documentId: "DOC-1", rowIndex: 0,
        exactExcerpt: "Excerpt one.", sourceAssertion: "Source assertion one.",
        relevanceType: "affirms", reason: "r", packetIds: ["PACKET-0001"], blockIds: ["SOURCE-0001"],
        normalizedExcerpt: "excerpt one.", grounding: { mode: "single_packet", packetSpans: [], documentCharStart: 0, documentCharEnd: 12 },
      }],
      // P2's only extraction row was rejected upstream (not accepted) -- it
      // never enters acceptedRows, so it can never be projected, persisted,
      // or reach link suggestion.
      P2: [],
    },
  });
  const result = await harness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: true,
    assertionRelativeLinkSuggestion: true,
  });
  assert.deepEqual(harness.linkSuggestionCallCasesInOrder, ["P1"]);
  assert.equal(result.assertionRelativeExtractionSummary.linkSuggestionCalls, 1);
});

test("pipeline wiring: empty provisional source assertions produce zero link-suggestion model calls and zero writes", async () => {
  const harness = await buildLinkSuggestionPipelineHarness({ acceptedRowsByProposition: { P1: [], P2: [] } });
  const result = await harness.runPipeline({
    assertionRelativeExtraction: true,
    assertionRelativeSourceAssertionPersistence: true,
    assertionRelativeLinkSuggestion: true,
  });
  assert.deepEqual(harness.linkSuggestionCallCasesInOrder, []);
  assert.equal(result.assertionRelativeExtractionSummary.persistedSourceAssertions, 0);
  assert.equal(result.assertionRelativeExtractionSummary.persistedLinks, 0);
  const linkInserts = harness.sqlCalls.filter(({ sql }) => sql.startsWith("INSERT INTO reference_claim_task_links"));
  assert.deepEqual(linkInserts, []);
});

test("pipeline wiring: legacy bearing rollback is unchanged -- link-suggestion flag alone (other two gates off) has no effect", async () => {
  let bearingCalls = 0;
  const harness = await buildLinkSuggestionPipelineHarness();
  await harness.runPipeline({
    // assertionRelativeExtraction omitted -- defaults to false.
    assertionRelativeLinkSuggestion: true,
    async bearingProcessor() { bearingCalls += 1; return { status: "completed", providerCalls: 1 }; },
  });
  assert.equal(bearingCalls, 1);
  assert.deepEqual(harness.linkSuggestionCallCasesInOrder, []);
});

// -- Controlled golden replay -----------------------------------------------

test("golden replay: frozen CF1-F03 link-suggestion responses reproduce exact batching, decisions, and approved-link filtering", async () => {
  const root = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03/cfx-final-source-links-20260802144343");
  const sourceClaimInputs = JSON.parse(await readFile(path.join(root, "source-claim-inputs.json"), "utf8")) as any[];
  const rawResponses = JSON.parse(await readFile(path.join(root, "raw-link-model-responses.json"), "utf8")) as any[];

  assert.equal(sourceClaimInputs.length, 14);
  const grouped = new Map<string, any[]>();
  for (const row of sourceClaimInputs) {
    const group = grouped.get(row.caseAssertionId) || [];
    group.push(row);
    grouped.set(row.caseAssertionId, group);
  }
  assert.deepEqual([...grouped.keys()].sort(), ["P54895", "P54897"]);
  assert.equal(grouped.get("P54895")!.length, 8);
  assert.equal(grouped.get("P54897")!.length, 6);

  const responseByCase = new Map(rawResponses.map((row) => [row.parsedOutput.caseAssertionId, row.parsedOutput]));
  let invocationCount = 0;
  const provider: Cf7StructuredProvider = {
    async invokeStructured(request) {
      invocationCount += 1;
      const caseAssertionId = request.user.match(/ASSERTION_ID: (P\d+)/)![1];
      const output = responseByCase.get(caseAssertionId);
      return {
        output, rawResponse: {}, model: request.model,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        responseId: "resp", requestId: "req",
      };
    },
  };

  const records = await Promise.all([...grouped.entries()].map(([caseAssertionId, sourceAssertions]) =>
    runCfxLinkSuggestionForCaseAssertion({
      runtime: realRuntimePiece(), provider, model: "gpt-4o-mini",
      caseAssertionId, caseAssertionText: sourceAssertions[0].caseAssertionText,
      sourceAssertions, artifacts: memoryArtifacts(),
    })));

  assert.equal(invocationCount, 2, "exactly one model call per case assertion");
  const allAccepted = records.flatMap((row) => row.acceptedRows);
  const allApproved = records.flatMap((row) => row.approvedSuggestions);
  const allInsufficient = records.flatMap((row) => row.insufficientSuggestions);
  assert.equal(allAccepted.length, 14, "all 14 frozen decisions validate cleanly");
  assert.equal(allInsufficient.length, 4, "the frozen golden run's 4 insufficient decisions");
  // 14 accepted - 4 insufficient = 10 approved: this seam's explicit
  // filtering requirement, not the old frozen fixture's own behavior (that
  // fixture predates this rule and persisted all 14, including insufficient).
  assert.equal(allApproved.length, 10);
  assert.deepEqual(
    allApproved.map((row: any) => row.sourceAssertionId).sort(),
    sourceClaimInputs
      .filter((row) => {
        const decision = rawResponses
          .flatMap((r) => r.parsedOutput.linkResults)
          .find((d: any) => d.sourceAssertionId === row.sourceAssertionId);
        return decision.suggestedStance !== "insufficient";
      })
      .map((row) => row.sourceAssertionId)
      .sort(),
  );
});
