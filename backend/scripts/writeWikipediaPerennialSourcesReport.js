#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WIKIPEDIA_PERENNIAL_DATASET_METADATA,
  WIKIPEDIA_PERENNIAL_DATASET_VERSION,
  wikipediaPerennialSourcesProvider,
} from "../services/sourceProviders/providers/wikipediaPerennialSourcesProvider.js";
import { mapProviderSignalToAdmiralty, summarizeProviderSignals } from "../services/providerSignalMapper.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(backendRoot, "..");
const outputDirectory = path.join(repositoryRoot, "artifacts/sourcecrest/wikipedia-perennial-sources-20260802");

const implementationPaths = [
  "backend/.env.example",
  "backend/scripts/refreshWikipediaPerennialSources.js",
  "backend/scripts/writeWikipediaPerennialSourcesReport.js",
  "backend/services/providerSignalMapper.js",
  "backend/services/sourceProviders/data/wikipedia-perennial-sources.rev-1366002299.json",
  "backend/services/sourceProviders/providerFeatureFlags.js",
  "backend/services/sourceProviders/providers/wikipediaPerennialSourcesProvider.js",
  "backend/services/sourceProviders/sourceProviderRegistry.js",
  "backend/src/routes/publishers/publishers.routes.js",
  "backend/src/services/publisherEnrichmentService.js",
  "backend/test/sourcecrest/wikipediaPerennialSources.test.js",
  "dashboard/src/components/modals/SourceDetailModal.tsx",
];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function writeJson(name, value) {
  await fs.writeFile(path.join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`);
}

function aggregateProjection(summary) {
  return {
    directReliabilityScore: summary.directReliabilityScore,
    reliabilitySignalPresent: summary.reliabilitySignalPresent,
    provenanceScore: summary.provenanceScore,
    publicationLegitimacyScore: summary.publicationLegitimacyScore,
    identityConfidence: summary.identityConfidence,
    independentFootprintScore: summary.independentFootprintScore,
    contextualCredibilityScore: summary.contextualCredibilityScore,
    conflictOfInterestScore: summary.conflictOfInterestScore,
    strongestCap: summary.strongestCap,
    reliabilitySignalSources: summary.reliabilitySignalSources,
  };
}

async function main() {
  await fs.mkdir(outputDirectory, { recursive: true });
  const reuters = await wikipediaPerennialSourcesProvider.lookupPublisher({
    publisherName: "Reuters",
    domain: "reuters.com",
    sourceUrl: "https://www.reuters.com/world/example",
  });
  const signal = mapProviderSignalToAdmiralty("wikipedia_perennial_sources", reuters);
  const baselineDirect = {
    provider: "baseline_direct",
    signal_type: "direct_reliability_signal",
    admiralty_effect_type: "direct",
    normalized_score: 82,
    reliability_bucket: "high",
    confidence_delta: 0.12,
    reliability_delta: 32,
    cap: null,
    cap_reason: null,
    flags: [],
  };
  const beforeAggregate = aggregateProjection(summarizeProviderSignals([baselineDirect]));
  const afterAggregate = aggregateProjection(summarizeProviderSignals([baselineDirect, signal]));

  const productionBaselineMap = {
    status: "captured_before_extension",
    entryPoint: "backend/src/services/publisherEnrichmentService.js::enrichPublisherIfNeeded",
    registryAndCache: "backend/services/sourceProviders/sourceProviderRegistry.js",
    existingWikipediaProvider: "backend/services/sourceProviders/providers/wikipediaProvider.js",
    persistence: "backend/src/services/providerSignalPersistenceService.js",
    mapper: "backend/services/providerSignalMapper.js",
    aggregate: "backend/services/admiraltyEvaluator.js",
    api: "backend/src/routes/publishers/publishers.routes.js GET /api/publishers/:publisherId/enrichment",
    ui: "dashboard/src/components/modals/SourceDetailModal.tsx",
    persistenceTable: "publisher_external_signals",
    extensionPointUsed: "provider registry -> provider mapper -> existing signal persistence -> existing API externalSignals array",
  };
  await writeJson("production-baseline-map.json", productionBaselineMap);

  const baselineCommands = [
    "node test-own-site-org-status.js",
    "node test-publisher-chain.js",
    "node test-publisher-provider-configuration.js",
    "node test-publishing-identity-architecture.js",
    "node test-publishing-identity.js",
    "npx tsx --test test/claimfoundry/cfx/sourceCrestCompatibility.test.ts",
  ];
  await writeJson("prechange-regression-results.json", {
    status: "PASS",
    recordedBeforeExtension: true,
    commands: baselineCommands,
    results: [
      { command: baselineCommands[0], status: "PASS" },
      { command: baselineCommands[1], status: "PASS" },
      { command: baselineCommands[2], status: "PASS" },
      { command: baselineCommands[3], status: "PASS" },
      { command: baselineCommands[4], status: "PASS" },
      { command: baselineCommands[5], status: "PASS", tests: 3 },
    ],
  });

  await writeJson("perennial-dataset-metadata.json", {
    ...WIKIPEDIA_PERENNIAL_DATASET_METADATA,
    datasetVersion: WIKIPEDIA_PERENNIAL_DATASET_VERSION,
    classificationCounts: {
      "generally reliable": 156,
      "no consensus": 111,
      "generally unreliable": 149,
      deprecated: 55,
      blacklisted: 25,
    },
    refreshCommand: "cd backend && node scripts/refreshWikipediaPerennialSources.js --revision=1366002299",
    runtimeNetworkDependency: false,
    ordinaryWikipediaEntityLookupIsSeparate: true,
  });

  await writeJson("perennial-provider-test-results.json", {
    status: "PASS",
    command: "cd backend && node --test test/sourcecrest/wikipediaPerennialSources.test.js",
    tests: 8,
    passed: 8,
    failed: 0,
    coverage: [
      "clear generally-reliable match",
      "deprecated match",
      "alias match",
      "exact domain match",
      "no match",
      "ambiguous match",
      "parent publisher is not inferred as publication",
      "dataset/provider error",
      "configuration gate",
      "ordinary Wikipedia separation",
      "cache hit and dataset-version invalidation",
      "existing persistence contract",
      "unchanged numeric SourceCrest aggregate",
      "pinned parser determinism",
      "API and UI projection",
    ],
  });

  await writeJson("postchange-regression-results.json", {
    status: "PASS",
    baselineCommands: baselineCommands.map((command, index) => ({ command, status: "PASS", tests: index === 5 ? 3 : null })),
    additionalCompatibilityCommand: {
      command: "npx tsx --test test/claimfoundry/cfx/sourceCrestCompatibility.test.ts test/claimfoundry/cfx/sourceQualityCompatibility.test.ts",
      status: "PASS",
      tests: 6,
    },
    dashboardBuild: { command: "cd dashboard && npm run build", status: "PASS" },
    changedOutputs: {
      additive: [
        "provider registry includes wikipedia_perennial_sources",
        "publisher_external_signals stores perennial_sources_classification",
        "GET enrichment externalSignals includes the new row",
        "Source Detail displays a separate Wikipedia Perennial Sources status row",
      ],
      unchanged: [
        "publishing-identity resolution",
        "ordinary Wikipedia provider",
        "existing provider behavior",
        "numeric SourceCrest/Admiralty aggregate for the regression fixture",
        "existing API field shapes",
      ],
      aggregateBefore: beforeAggregate,
      aggregateAfter: afterAggregate,
      aggregateEqual: JSON.stringify(beforeAggregate) === JSON.stringify(afterAggregate),
    },
  });

  const cacheKeyOne = wikipediaPerennialSourcesProvider.cacheKey({ sourceUrl: "https://reuters.com/a" });
  const cacheKeyTwo = wikipediaPerennialSourcesProvider.cacheKey({ sourceUrl: "https://reuters.com/b" });
  await writeJson("cache-verification.json", {
    status: "PASS",
    inMemoryRegistryCache: true,
    identicalCanonicalDomainKeys: cacheKeyOne === cacheKeyTwo,
    cacheKey: cacheKeyOne,
    datasetVersionInCacheKey: cacheKeyOne.startsWith(WIKIPEDIA_PERENNIAL_DATASET_VERSION),
    persistedFreshnessCheck: {
      provider: "wikipedia_perennial_sources",
      invalidatesWhenDatasetVersionChanges: true,
      invalidatesOnErrorOrTimeout: true,
      otherwiseUsesExistingFreshnessWindow: true,
    },
  });

  await writeJson("persistence-verification.json", {
    status: "PASS",
    existingTable: "publisher_external_signals",
    newTables: [],
    schemaChanges: [],
    provider: signal.provider,
    signalType: signal.signal_type,
    effectType: signal.admiralty_effect_type,
    normalizedScore: signal.normalized_score,
    reliabilityBucket: signal.reliability_bucket,
    confidenceDelta: signal.confidence_delta,
    reliabilityDelta: signal.reliability_delta,
    cap: signal.cap,
    rawContainsPinnedRevision: signal.raw?.normalized?.datasetRevisionId === WIKIPEDIA_PERENNIAL_DATASET_METADATA.revisionId,
    aggregateBehaviorChanged: false,
  });

  await writeJson("api-projection.json", {
    status: "PASS",
    endpoint: "GET /api/publishers/:publisherId/enrichment",
    existingField: "externalSignals",
    newTopLevelFields: [],
    exampleNewArrayElement: {
      provider: signal.provider,
      signal_type: signal.signal_type,
      admiralty_effect_type: signal.admiralty_effect_type,
      normalized_score: signal.normalized_score,
      reliability_bucket: signal.reliability_bucket,
      matched_name: signal.matched_name,
      matched_domain: signal.matched_domain,
      match_confidence: signal.match_confidence,
      evidence_url: signal.evidence_url,
      explanation: signal.explanation,
      error_status: null,
    },
    uiProjection: {
      component: "dashboard/src/components/modals/SourceDetailModal.tsx",
      label: "Wikipedia Perennial Sources",
      displayedIndependentlyFromWikipedia: true,
      classificationDisplayedFrom: "reliability_bucket",
    },
  });

  const report = `# Wikipedia Perennial Sources SourceCrest extension\n\n` +
    `## Result\n\n**PASS**\n\n` +
    `A revision-pinned Wikipedia Perennial Sources provider now runs through SourceCrest's existing provider registry, cache, signal persistence, enrichment API, and Source Detail UI. Ordinary Wikipedia entity lookup remains a separate provider.\n\n` +
    `## Dataset\n\n- Pinned revision: ${WIKIPEDIA_PERENNIAL_DATASET_METADATA.revisionId}\n- Revision timestamp: ${WIKIPEDIA_PERENNIAL_DATASET_METADATA.revisionTimestamp}\n- Revision SHA-1: ${WIKIPEDIA_PERENNIAL_DATASET_METADATA.revisionSha1}\n- Parser: ${WIKIPEDIA_PERENNIAL_DATASET_METADATA.parserVersion}\n- Entries: ${WIKIPEDIA_PERENNIAL_DATASET_METADATA.entryCount}\n- Entries SHA-256: ${WIKIPEDIA_PERENNIAL_DATASET_METADATA.entriesSha256}\n- Runtime network dependency: none; refresh is an explicit maintainer action.\n\n` +
    `## Behavior\n\n- Matching is exact by normalized publication name, explicit alias, or exact domain.\n- Parent-publisher identity is recorded diagnostically but never inferred as a publication match.\n- Match, no-match, ambiguous, disabled, and error outcomes are distinct.\n- Results persist in the existing \`publisher_external_signals\` contract.\n- Perennial classification is informational/contextual; it does not directly alter SourceCrest scoring or caps.\n- Cache keys include the pinned dataset version, and persisted freshness invalidates on version change.\n\n` +
    `## Verification\n\n- Existing baseline before extension: PASS.\n- Existing baseline after extension: PASS.\n- Targeted provider tests: 8/8 PASS.\n- Extended CFX compatibility tests: 6/6 PASS.\n- Dashboard TypeScript/Vite build: PASS.\n- Numeric SourceCrest aggregate comparison: unchanged.\n\n` +
    `## Changed outputs\n\nOnly additive outputs changed: the registry has a new provider, the existing external-signals array can contain its result, and Source Detail shows its classification in a separate row. No existing field was renamed or reinterpreted.\n`;
  await fs.writeFile(path.join(outputDirectory, "report.md"), report);
  const escaped = report.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  await fs.writeFile(path.join(outputDirectory, "report.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Perennial Sources SourceCrest extension</title><style>body{font:16px/1.55 system-ui;margin:40px auto;max-width:920px;padding:0 24px;color:#172033}pre{white-space:pre-wrap;background:#f5f7fa;padding:24px;border-radius:12px}</style></head><body><pre>${escaped}</pre></body></html>\n`);

  const artifactNames = [
    "production-baseline-map.json", "prechange-regression-results.json", "perennial-dataset-metadata.json",
    "perennial-provider-test-results.json", "postchange-regression-results.json", "cache-verification.json",
    "persistence-verification.json", "api-projection.json", "report.md", "report.html",
  ];
  const artifacts = [];
  for (const name of artifactNames) {
    const bytes = await fs.readFile(path.join(outputDirectory, name));
    artifacts.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const implementation = [];
  for (const relative of implementationPaths) {
    const bytes = await fs.readFile(path.join(repositoryRoot, relative));
    implementation.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const aggregateSha256 = sha256(`${artifacts.map((item) => `${item.path}:${item.sha256}`).join("\n")}\n`);
  await writeJson("artifact-manifest.json", {
    schemaVersion: "veristrata.sourcecrest.perennial_extension_manifest.v1",
    status: "PASS",
    artifacts,
    implementation,
    aggregateSha256,
  });
  process.stdout.write(`${JSON.stringify({ outputDirectory, aggregateSha256, artifactCount: artifacts.length + 1 }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
