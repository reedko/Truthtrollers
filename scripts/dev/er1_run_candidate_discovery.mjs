#!/usr/bin/env node
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceRetrievalGateway } from "../../backend/src/core/evidenceRetrievalGateway.js";
import { createGatewaySearchAdapter, createMockSearchAdapter } from "../../backend/src/evidence-run/retrievalAdapter.js";
import { runCandidateDiscovery } from "../../backend/src/evidence-run/runCandidateDiscovery.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, "backend/.env") });
const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const boundedInteger = (flag, fallback, maximum) => {
  const raw = value(flag);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    console.error(`${flag} must be an integer from 1 to ${maximum}.`);
    process.exit(2);
  }
  return parsed;
};
const packageArg = value("--package");
if (!packageArg) {
  console.error("Usage: node scripts/dev/er1_run_candidate_discovery.mjs --package <package.json> [--out <dir>] [--role-diverse] [--mock-providers]");
  process.exit(2);
}

function mockResults(request) {
  const slug = request.providerQueryId.slice(-10);
  const target = request.targetId || "identity";
  if (request.laneType === "exact_doi") return [
    { provider: "crossref", providerRank: 1, title: "Age at First Measles-Mumps-Rubella Vaccination in Children With Autism", url: "https://doi.org/10.1542/peds.113.2.259", snippet: "Case-control results for age at first MMR vaccination and autism.", academicMetadata: { doi: "10.1542/peds.113.2.259", venue: "Pediatrics", authors: ["Frank DeStefano"] }, publishedAt: "2004" },
    { provider: "pubmed", providerRank: 2, title: "Age at First Measles-Mumps-Rubella Vaccination in Children With Autism", url: "https://pubmed.ncbi.nlm.nih.gov/14754936/", snippet: "Matched case-control analysis of MMR vaccination timing.", academicMetadata: { doi: "10.1542/peds.113.2.259", pmid: "14754936", venue: "Pediatrics" }, publishedAt: "2004" },
  ];
  return [{ provider: "tavily", providerRank: 1, title: `Candidate for ${target}`,
    url: `https://evidence.example/${target}/${slug}`, snippet: request.query.slice(0, 500), publishedAt: "2024" }];
}

const mock = args.includes("--mock-providers");
const live = args.includes("--live-providers") || !mock;
if (mock && args.includes("--live-providers")) {
  console.error("Choose either --mock-providers or --live-providers, not both.");
  process.exit(2);
}
let gateway;
const searchAdapter = mock
  ? createMockSearchAdapter(mockResults)
  : createGatewaySearchAdapter((gateway = createEvidenceRetrievalGateway()));
if (live && gateway && !Object.values(gateway.status).some((item) => item.enabled && item.configured)) {
  console.error(JSON.stringify({ status: "blocked_missing_provider_config", providers: gateway.status }, null, 2));
  process.exit(3);
}
const retrievalStrategy = { mode: "role_diverse_falsifiability",
  requested: args.includes("--role-diverse") };
const outputDir = path.resolve(root, value("--out") || "artifacts/evidence-run/er1-2a-candidates");
const maxTargets = boundedInteger("--max-targets", 8, 12);
const maxProviderQueriesPerTarget = 5;
const maxIdentityResolutionQueries = 3;
const maxContextWorkQueries = 2;
const maxTargetEvidenceQueriesGlobal = maxTargets * maxProviderQueriesPerTarget;
const discoveryLimits = live ? {
  maxTargets,
  maxProviderQueriesGlobal: maxTargetEvidenceQueriesGlobal +
    maxIdentityResolutionQueries + maxContextWorkQueries,
  maxIdentityResolutionQueries, maxContextWorkQueries,
  maxTargetEvidenceQueriesGlobal, maxProviderQueriesPerTarget,
  maxCandidatesPerQuery: 8, maxCandidatesGlobal: 150, maxCandidatesPerTarget: 25,
  maxSameDomainPerTarget: 4, deadlineMs: 30_000,
} : {};
const result = await runCandidateDiscovery({ packagePath: path.resolve(root, packageArg), outputDir,
  searchAdapter, discoveryLimits,
  idempotencyKey: "er1-candidate-discovery-2a2-live-v1",
  options: { profile: "standard", retrievalStrategy } });
console.log(JSON.stringify({ runId: result.runId, adapter: searchAdapter.kind,
  providerQueries: result.execution.providerQueryCount, rawCandidates: result.rawCandidateCount,
  normalizedCandidates: result.normalized.candidates.length,
  dedupedCandidates: result.dedupe.candidates.length,
  allocatedCandidates: result.scoredCandidates.length, promisingCandidates: result.promisingCount,
  providerCallsSucceeded: result.providerTiming.providerCalls.succeeded,
  providerCallsFailed: result.providerTiming.providerCalls.failed,
  outputDir }, null, 2));
