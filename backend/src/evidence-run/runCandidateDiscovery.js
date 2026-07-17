import { ER1_REQUEST_SCHEMA_VERSION } from "./contract.js";
import { er1RunId } from "./ids.js";
import { loadCf1PackageFile } from "./packageLoader.js";
import { buildTargetPortfolio } from "./targetPortfolio.js";
import { buildIdentityRegistry } from "./identityRegistry.js";
import { buildQueryLanePlan } from "./queryPlanner.js";
import { buildProviderQueries, executeProviderQueries } from "./retrievalCoordinator.js";
import { dedupeCandidates, normalizeProviderOutcomes, scoreRetrievalPromise } from "./candidateTriage.js";
import { allocateCandidatesFairly } from "./candidateAllocator.js";
import { writeOfflineArtifacts } from "./artifacts.js";
import { buildProviderTiming } from "./providerTiming.js";

function summary(result) {
  return `# ER1-2A candidate discovery\n\n` +
    `- Run: ${result.runId}\n- Package: ${result.verification.packageId}\n` +
    `- Provider query requests executed: ${result.execution.providerQueryCount}\n` +
    `- Provider calls succeeded/failed: ${result.providerTiming.providerCalls.succeeded}/${result.providerTiming.providerCalls.failed}\n` +
    `- Raw provider candidates: ${result.rawCandidateCount}\n` +
    `- Normalized candidates: ${result.normalized.candidates.length}\n` +
    `- Globally deduplicated candidates: ${result.dedupe.candidates.length}\n` +
    `- Fairly allocated candidates: ${result.scoredCandidates.length}\n` +
    `- Promising candidates: ${result.promisingCount}\n\n` +
    `Candidate discovery only. No source body fetch, scrape, PDF extraction, model call, ` +
    `database read or write, migration, projection, assertion extraction, stance, or evidence assessment occurred.\n\n` +
    `All pre-fetch scores are retrievalPromiseScore/preFetchTargetFit candidate-triage signals. ` +
    `No bearingScore field was produced.\n`;
}

