import path from "node:path";
import dotenv from "dotenv";
import {
  createOpenAiCf7StructuredProvider,
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
  dedupeCfxCandidates,
} from "../retrieval/candidates.js";
import {
  createCfxGatewayRetrievalTransport,
  executeCfxRetrieval,
} from "../retrieval/executeRetrieval.js";
import {
  loadVerifiedCfxEvidenceInputs,
} from "../retrieval/loadEvidenceInputs.js";
import {
  cfxQueryPlanMarkdown,
} from "../retrieval/queryPlanReport.js";
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
} from "../retrieval/types.js";
import {
  CFX_BACKEND_ROOT,
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
  option,
} from "./paths.js";

dotenv.config({ path: path.join(CFX_BACKEND_ROOT, ".env") });

const WEB_PROVIDERS = new Set(["tavily", "brave", "serpapi", "bing"]);

function requireProviderConfiguration(
  webProvider: string,
): asserts webProvider is "tavily" | "brave" | "serpapi" | "bing" {
  if (!WEB_PROVIDERS.has(webProvider)) {
    throw new Error(`Unsupported CFX retrieval web provider ${webProvider}`);
  }
  const configured = {
    tavily: process.env.TAVILY_API_KEY,
    brave: process.env.BRAVE_SEARCH_API_KEY,
    serpapi: process.env.SERPAPI_API_KEY ?? process.env.SERPER_API_KEY,
    bing: process.env.BING_SEARCH_API_KEY ?? process.env.BING_SEARCH_KEY,
  }[webProvider];
  if (!configured) {
    throw new Error(
      `CFX retrieval web provider ${webProvider} is not configured`,
    );
  }
  if (!(process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY)) {
    throw new Error("OpenAI API key is not configured");
  }
}

