import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCandidateDiscovery } from "../../src/evidence-run/runCandidateDiscovery.js";
import { createGatewaySearchAdapter, createMockSearchAdapter } from "../../src/evidence-run/retrievalAdapter.js";
import { executeProviderQueries } from "../../src/evidence-run/retrievalCoordinator.js";
import { buildProviderTiming } from "../../src/evidence-run/providerTiming.js";
import { ER1_CANDIDATE_SCHEMA } from "../../src/evidence-run/schemas/candidateSchema.js";
import { ER1_CF1_FIXTURES } from "./fixtures/manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = ER1_CF1_FIXTURES[0];
const packagePath = path.join(root, fixture.relativePath);

function fakeResults(request) {
  const shared = {
    providerRank: 1,
    title: "Age at First Measles-Mumps-Rubella Vaccination in Children With Autism",
    snippet: "Matched case-control results for MMR vaccination timing and autism outcomes.",
    publishedAt: "2004",
    academicMetadata: { doi: "10.1542/peds.113.2.259", venue: "Pediatrics",
      authors: "Frank DeStefano, Tanya Karapurkar Bhasin" },
  };
  if (request.laneType === "exact_doi") return [
    { ...shared, provider: "crossref", url: "https://doi.org/10.1542/peds.113.2.259" },
    { ...shared, provider: "pubmed", providerRank: 2,
      url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
      academicMetadata: { ...shared.academicMetadata, pmid: "14754936" } },
  ];
  if (request.targetId) return [
    { ...shared, provider: "tavily", url: "https://doi.org/10.1542/peds.113.2.259" },
    { provider: "brave", providerRank: 2, title: `Independent candidate ${request.targetId}`,
      url: `https://evidence.example/${request.targetId}`,
      snippet: request.query, publishedAt: "2024" },
  ];
  return [{ provider: "crossref", providerRank: 1, title: request.query,
    url: `https://works.example/${request.providerQueryId}`, snippet: "Bibliographic identity candidate." }];
}

async function runDiscovery(overrides = {}) {
  const calls = [];
  const adapter = createMockSearchAdapter(async (request) => {
    calls.push(request);
    return fakeResults(request);
  });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "er1-2a-"));
  const result = await runCandidateDiscovery({
    packagePath, outputDir, searchAdapter: adapter,
    options: { profile: "standard", balancePolicy: {
      mode: "seek_multiple_bearings", desiredBearing: ["support", "refute", "qualify"],
      minimumIndependentSourcesPerBearing: 1,
    } },
    discoveryLimits: { maxProviderQueriesGlobal: 16, maxProviderQueriesPerTarget: 2,
      maxCandidatesPerQuery: 4, maxCandidatesGlobal: 40, ...overrides },
  });
  return { result, calls, outputDir };
}

test("ER1-2A discovers bounded candidates from the frozen CF1 fixture without forbidden work", async () => {
  const { result, calls, outputDir } = await runDiscovery();
  assert.equal(result.verification.packageId, fixture.packageId);
  assert.equal(calls.length, result.execution.providerQueryCount);
  assert.ok(calls.length <= 16);
  const firstTarget = calls.findIndex((request) => request.targetId);
  assert.ok(firstTarget > 0);
  assert.ok(calls.slice(0, firstTarget).every((request) => request.identityPriority));

  assert.ok(result.normalized.candidates.length <= 40);
  assert.ok(result.scoredCandidates.length < result.normalized.candidates.length);
  const mergedStudy = result.scoredCandidates.find((candidate) =>
    candidate.identifiers.doi.includes("10.1542/peds.113.2.259"));
  assert.ok(mergedStudy);
  assert.deepEqual(mergedStudy.authors,
    ["Frank DeStefano", "Tanya Karapurkar Bhasin"]);
  assert.ok(mergedStudy.routeProvenance.length > 2);
  assert.ok(mergedStudy.targetIds.length > 1);
  assert.ok(mergedStudy.routeProvenance.every((route) => route.provider && route.query && route.reason));
  assert.ok(mergedStudy.retrievalPromiseScore > 0);
  assert.equal("bearingScore" in mergedStudy, false);
  assert.equal("stance" in mergedStudy, false);

  for (const field of ER1_CANDIDATE_SCHEMA.required) assert.ok(field in mergedStudy, field);
  const allowed = new Set(Object.keys(ER1_CANDIDATE_SCHEMA.properties));
  assert.deepEqual(Object.keys(mergedStudy).filter((key) => !allowed.has(key)), []);
  assert.deepEqual(result.state.prohibitedOperations, {
    sourceBodyFetches: 0, scrapes: 0, pdfExtractions: 0, modelCalls: 0,
    databaseReads: 0, databaseWrites: 0, migrations: 0, projections: 0,
  });
  assert.equal(JSON.stringify(result.scoredCandidates).includes("bearingScore"), false);
  assert.equal(JSON.stringify(result.scoredCandidates).includes('"stance"'), false);

  for (const name of ["provider_queries.json", "provider_timing.json", "source_candidates_raw.json",
    "source_candidates_normalized.json", "candidate_dedupe.json", "retrieval_promise.json",
    "candidate_discovery_state.json", "candidate_discovery_trace.json", "run_summary.md",
    "artifact_manifest.json"]) {
    assert.ok(result.manifest.artifacts.some((item) => item.relativePath === name) ||
      name === "artifact_manifest.json");
    await readFile(path.join(outputDir, name), "utf8");
  }
});