export async function runCandidateDiscovery({ packagePath, outputDir, searchAdapter,
  expected = {}, options = {}, discoveryLimits = {}, idempotencyKey = "er1-candidate-discovery-v1" }) {
  if (!searchAdapter || typeof searchAdapter.search !== "function") {
    throw new TypeError("runCandidateDiscovery requires a searchAdapter");
  }
  const startedAt = Date.now();
  const { packageValue, verification } = await loadCf1PackageFile(packagePath, expected);
  const runId = er1RunId(packageValue.packageId, idempotencyKey);
  const request = {
    schemaVersion: ER1_REQUEST_SCHEMA_VERSION, packageId: packageValue.packageId,
    expectedPackageSchemaVersion: packageValue.schemaVersion,
    expectedPackageHash: packageValue.packageHash, idempotencyKey,
    options: { profile: options.profile || "standard", ...options }, discoveryLimits,
  };
  const portfolio = buildTargetPortfolio(packageValue);
  const identityRegistry = buildIdentityRegistry(packageValue);
  const lanePlan = buildQueryLanePlan({ packageValue, portfolio, identityRegistry, options: request.options });
  const providerQueries = buildProviderQueries(lanePlan, portfolio, discoveryLimits);
  const execution = await executeProviderQueries({ queryPlan: providerQueries, adapter: searchAdapter, startedAt });
  const providerTiming = buildProviderTiming(execution, searchAdapter.getDiagnostics?.() || []);
  const rawCandidateCount = execution.outcomes.reduce((sum, outcome) => sum + outcome.results.length, 0);
  const normalized = normalizeProviderOutcomes({ runId, packageId: packageValue.packageId,
    outcomes: execution.outcomes, portfolio, identityRegistry, limits: providerQueries.limits });
  const dedupe = dedupeCandidates(normalized.candidates, runId);
  const scored = dedupe.candidates.map((candidate) =>
    scoreRetrievalPromise(candidate, portfolio, identityRegistry));
  const allocation = allocateCandidatesFairly(scored, providerQueries.limits);
  const scoredCandidates = allocation.candidates;
  const promisingCount = scoredCandidates.filter((x) => x.preFetchStatus === "promising").length;
  const events = execution.events.map((event) => ({ ...event, runId, packageId: packageValue.packageId }));
  for (const candidate of scoredCandidates) events.push({
    sequence: events.length + 1, type: "candidate_found", at: new Date().toISOString(),
    runId, packageId: packageValue.packageId, candidateId: candidate.candidateId,
    preFetchStatus: candidate.preFetchStatus,
  });
  const state = {
    schemaVersion: "er1.candidateDiscoveryState.v1", runId, packageId: packageValue.packageId,
    status: "candidate_discovery_complete", providerAdapter: searchAdapter.kind || "injected",
    providerQueryCount: execution.providerQueryCount,
    providerQuerySucceeded: providerTiming.requestQueries.succeeded,
    providerQueryFailed: providerTiming.requestQueries.failed,
    providerCallSucceeded: providerTiming.providerCalls.succeeded,
    providerCallFailed: providerTiming.providerCalls.failed,
    rawCandidateCount,
    normalizedCandidateCount: normalized.candidates.length,
    dedupedCandidateCount: dedupe.candidates.length,
    allocatedCandidateCount: scoredCandidates.length, promisingCount,
    candidateAllocation: allocation.diagnostics,
    budgets: providerQueries.limits, elapsedMs: Date.now() - startedAt,
    prohibitedOperations: { sourceBodyFetches: 0, scrapes: 0, pdfExtractions: 0,
      modelCalls: 0, databaseReads: 0, databaseWrites: 0, migrations: 0, projections: 0 },
  };
  const trace = { schemaVersion: "er1.candidateDiscoveryTrace.v1", runId,
    packageId: packageValue.packageId, events, providerTimings: execution.outcomes.map((x) => ({
      providerQueryId: x.request.providerQueryId, status: x.status, elapsedMs: x.elapsedMs,
      resultCount: x.results.length, error: x.error || null,
    })), prohibitedOperations: state.prohibitedOperations };
  const result = { runId, request, verification, portfolio, identityRegistry, lanePlan,
    providerQueries, execution, providerTiming, rawCandidateCount, normalized, dedupe, allocation,
    scoredCandidates,
    promisingCount, state, trace, outputDir };
  const raw = execution.outcomes.flatMap((outcome) => outcome.results.map((candidate) => ({
    providerQueryId: outcome.request.providerQueryId, queryLaneIds: outcome.request.queryLaneIds,
    targetId: outcome.request.targetId, identityBundleId: outcome.request.identityBundleId,
    candidate,
  })));
  const artifactValues = [
    ["input_request", "input_request.json", request],
    ["package_verification", "package_verification.json", verification],
    ["target_portfolio", "target_portfolio.json", portfolio],
    ["identity_registry", "identity_registry.json", identityRegistry],
    ["query_lane_plan", "query_lane_plan.json", lanePlan],
    ["provider_queries", "provider_queries.json", providerQueries],
    ["provider_timing", "provider_timing.json", providerTiming],
    ["source_candidates_raw", "source_candidates_raw.json", { count: raw.length, candidates: raw }],
    ["source_candidates_normalized", "source_candidates_normalized.json", normalized],
    ["candidate_dedupe", "candidate_dedupe.json", { count: dedupe.candidates.length,
      duplicateCount: dedupe.duplicateCount, candidates: dedupe.candidates, groups: dedupe.audit }],
    ["retrieval_promise", "retrieval_promise.json", { count: scoredCandidates.length,
      candidates: scoredCandidates, allocation: allocation.diagnostics,
      discardedCandidates: allocation.discarded }],
    ["candidate_discovery_state", "candidate_discovery_state.json", state],
    ["candidate_discovery_trace", "candidate_discovery_trace.json", trace],
  ].map(([name, fileName, value]) => ({ name, fileName, value,
    stage: "candidate_discovery", mediaType: "application/json" }));
  artifactValues.push({ name: "run_summary", fileName: "run_summary.md", value: summary(result),
    stage: "candidate_discovery", mediaType: "text/markdown" });
  result.manifest = await writeOfflineArtifacts({ outputDir, runId,
    packageId: packageValue.packageId, artifacts: artifactValues });
  return result;
}
