import { readFile } from "node:fs/promises";
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
  DEFAULT_CFX_DISCOVERY_CONFIG,
  runCfxDiscovery,
} from "../discovery/runDiscovery.js";
import { freezeCfxF03 } from "../input/f03.js";
import { loadCfxDiscoveryPrompt } from "../prompts/governedPrompts.js";
import {
  CFX_BACKEND_ROOT,
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
} from "./paths.js";

dotenv.config({ path: path.join(CFX_BACKEND_ROOT, ".env") });

async function main(): Promise<void> {
  if (!(process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY)) {
    throw new Error("OpenAI API key is not configured");
  }
  const article = await freezeCfxF03(CFX_REPOSITORY_ROOT);
  const prompt = await loadCfxDiscoveryPrompt();
  const runId = `cfx-s1-cf1-f03-${cfxTimestamp()}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/CF1-F03",
    runId,
  );
  await createImmutableDirectory(outputDirectory);
  await writeImmutableText(
    path.join(outputDirectory, "s0/source_article.json"),
    (await readFile(article.fixturePath)).toString(),
  );
  await writeImmutableJson(
    path.join(outputDirectory, "s0/source_units.json"),
    article.sourceUnits,
  );
  await writeImmutableJson(path.join(outputDirectory, "s0/manifest.json"), {
    fixtureId: article.fixtureId,
    fixtureFileSha256: article.fixtureFileSha256,
    articleTextSha256: article.articleTextSha256,
    normalizedArticleHash: article.normalizedArticleHash,
    sourceUnitManifestHash: article.sourceUnitManifestHash,
    sourceUnitCount: article.sourceUnitCount,
    unitProjectionSha256: article.unitProjectionSha256,
  });
  const requestDirectory = path.join(
    outputDirectory,
    "s1-discovery/request-001",
  );
  const result = await runCfxDiscovery({
    article,
    prompt,
    provider: createOpenAiCf7StructuredProvider(),
    config: { ...DEFAULT_CFX_DISCOVERY_CONFIG },
    async beforeInvoke(request) {
      const requestText = `${JSON.stringify(request, null, 2)}\n`;
      await writeImmutableText(
        path.join(requestDirectory, "request.json"),
        requestText,
      );
      await writeImmutableText(
        path.join(requestDirectory, "request_hash.txt"),
        `${sha256(requestText)}\n`,
      );
    },
    async afterResponse(response) {
      const rawText = `${JSON.stringify(response.rawResponse, null, 2)}\n`;
      await writeImmutableText(
        path.join(requestDirectory, "raw_response.json"),
        rawText,
      );
      await writeImmutableText(
        path.join(requestDirectory, "raw_response_hash.txt"),
        `${sha256(rawText)}\n`,
      );
      await writeImmutableJson(
        path.join(requestDirectory, "response_metadata.json"),
        response.metadata,
      );
      await writeImmutableJson(
        path.join(requestDirectory, "parsed_response.json"),
        response.parsedOutput,
      );
    },
  });
  await writeImmutableJson(
    path.join(requestDirectory, "validation.json"),
    {
      status: result.status === "completed" ? "PASS" : "FAIL",
      violations: result.diagnostics,
    },
  );
  await writeImmutableJson(
    path.join(requestDirectory, "diagnostics.json"),
    result.diagnostics,
  );
  if (result.error) {
    await writeImmutableJson(
      path.join(requestDirectory, "provider_error.json"),
      result.error,
    );
  }
  if (result.canonicalInventory) {
    await writeImmutableJson(
      path.join(outputDirectory, "canonical_propositions.json"),
      result.canonicalInventory,
    );
  }
  const manifest = {
    schemaVersion: "cfx.s1RunManifest.v1",
    runId,
    fixtureId: article.fixtureId,
    status: result.status,
    providerCallCount: result.providerCallCount,
    retryCount: 0,
    promptId: prompt.promptId,
    promptHash: result.promptHash,
    schemaHash: result.schemaHash,
    requestHash: result.requestHash,
    model: result.model,
    configuration: result.configuration,
    canonicalInventoryHash: result.canonicalInventory
      ? sha256(`${JSON.stringify(result.canonicalInventory, null, 2)}\n`)
      : null,
    propositionCount:
      result.canonicalInventory?.propositions.length ?? 0,
    usage: result.usage,
    latencyMs: result.latencyMs,
  };
  await writeImmutableJson(
    path.join(outputDirectory, "run_manifest.json"),
    manifest,
  );
  const files = await hashArtifactTree(outputDirectory);
  const aggregateSha256 = aggregateArtifactHash(files);
  await writeImmutableJson(path.join(outputDirectory, "artifact_hashes.json"), {
    schemaVersion: "cfx.artifactHashes.v1",
    algorithm: "sha256",
    selfExcluded: true,
    files,
    aggregateSha256,
  });
  await freezeArtifactTree(outputDirectory);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...manifest,
    artifactAggregateSha256: aggregateSha256,
  }, null, 2)}\n`);
  if (result.status !== "completed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
