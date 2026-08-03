import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  aggregateArtifactHash,
  createImmutableDirectory,
  freezeArtifactTree,
  hashArtifactTree,
  writeImmutableJson,
  writeImmutableText,
} from "../artifacts/immutableArtifacts.js";
import {
  buildCfxS1ReportHtml,
} from "../discovery/report/buildS1ReportHtml.js";
import { freezeCfxF03 } from "../input/f03.js";
import { loadCfxDiscoveryPrompt } from "../prompts/governedPrompts.js";
import { loadVerifiedCfxS1Inventory } from "./loadS1Inventory.js";
import {
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
  option,
} from "./paths.js";

async function main(): Promise<void> {
  const s1RunDirectory = option("--s1-run-dir");
  if (!s1RunDirectory) throw new Error("--s1-run-dir is required");
  const sourceRunDirectory = path.resolve(s1RunDirectory);
  const verified = await loadVerifiedCfxS1Inventory(sourceRunDirectory);
  const article = await freezeCfxF03(CFX_REPOSITORY_ROOT);
  const prompt = await loadCfxDiscoveryPrompt();
  const runManifest = JSON.parse(
    await readFile(path.join(sourceRunDirectory, "run_manifest.json"), "utf8"),
  ) as {
    runId: string;
    fixtureId: string;
    promptId: string;
    promptHash: string;
    schemaHash: string;
    requestHash: string;
    model: string;
    configuration: { temperature: number };
    providerCallCount: number;
    retryCount: number;
    usage: {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    latencyMs: number;
  };
  const sourceHashes = JSON.parse(
    await readFile(path.join(sourceRunDirectory, "artifact_hashes.json"), "utf8"),
  ) as { aggregateSha256: string };
  if (
    runManifest.promptHash !== prompt.promptHash
    || runManifest.fixtureId !== article.fixtureId
  ) {
    throw new Error("S1 report source identity mismatch");
  }
  const generatedAt = new Date().toISOString();
  const reportDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/CF1-F03/derived-reports",
    `${runManifest.runId}-report-${cfxTimestamp()}`,
  );
  await createImmutableDirectory(reportDirectory);
  const html = buildCfxS1ReportHtml({
    runId: runManifest.runId,
    generatedAt,
    fixtureId: article.fixtureId,
    articleTitle: article.articleTitle,
    articleCharacterCount: article.articleCharacterCount,
    sourceUnitCount: article.sourceUnitCount,
    fixtureFileSha256: article.fixtureFileSha256,
    articleTextSha256: article.articleTextSha256,
    sourceUnitManifestHash: article.sourceUnitManifestHash,
    promptId: prompt.promptId,
    promptHash: prompt.promptHash,
    promptText: prompt.prompt,
    schemaHash: runManifest.schemaHash,
    requestHash: runManifest.requestHash,
    canonicalInventoryHash: verified.inventoryHash,
    artifactAggregateSha256: sourceHashes.aggregateSha256,
    model: runManifest.model,
    temperature: runManifest.configuration.temperature,
    providerCallCount: runManifest.providerCallCount,
    retryCount: runManifest.retryCount,
    usage: runManifest.usage,
    latencyMs: runManifest.latencyMs,
    canonicalInventory: verified.inventory,
    sourceRunDirectory,
    articleText: article.articleText,
  });
  await writeImmutableText(path.join(reportDirectory, "report.html"), html);
  await writeImmutableJson(
    path.join(reportDirectory, "derived_report_manifest.json"),
    {
      schemaVersion: "cfx.s1DerivedReport.v1",
      generatedAt,
      sourceRunDirectory,
      sourceRunId: runManifest.runId,
      sourceCanonicalInventoryHash: verified.inventoryHash,
      sourceArtifactAggregateSha256: sourceHashes.aggregateSha256,
      modelCallsMade: 0,
    },
  );
  const files = await hashArtifactTree(reportDirectory);
  const aggregateSha256 = aggregateArtifactHash(files);
  await writeImmutableJson(path.join(reportDirectory, "artifact_hashes.json"), {
    schemaVersion: "cfx.artifactHashes.v1",
    algorithm: "sha256",
    selfExcluded: true,
    files,
    aggregateSha256,
  });
  await freezeArtifactTree(reportDirectory);
  process.stdout.write(`${JSON.stringify({
    reportDirectory,
    reportPath: path.join(reportDirectory, "report.html"),
    sourceRunId: runManifest.runId,
    canonicalInventoryHash: verified.inventoryHash,
    reportArtifactAggregateSha256: aggregateSha256,
    modelCallsMade: 0,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