async function main(): Promise<void> {
  const sourceRun = option("--evidence-handoff-run-dir");
  if (!sourceRun) {
    throw new Error("--evidence-handoff-run-dir is required");
  }
  const webProvider = (
    process.env.CFX_RETRIEVAL_WEB_PROVIDER
      ?? process.env.SEARCH_PROVIDER
      ?? "tavily"
  ).toLocaleLowerCase();
  requireProviderConfiguration(webProvider);
  const verified = await loadVerifiedCfxEvidenceInputs(sourceRun);
  const prompt = await loadCfxQueryPlanningPrompt();
  const generatedAt = new Date().toISOString();
  const runId = `cfx-initial-retrieval-cf1-f03-${cfxTimestamp()}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/CF1-F03",
    runId,
  );
  await createImmutableDirectory(outputDirectory);
  await writeImmutableText(
    path.join(outputDirectory, "evidence_input.json"),
    verified.sourceBytes.toString(),
  );
  const planning = await runCfxQueryPlanning({
    inputs: verified.inputs,
    sourceEvidenceInputHash: verified.inputHash,
    prompt,
    provider: createOpenAiCf7StructuredProvider(),
    async beforeInvoke(request) {
      const requestText = `${JSON.stringify(request, null, 2)}\n`;
      await writeImmutableText(
        path.join(outputDirectory, "requests/planning-model.json"),
        requestText,
      );
      await writeImmutableText(
        path.join(outputDirectory, "requests/planning-model.sha256"),
        `${sha256(requestText)}\n`,
      );
    },
    async afterResponse(response) {
      const rawText = `${JSON.stringify(response.rawResponse, null, 2)}\n`;
      await writeImmutableText(
        path.join(
          outputDirectory,
          "raw-provider-responses/planning-model.json",
        ),
        rawText,
      );
      await writeImmutableText(
        path.join(
          outputDirectory,
          "raw-provider-responses/planning-model.sha256",
        ),
        `${sha256(rawText)}\n`,
      );
      await writeImmutableJson(
        path.join(outputDirectory, "planning-response-metadata.json"),
        {
          responseId: response.responseId,
          requestId: response.requestId,
          usage: response.usage,
          latencyMs: response.latencyMs,
          capturedBeforeValidation: true,
        },
      );
      await writeImmutableJson(
        path.join(outputDirectory, "planning-parsed-response.json"),
        response.parsedOutput,
      );
    },
  });
  await writeImmutableJson(
    path.join(outputDirectory, "query-plan.json"),
    planning.plan,
  );
  await writeImmutableText(
    path.join(outputDirectory, "query-plan-report.md"),
    cfxQueryPlanMarkdown({
      evidenceInputs: verified.inputs,
      plan: planning.plan,
    }),
  );
  const retrieval = await executeCfxRetrieval({
    plan: planning.plan,
    transport: createCfxGatewayRetrievalTransport({
      webProvider,
    }),
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
  for (const evidenceInput of verified.inputs) {
    const result = dedupeCfxCandidates(normalizedCandidates.filter(
      (candidate) => candidate.propositionId === evidenceInput.propositionId,
    ));
    dedupedCandidates.push(...result.candidates);
    dedupeAudit.push(...result.audit);
    duplicateCount += result.duplicateCount;
  }
  const accounting = {
    schemaVersion: "cfx.initialRetrievalAccounting.v1",
    modelRequestCount: 1,
    retrievalRequestCount: retrieval.requestCount,
    retrievalProviderRequestCount: retrieval.providerRequestCount,
    retrievalProviderFailureCount: retrieval.providerFailureCount,
    inputTokens: planning.usage.inputTokens,
    cachedInputTokens: planning.usage.cachedInputTokens,
    outputTokens: planning.usage.outputTokens,
    totalTokens: planning.usage.totalTokens,
    modelLatencyMs: planning.latencyMs,
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
    path.join(outputDirectory, "normalized-candidates.json"),
    normalizedCandidates,
  );
  await writeImmutableJson(
    path.join(outputDirectory, "deduped-candidates.json"),
    {
      candidates: dedupedCandidates,
      duplicateMerges: dedupeAudit,
    },
  );
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
      generatedAt,
      evidenceInputs: verified.inputs,
      queryPlan: planning.plan,
      outcomes: retrieval.outcomes,
      dedupedCandidates,
      dedupeAudit,
      accounting,
    }),
  );
  const status = retrieval.providerFailureCount
    ? "completed_with_provider_failures"
    : "completed";
  const runManifest = {
    schemaVersion: "cfx.initialRetrievalRun.v1",
    runId,
    generatedAt,
    status,
    sourceEvidenceHandoffRunDirectory: path.resolve(sourceRun),
    sourceEvidenceInputHash: verified.inputHash,
    sourceArtifactAggregateSha256: verified.artifactAggregateSha256,
    propositionCount: verified.inputs.length,
    planningModel: planning.model,
    planningProviderCallCount: planning.providerCallCount,
    planningPromptHash: planning.promptHash,
    planningSchemaHash: planning.schemaHash,
    planningRequestHash: planning.requestHash,
    webProvider,
    retrievalRequestCount: retrieval.requestCount,
    retrievalProviderRequestCount: retrieval.providerRequestCount,
    providerFailureCount: retrieval.providerFailureCount,
    rawCandidateCount: normalizedCandidates.length,
    deduplicatedCandidateCount: dedupedCandidates.length,
    fullTextFetchCount: 0,
    bearingJudgmentCount: 0,
    evidenceStanceJudgmentCount: 0,
    candidateScoreCount: 0,
  };
  await writeImmutableJson(
    path.join(outputDirectory, "run-manifest.json"),
    runManifest,
  );
  const files = await hashArtifactTree(outputDirectory);
  const aggregateSha256 = aggregateArtifactHash(files);
  await writeImmutableJson(path.join(outputDirectory, "artifact-hashes.json"), {
    schemaVersion: "cfx.artifactHashes.v1",
    algorithm: "sha256",
    selfExcluded: true,
    files,
    aggregateSha256,
  });
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
