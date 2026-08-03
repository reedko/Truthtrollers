import {
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  createOpenAiCf7StructuredProvider,
} from "../../../shared/provider/index.js";
import {
  aggregateWholeArticleBurdenHash,
  createWholeArticleBurdenDirectory,
  freezeWholeArticleBurdenArtifacts,
  hashWholeArticleBurdenArtifacts,
  sha256,
  writeImmutableJson,
} from "./artifacts.js";
import { loadFrozenWholeArticleFixture } from "./loadFrozenFixture.js";
import { buildWholeArticleBurdenReport } from "./report.js";
import {
  DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG,
  runWholeArticleBurdenExperiment,
} from "./runExperiment.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

function stamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

async function main(): Promise<void> {
  if (!(process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY)) {
    throw new Error("OpenAI API key is not configured");
  }
  const frozen = await loadFrozenWholeArticleFixture({ repositoryRoot });
  const runId = `cf7-whole-article-burden-cf1-f03-${stamp()}`;
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/whole-article-burden/CF1-F03",
    runId,
  );
  await createWholeArticleBurdenDirectory(outputDirectory);
  await writeFile(
    path.join(outputDirectory, "source_article.json"),
    await readFile(frozen.fixturePath),
    { flag: "wx" },
  );
  const result = await runWholeArticleBurdenExperiment({
    frozen,
    provider: createOpenAiCf7StructuredProvider(),
    config: { ...DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG },
    async beforeInvoke(request) {
      await writeImmutableJson(
        path.join(outputDirectory, "request.json"),
        request,
      );
    },
    async afterResponse(response) {
      await writeImmutableJson(
        path.join(outputDirectory, "raw_response.json"),
        response.rawResponse,
      );
      await writeImmutableJson(
        path.join(outputDirectory, "response_metadata.json"),
        response.metadata,
      );
    },
  });
  if (result.error) {
    await writeImmutableJson(
      path.join(outputDirectory, "provider_error.json"),
      result.error,
    );
  }
  await writeImmutableJson(path.join(outputDirectory, "results.json"), {
    runId,
    fixture: frozen.fixture,
    propositions: result.output?.propositions ?? [],
    schemaIssues: result.schemaIssues,
  });
  await writeImmutableJson(path.join(outputDirectory, "usage.json"), {
    expectedRequests: 1,
    completedRequests: result.error ? 0 : 1,
    failedRequests: result.error ? 1 : 0,
    retriedRequests: 0,
    providerCallCount: result.providerCallCount,
    model: result.model,
    responseId: result.responseId,
    providerRequestId: result.requestId,
    usage: result.usage,
    latencyMs: result.latencyMs,
  });
  const manifest = {
    schemaVersion: "cf7.wholeArticleBurdenRunManifest.v1",
    experimentPackageVersion: "1.0",
    runId,
    fixture: frozen.fixture,
    status: result.status,
    fixturePath: frozen.fixturePath,
    fixtureFileSha256: frozen.fixtureFileSha256,
    articleTextSha256: frozen.articleTextSha256,
    articleCharacterCount: frozen.articleCharacterCount,
    expectedProviderCallCount: 1,
    providerCallCount: result.providerCallCount,
    retryCount: 0,
    requestHash: result.requestHash,
    model: result.model,
    configuration: result.configuration,
    articleTextVisible: true,
    fullArticleVisible: true,
    groupingVisible: false,
    subThesisVisible: false,
    selectorOutputsVisible: false,
    evaluatorMaterialsVisible: false,
    propositionCount: result.output?.propositions.length ?? 0,
  };
  await writeImmutableJson(
    path.join(outputDirectory, "manifest.json"),
    manifest,
  );
  const coreFiles = await hashWholeArticleBurdenArtifacts(outputDirectory);
  const coreAggregateSha256 = aggregateWholeArticleBurdenHash(coreFiles);
  const report = buildWholeArticleBurdenReport({
    runId,
    frozen,
    result,
    coreArtifactAggregateSha256: coreAggregateSha256,
  });
  await writeFile(
    path.join(outputDirectory, "results_report.md"),
    report,
    { encoding: "utf8", flag: "wx" },
  );
  const allFiles = await hashWholeArticleBurdenArtifacts(outputDirectory);
  const fullAggregateSha256 = aggregateWholeArticleBurdenHash(allFiles);
  await writeImmutableJson(path.join(outputDirectory, "artifact_hashes.json"), {
    schemaVersion: "cf7.wholeArticleBurdenArtifactHashes.v1",
    algorithm: "sha256",
    selfExcluded: true,
    coreAggregateExcludes: ["results_report.md", "artifact_hashes.json"],
    coreAggregateSha256,
    files: allFiles,
    fullAggregateSha256,
  });
  await freezeWholeArticleBurdenArtifacts(outputDirectory);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...manifest,
    usage: result.usage,
    latencyMs: result.latencyMs,
    coreArtifactAggregateSha256: coreAggregateSha256,
    fullArtifactAggregateSha256: fullAggregateSha256,
    reportSha256: sha256(report),
  }, null, 2)}\n`);
  if (result.status !== "completed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
