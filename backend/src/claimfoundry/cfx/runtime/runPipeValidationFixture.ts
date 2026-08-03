import path from "node:path";
import dotenv from "dotenv";
import {
  createOpenAiCf7StructuredProvider,
  type Cf7StructuredModelRequest,
} from "../../shared/provider/index.js";
import {
  aggregateArtifactHash,
  createImmutableDirectory,
  freezeArtifactTree,
  hashArtifactTree,
  sha256,
  writeImmutableJson,
  writeImmutableText,
} from "../artifacts/immutableArtifacts.js";
import {
  DEFAULT_CFX_DISCOVERY_WITH_UNITS_CONFIG,
  runCfxDiscoveryWithUnits,
} from "../discoveryWithUnits/runDiscoveryWithUnits.js";
import {
  CFX_PIPE_VALIDATION_FIXTURES,
  freezeCfxPipeValidationFixture,
  isCfxPipeValidationFixtureId,
} from "../input/validationFixtures.js";
import {
  loadCfxDiscoveryWithUnitsPrompt,
  loadCfxSubstantiveReviewPrompt,
} from "../prompts/governedPrompts.js";
import {
  dedupeCfxCandidates,
} from "../retrieval/candidates.js";
import {
  createCfxGatewayRetrievalTransport,
  executeCfxRetrieval,
} from "../retrieval/executeRetrieval.js";
import {
  loadCfxQueryPlanningPrompt,
  runCfxQueryPlanning,
} from "../retrieval/queryPlanning.js";
import {
  buildCfxInitialRetrievalReportHtml,
} from "../retrieval/report.js";
import type {
  CfxCandidateDedupeAudit,
  CfxEvidenceCandidate,
  CfxEvidenceInput,
} from "../retrieval/types.js";
import {
  DEFAULT_CFX_SUBSTANTIVE_REVIEW_CONFIG,
  runCfxSubstantiveReview,
} from "../substantiveReview/runSubstantiveReview.js";
import {
  CFX_BACKEND_ROOT,
  CFX_REPOSITORY_ROOT,
  option,
} from "./paths.js";

dotenv.config({ path: path.join(CFX_BACKEND_ROOT, ".env") });

const WEB_PROVIDERS = new Set(["tavily", "brave", "serpapi", "bing"]);

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateEnvironment(
  webProvider: string,
): asserts webProvider is "tavily" | "brave" | "serpapi" | "bing" {
  if (!WEB_PROVIDERS.has(webProvider)) {
    throw new Error(`Unsupported CFX retrieval web provider ${webProvider}`);
  }
  if (!(process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY)) {
    throw new Error("OpenAI API key is not configured");
  }
  const webKey = {
    tavily: process.env.TAVILY_API_KEY,
    brave: process.env.BRAVE_SEARCH_API_KEY,
    serpapi: process.env.SERPAPI_API_KEY ?? process.env.SERPER_API_KEY,
    bing: process.env.BING_SEARCH_API_KEY ?? process.env.BING_SEARCH_KEY,
  }[webProvider];
  if (!webKey) throw new Error(`${webProvider} API key is not configured`);
}

function evidenceInputs(
  rows: NonNullable<
    Awaited<ReturnType<typeof runCfxSubstantiveReview>>["inventory"]
  >["results"],
): CfxEvidenceInput[] {
  return rows.map((row) => {
    const handoff = row.evidenceSearchHandoff;
    if (!handoff) {
      throw new Error(`Missing deterministic handoff for ${row.propositionId}`);
    }
    return {
      propositionId: row.propositionId,
      substantiveAssertion: row.substantiveAssertion,
      assertionSource: row.assertionSource,
      articleStance: row.articleStance,
      groundingUnitIds: handoff.groundingUnitIds,
      groundingText: handoff.groundingText,
      literalIdentifiers: handoff.literalIdentifiers,
      lookupHints: handoff.lookupHints,
      deterministicQueries: {
        literalQuery: handoff.queries.literal[0] ?? null,
        sourceQualifiedQuery: handoff.queries.sourceQualified[0] ?? null,
        studyLookupQueries: handoff.queries.studyLookup,
      },
    };
  });
}

async function captureModelRequest(
  outputDirectory: string,
  stage: string,
  request: Cf7StructuredModelRequest,
): Promise<void> {
  const text = `${JSON.stringify(request, null, 2)}\n`;
  await writeImmutableText(
    path.join(outputDirectory, `requests/${stage}.json`),
    text,
  );
  await writeImmutableText(
    path.join(outputDirectory, `requests/${stage}.sha256`),
    `${sha256(text)}\n`,
  );
}

