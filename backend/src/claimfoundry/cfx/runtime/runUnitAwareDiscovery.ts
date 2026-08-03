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
  buildCfxUnitAwareReportHtml,
} from "../discoveryWithUnits/buildReportHtml.js";
import {
  DEFAULT_CFX_DISCOVERY_WITH_UNITS_CONFIG,
  runCfxDiscoveryWithUnits,
} from "../discoveryWithUnits/runDiscoveryWithUnits.js";
import { freezeCfxF03 } from "../input/f03.js";
import {
  loadCfxDiscoveryWithUnitsPrompt,
} from "../prompts/governedPrompts.js";
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
  const prompt = await loadCfxDiscoveryWithUnitsPrompt();
  const generatedAt = new Date().toISOString();
  const runId = `cfx-unit-aware-cf1-f03-${cfxTimestamp()}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/CF1-F03",
    runId,
  );
  await createImmutableDirectory(outputDirectory);
  await writeImmutableJson(
    path.join(outputDirectory, "s0/source_units.json"),
    article.sourceUnits,
  );
  await writeImmutableJson(path.join(outputDirectory, "s0/manifest.json"), {
    fixtureId: article.fixtureId,
    fixtureFileSha256: article.fixtureFileSha256,
    articleTextSha256: article.articleTextSha256,
    sourceUnitManifestHash: article.sourceUnitManifestHash,
    sourceUnitCount: article.sourceUnitCount,
    unitProjectionSha256: article.unitProjectionSha256,
  });
  const requestDirectory = path.join(outputDirectory, "request-001");
  const result = await runCfxDiscoveryWithUnits({
    article,
    prompt,
    provider: createOpenAiCf7StructuredProvider(),
    config: { ...DEFAULT_CFX_DISCOVERY_WITH_UNITS_CONFIG },
    async beforeInvoke(request) {
      const text = `${JSON.stringify(request, null, 2)}\n`;
      await writeImmutableText(path.join(requestDirectory, "request.json"), text);
      await writeImmutableText(
        path.join(requestDirectory, "request_hash.txt"),
        `${sha256(text)}\n`,
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
  await writeImmutableJson(path.join(requestDirectory, "validation.json"), {
    status: result.status === "completed" ? "PASS" : "FAIL",
    violations: result.diagnostics,
  });
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
  if (result.inventory) {
    await writeImmutableJson(
      path.join(outputDirectory, "canonical_propositions_with_units.json"),
      result.inventory,
    );
    const inventoryHash = sha256(
      `${JSON.stringify(result.inventory, null, 2)}\n`,
    );
    await writeImmutableText(
      path.join(outputDirectory, "report.html"),
      buildCfxUnitAwareReportHtml({
        runId,
        generatedAt,
        article,
        inventory: result.inventory,
        model: result.model,
        promptHash: result.promptHash,
        schemaHash: result.schemaHash,
        requestHash: result.requestHash,
        canonicalInventoryHash: inventoryHash,
        usage: result.usage,
        latencyMs: result.latencyMs,
      }),
    );
  }
  const manifest = {
    schemaVersion: "cfx.unitAwareRunManifest.v1",
    runId,
    generatedAt,
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
    sourceUnitCount: article.sourceUnitCount,
    unitProjectionSha256: article.unitProjectionSha256,
    propositionCount: result.inventory?.propositions.length ?? 0,
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