test("ER1-2A enforces architectural query and candidate ceilings", async () => {
  const { result, calls } = await runDiscovery({
    maxTargets: 2, maxProviderQueriesGlobal: 3, maxProviderQueriesPerTarget: 1,
    maxCandidatesPerQuery: 1, maxCandidatesGlobal: 2, maxCandidatesPerTarget: 1,
    maxSameDomainPerTarget: 1, deadlineMs: 5_000,
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((request) => request.maxCandidates === 1));
  assert.ok(result.normalized.candidates.length >= result.scoredCandidates.length);
  assert.ok(result.scoredCandidates.length <= 2);
  assert.equal(result.allocation.diagnostics.globalCapAppliedAfterFairAllocation, true);
  assert.ok(result.providerQueries.deferredCount > 0);
  assert.ok(result.providerQueries.selected.every((request) => request.identityPriority));
});

test("ER1-2A deadline stops a slow provider query without accepting candidates", async () => {
  const queryPlan = {
    limits: { concurrency: 1, deadlineMs: 15 },
    selected: [{ providerQueryId: "er1pq_slow", query: "slow", maxCandidates: 8 }],
  };
  const adapter = createMockSearchAdapter(() => new Promise((resolve) =>
    setTimeout(() => resolve([{ url: "https://too-late.example" }]), 40)));
  const execution = await executeProviderQueries({ queryPlan, adapter });
  assert.equal(execution.outcomes[0].status, "deferred_budget");
  assert.equal(execution.outcomes[0].error, "deadline_reached");
  assert.equal(execution.outcomes[0].results.length, 0);
});

test("exact identity search falls back to configured web providers when academic lanes are disabled", async () => {
  let received;
  const adapter = createGatewaySearchAdapter({
    status: { pubmed: { enabled: false, configured: true }, crossref: { enabled: false, configured: true } },
    async web(request) { received = request; return []; },
  });
  await adapter.search({ query: "10.1234/example", maxCandidates: 8, identityPriority: true,
    onlyProviders: ["pubmed", "crossref"] });
  assert.equal(received.includeAcademic, true);
  assert.equal("onlyProviders" in received, false);
});

test("gateway diagnostics preserve live provider outcomes and timing without changing candidates", async () => {
  const adapter = createGatewaySearchAdapter({
    status: { tavily: { enabled: true, configured: true } },
    async web(request) {
      assert.equal(request.returnDiagnostics, true);
      return { results: [{ provider: "tavily", url: "https://example.test/work" }],
        diagnostics: { query: request.query, elapsedMs: 17, resultCount: 1, providers: [
          { provider: "tavily", elapsedMs: 15, rawResultCount: 2,
            normalizedResultCount: 1, skipped: null, error: null },
        ] } };
    },
  });
  const candidates = await adapter.search({ providerQueryId: "er1pq_test", query: "test",
    maxCandidates: 8, identityPriority: false });
  assert.equal(candidates.length, 1);
  assert.equal(adapter.getDiagnostics()[0].providerQueryId, "er1pq_test");
  assert.equal(adapter.getDiagnostics()[0].providers[0].rawResultCount, 2);
});

test("provider timing distinguishes request success from individual provider errors", () => {
  const timing = buildProviderTiming({ outcomes: [
    { status: "ok" }, { status: "deferred_budget" },
  ] }, [{ providers: [
    { provider: "tavily", elapsedMs: 20, rawResultCount: 3, error: null, skipped: null },
    { provider: "openalex", elapsedMs: 10, rawResultCount: 0, error: "HTTP 429", skipped: null },
  ] }]);
  assert.deepEqual(timing.requestQueries, { attempted: 1, succeeded: 1, failed: 0, deferred: 1 });
  assert.deepEqual(timing.providerCalls, { attempted: 2, succeeded: 1, failed: 1, skipped: 0 });
  assert.equal(timing.providers.find((row) => row.provider === "openalex").errors[0], "HTTP 429");
});