async function captureModelResponse(
  outputDirectory: string,
  stage: string,
  response: {
    rawResponse: unknown;
    parsedOutput: unknown;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const rawText = `${JSON.stringify(response.rawResponse, null, 2)}\n`;
  await writeImmutableText(
    path.join(outputDirectory, `raw-provider-responses/${stage}.json`),
    rawText,
  );
  await writeImmutableText(
    path.join(outputDirectory, `raw-provider-responses/${stage}.sha256`),
    `${sha256(rawText)}\n`,
  );
  await writeImmutableJson(
    path.join(outputDirectory, `raw-provider-responses/${stage}.metadata.json`),
    response.metadata,
  );
  await writeImmutableJson(
    path.join(outputDirectory, `raw-provider-responses/${stage}.parsed.json`),
    response.parsedOutput,
  );
}

async function main(): Promise<void> {
  const fixtureIdOption = requiredOption("--fixture");
  if (!isCfxPipeValidationFixtureId(fixtureIdOption)) {
    throw new Error(`Unsupported validation fixture ${fixtureIdOption}`);
  }
  const runLabel = requiredOption("--run-label");
  if (runLabel !== "run-a" && runLabel !== "run-b") {
    throw new Error("--run-label must be run-a or run-b");
  }
  const validationId = requiredOption("--validation-id");
  if (!/^[a-zA-Z0-9_-]+$/u.test(validationId)) {
    throw new Error("Invalid --validation-id");
  }
  const webProvider = (
    process.env.CFX_RETRIEVAL_WEB_PROVIDER
      ?? process.env.SEARCH_PROVIDER
      ?? "tavily"
  ).toLocaleLowerCase();
  validateEnvironment(webProvider);

  const article = await freezeCfxPipeValidationFixture(
    CFX_REPOSITORY_ROOT,
    fixtureIdOption,
  );
  const runId = `${fixtureIdOption.toLocaleLowerCase()}-${runLabel}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/pipe-validation",
    validationId,
    fixtureIdOption,
    runId,
  );
  await createImmutableDirectory(outputDirectory);
  await writeImmutableJson(
    path.join(outputDirectory, "s0-source-units.json"),
    article.sourceUnits,
  );

  const provider = createOpenAiCf7StructuredProvider();
  const s1Prompt = await loadCfxDiscoveryWithUnitsPrompt();
  const s1 = await runCfxDiscoveryWithUnits({
    article,
    prompt: s1Prompt,
    provider,
    config: { ...DEFAULT_CFX_DISCOVERY_WITH_UNITS_CONFIG },
    beforeInvoke: (request) =>
      captureModelRequest(outputDirectory, "s1-model", request),
    afterResponse: (response) =>
      captureModelResponse(outputDirectory, "s1-model", response),
  });
  await writeImmutableJson(
    path.join(outputDirectory, "s1-validation.json"),
    { status: s1.status, diagnostics: s1.diagnostics, error: s1.error },
  );
  if (!s1.inventory) {
    throw new Error(`S1 failed for ${runId}`);
  }
  await writeImmutableJson(
    path.join(outputDirectory, "s1-propositions.json"),
    s1.inventory,
  );
  const s1InventoryText = `${JSON.stringify(s1.inventory, null, 2)}\n`;
  const s1InventoryHash = sha256(s1InventoryText);

  const s2Prompt = await loadCfxSubstantiveReviewPrompt();
  const s2 = await runCfxSubstantiveReview({
    article,
    inventory: s1.inventory,
    sourceInventoryHash: s1InventoryHash,
    prompt: s2Prompt,
    provider,
    config: { ...DEFAULT_CFX_SUBSTANTIVE_REVIEW_CONFIG },
    beforeInvoke: (request) =>
      captureModelRequest(outputDirectory, "s2-model", request),
    afterResponse: (response) =>
      captureModelResponse(outputDirectory, "s2-model", response),
  });
  await writeImmutableJson(
    path.join(outputDirectory, "s2-validation.json"),
    { status: s2.status, diagnostics: s2.diagnostics, error: s2.error },
  );
  if (!s2.inventory) {
    throw new Error(`S2 failed for ${runId}`);
  }
  await writeImmutableJson(
    path.join(outputDirectory, "s2-substantive-review.json"),
    {
      schemaVersion: s2.inventory.schemaVersion,
      sourceUnitAwareInventoryHash:
        s2.inventory.sourceUnitAwareInventoryHash,
      results: s2.inventory.results.map((row) => ({
        propositionId: row.propositionId,
        substantiveAssertion: row.substantiveAssertion,
        assertionSource: row.assertionSource,
        articleStance: row.articleStance,
      })),
    },
  );
  const handoffInventory = {
    schemaVersion: "cfx.evidenceSearchHandoff.v2" as const,
    sourceSubstantiveReviewHash: sha256(
      `${JSON.stringify(s2.rawOutput, null, 2)}\n`,
    ),
    results: s2.inventory.results.map((row) => {
      if (!row.evidenceSearchHandoff) {
        throw new Error(`Missing handoff for ${row.propositionId}`);
      }
      return {
        propositionId: row.propositionId,
        substantiveAssertion: row.substantiveAssertion,
        assertionSource: row.assertionSource,
        articleStance: row.articleStance,
        evidenceSearchHandoff: row.evidenceSearchHandoff,
      };
    }),
  };
  await writeImmutableJson(
    path.join(outputDirectory, "deterministic-evidence-handoff.json"),
    handoffInventory,
  );
  const handoffText = `${JSON.stringify(handoffInventory, null, 2)}\n`;
  const inputs = evidenceInputs(s2.inventory.results);

  const planningPrompt = await loadCfxQueryPlanningPrompt();
  const planning = await runCfxQueryPlanning({
    inputs,
    sourceEvidenceInputHash: sha256(handoffText),
    prompt: planningPrompt,
    provider,
    async beforeInvoke(request) {
      await captureModelRequest(outputDirectory, "query-planning-model", request);
    },
    async afterResponse(response) {
      await captureModelResponse(outputDirectory, "query-planning-model", {
        rawResponse: response.rawResponse,
        parsedOutput: response.parsedOutput,
        metadata: {
          responseId: response.responseId,
          requestId: response.requestId,
          usage: response.usage,
          latencyMs: response.latencyMs,
          capturedBeforeValidation: true,
        },
      });
    },
  });
  await writeImmutableJson(
    path.join(outputDirectory, "query-plan.json"),
    planning.plan,
  );

  const retrieval = await executeCfxRetrieval({
    plan: planning.plan,
    transport: createCfxGatewayRetrievalTransport({ webProvider }),
    concurrency: 4,
    async beforeRequest(request) {
      await writeImmutableJson(
        path.join(outputDirectory, `requests/${request.requestId}.json`),
        request,
      );
    },
    async afterResponse(response) {
      await writeImmutableJson(
        path.join(
          outputDirectory,
          `raw-provider-responses/${response.request.requestId}.json`,
        ),
        response.response,
      );
      await writeImmutableJson(
        path.join(
          outputDirectory,
          `raw-provider-responses/${response.request.requestId}.metadata.json`,
        ),
        {
          provider: response.provider,
          providerRequestId: response.providerRequestId,
          latencyMs: response.latencyMs,
          capturedBeforeCandidateNormalization: true,
        },
      );
    },
  });
  const normalizedCandidates = retrieval.outcomes.flatMap(
    (outcome) => outcome.candidates,
  );
  const dedupedCandidates: CfxEvidenceCandidate[] = [];
  const dedupeAudit: CfxCandidateDedupeAudit[] = [];
  let duplicateCount = 0;
  for (const evidenceInput of inputs) {
    const result = dedupeCfxCandidates(normalizedCandidates.filter(
      (candidate) => candidate.propositionId === evidenceInput.propositionId,
    ));
    dedupedCandidates.push(...result.candidates);
    dedupeAudit.push(...result.audit);
    duplicateCount += result.duplicateCount;
  }
  await writeImmutableJson(
    path.join(outputDirectory, "normalized-candidates.json"),
    normalizedCandidates,
  );
  await writeImmutableJson(
    path.join(outputDirectory, "deduped-candidates.json"),
    { candidates: dedupedCandidates, duplicateMerges: dedupeAudit },
  );
  const usage = {
    inputTokens:
      s1.usage.inputTokens + s2.usage.inputTokens + planning.usage.inputTokens,
    cachedInputTokens:
      s1.usage.cachedInputTokens
      + s2.usage.cachedInputTokens
      + planning.usage.cachedInputTokens,
    outputTokens:
      s1.usage.outputTokens
      + s2.usage.outputTokens
      + planning.usage.outputTokens,
    totalTokens:
      s1.usage.totalTokens + s2.usage.totalTokens + planning.usage.totalTokens,
  };
  const accounting = {
    schemaVersion: "cfx.pipeValidationAccounting.v1",
    modelRequestCount: 3,
    retrievalRequestCount: retrieval.requestCount,
    retrievalProviderRequestCount: retrieval.providerRequestCount,
    retrievalProviderFailureCount: retrieval.providerFailureCount,
    ...usage,
    modelLatencyMs: s1.latencyMs + s2.latencyMs + planning.latencyMs,
    retrievalLatencyMs: retrieval.outcomes.reduce(
      (sum, outcome) => sum + outcome.latencyMs,
      0,
    ),
    rawCandidateCount: normalizedCandidates.length,
    deduplicatedCandidateCount: dedupedCandidates.length,
    duplicateCount,
    estimatedCostUsd: null,
  };
  await writeImmutableJson(
    path.join(outputDirectory, "retrieval-accounting.json"),
    accounting,
  );
  await writeImmutableJson(
    path.join(outputDirectory, "pubmed-fallback-attempts.json"),
    retrieval.outcomes
      .filter((outcome) => outcome.provider === "pubmed")
      .map((outcome) => ({
        propositionId: outcome.request.propositionId,
        queryId: outcome.request.queryId,
        attempts: outcome.attempts,
      })),
  );
  await writeImmutableText(
    path.join(outputDirectory, "report.html"),
    buildCfxInitialRetrievalReportHtml({
      runId,
      generatedAt: new Date().toISOString(),
      evidenceInputs: inputs,
      queryPlan: planning.plan,
      outcomes: retrieval.outcomes,
      dedupedCandidates,
      dedupeAudit,
      accounting,
    }),
  );
  const status = retrieval.providerFailureCount === 0
    ? "completed"
    : "completed_with_provider_failures";
  const runManifest = {
    schemaVersion: "cfx.pipeValidationRun.v1",
    validationId,
    runId,
    runLabel,
    fixtureId: fixtureIdOption,
    fixtureRole: CFX_PIPE_VALIDATION_FIXTURES[fixtureIdOption].role,
    status,
    generatedAt: new Date().toISOString(),
    article: {
      title: article.articleTitle,
      fixtureFileSha256: article.fixtureFileSha256,
      articleTextSha256: article.articleTextSha256,
      sourceUnitManifestHash: article.sourceUnitManifestHash,
      sourceUnitCount: article.sourceUnitCount,
    },
    modelCallCount: 3,
    model: planning.model,
    configuration: {
      s1: s1.configuration,
      s2: s2.configuration,
      planning: {
        model: planning.model,
        temperature: 0.1,
        maxOutputTokens: 8_000,
        timeoutMs: 180_000,
        retryCount: 0,
        store: false,
      },
      retrievalConcurrency: 4,
      webProvider,
      resultsPerQuery: 5,
    },
    promptHashes: {
      s1: s1.promptHash,
      s2: s2.promptHash,
      planning: planning.promptHash,
    },
    schemaHashes: {
      s1: s1.schemaHash,
      s2: s2.schemaHash,
      planning: planning.schemaHash,
    },
    propositionCount: s1.inventory.propositions.length,
    retrievalRequestCount: retrieval.requestCount,
    retrievalProviderRequestCount: retrieval.providerRequestCount,
    providerFailureCount: retrieval.providerFailureCount,
    rawCandidateCount: normalizedCandidates.length,
    deduplicatedCandidateCount: dedupedCandidates.length,
    fullTextFetchCount: 0,
    bearingJudgmentCount: 0,
    evidenceStanceJudgmentCount: 0,
    candidateScoreCount: 0,
    usage,
  };
  await writeImmutableJson(
    path.join(outputDirectory, "run-manifest.json"),
    runManifest,
  );
  const files = await hashArtifactTree(outputDirectory);
  const aggregateSha256 = aggregateArtifactHash(files);
  await writeImmutableJson(
    path.join(outputDirectory, "artifact-hashes.json"),
    {
      schemaVersion: "cfx.artifactHashes.v1",
      algorithm: "sha256",
      selfExcluded: true,
      files,
      aggregateSha256,
    },
  );
  await freezeArtifactTree(outputDirectory);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...runManifest,
    artifactAggregateSha256: aggregateSha256,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
