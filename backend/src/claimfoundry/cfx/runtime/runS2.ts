import { readFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import {
  createOpenAiCf7StructuredProvider,
} from "../../shared/provider/index.js";
import {
  canonicalHash,
} from "../../shared/sourceUnits/index.js";
import {
  CFX_GROUNDING_JSON_SCHEMA,
} from "../schemas/groundingSchema.js";
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
  buildCfxS2ReportHtml,
} from "../grounding/report/buildS2ReportHtml.js";
import {
  buildCfxS2ReportMarkdown,
} from "../grounding/report/buildS2ReportMarkdown.js";
import { runCfxS2Comparison } from "../grounding/runComparison.js";
import {
  DEFAULT_CFX_GROUNDING_CONFIG,
} from "../grounding/runGrounding.js";
import { freezeCfxF03 } from "../input/f03.js";
import { loadCfxExactGroundingPrompt } from "../prompts/governedPrompts.js";
import { loadVerifiedCfxS1Inventory } from "./loadS1Inventory.js";
import {
  CFX_BACKEND_ROOT,
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
  option,
} from "./paths.js";

dotenv.config({ path: path.join(CFX_BACKEND_ROOT, ".env") });

async function main(): Promise<void> {
  if (!(process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY)) {
    throw new Error("OpenAI API key is not configured");
  }
  const sourceS1Run = option("--s1-run-dir");
  if (!sourceS1Run) throw new Error("--s1-run-dir is required");
  const verified = await loadVerifiedCfxS1Inventory(
    path.resolve(sourceS1Run),
  );
  const article = await freezeCfxF03(CFX_REPOSITORY_ROOT);
  const prompt = await loadCfxExactGroundingPrompt();
  const generatedAt = new Date().toISOString();
  const runId = `cfx-s2-cf1-f03-${cfxTimestamp()}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/CF1-F03",
    runId,
  );
  await createImmutableDirectory(outputDirectory);
  await writeImmutableText(
    path.join(outputDirectory, "canonical_propositions.json"),
    verified.inventoryBytes.toString(),
  );
  await writeImmutableText(
    path.join(outputDirectory, "s0/source_article.json"),
    (await readFile(article.fixturePath)).toString(),
  );
  await writeImmutableJson(
    path.join(outputDirectory, "s0/source_units.json"),
    article.sourceUnits,
  );
  const result = await runCfxS2Comparison({
    artifactRoot: outputDirectory,
    article,
    canonicalInventory: verified.inventory,
    prompt,
    provider: createOpenAiCf7StructuredProvider(),
    config: { ...DEFAULT_CFX_GROUNDING_CONFIG },
  });
  const copiedCanonicalPath = path.join(
    outputDirectory,
    "canonical_propositions.json",
  );
  const copiedCanonicalHashAfter = sha256(
    await readFile(copiedCanonicalPath),
  );
  if (copiedCanonicalHashAfter !== verified.inventoryHash) {
    throw new Error("S2 changed the frozen canonical proposition artifact");
  }
  await writeImmutableJson(
    path.join(outputDirectory, "grounding_inventory.json"),
    {
      schemaVersion: "cfx.groundingInventory.v1",
      canonicalInventoryHash: verified.inventoryHash,
      wholeArticle: {
        status: result.wholeArticle.status,
        acceptedRows: result.wholeArticle.acceptedRows,
        rejectedRows: result.wholeArticle.rejectedRows,
      },
      perProposition: {
        status: result.perProposition.status,
        acceptedRows: result.perProposition.acceptedRows,
        rejectedRows: result.perProposition.rejectedRows,
      },
    },
  );
  await writeImmutableJson(
    path.join(outputDirectory, "grounding_comparison.json"),
    result.comparison,
  );
  const overallStatus =
    result.wholeArticle.status === "failed"
      || result.perProposition.status === "failed"
      ? "failed"
      : result.wholeArticle.status === "completed"
        && result.perProposition.status === "completed"
        ? "completed"
        : "completed_with_quarantine";
  const manifest = {
    schemaVersion: "cfx.s2RunManifest.v1",
    runId,
    generatedAt,
    fixtureId: article.fixtureId,
    sourceS1RunDirectory: path.resolve(sourceS1Run),
    status: overallStatus,
    expectedProviderCallCount: 13,
    providerCallCount: result.providerCallCount,
    retryCount: 0,
    promptId: prompt.promptId,
    promptHash: prompt.promptHash,
    schemaName: CFX_GROUNDING_JSON_SCHEMA.name,
    schemaHash: canonicalHash(CFX_GROUNDING_JSON_SCHEMA),
    model: DEFAULT_CFX_GROUNDING_CONFIG.model,
    configuration: DEFAULT_CFX_GROUNDING_CONFIG,
    articleTextSha256: article.articleTextSha256,
    sourceUnitManifestHash: article.sourceUnitManifestHash,
    sourceUnitCount: article.sourceUnitCount,
    unitProjectionSha256: article.unitProjectionSha256,
    canonicalInventoryHashBefore: verified.inventoryHash,
    canonicalInventoryHashAfter: copiedCanonicalHashAfter,
    canonicalInventoryUnchanged:
      verified.inventoryHash === copiedCanonicalHashAfter,
    wholeArticleStatus: result.wholeArticle.status,
    perPropositionStatus: result.perProposition.status,
  };
  await writeImmutableJson(
    path.join(outputDirectory, "run_manifest.json"),
    manifest,
  );
  const coreFiles = await hashArtifactTree(outputDirectory);
  const reportInput = {
    runId,
    fixtureId: article.fixtureId,
    generatedAt,
    provider: "OpenAI" as const,
    model: DEFAULT_CFX_GROUNDING_CONFIG.model,
    promptId: prompt.promptId,
    promptHash: prompt.promptHash,
    schemaHash: canonicalHash(CFX_GROUNDING_JSON_SCHEMA),
    article,
    canonicalInventory: verified.inventory,
    wholeArticle: result.wholeArticle,
    perProposition: result.perProposition,
    comparison: result.comparison,
    artifactPaths: coreFiles.map((file) => file.path),
    artifactHashes: coreFiles.map((file) => ({
      path: file.path,
      sha256: file.sha256,
    })),
  };
  await writeImmutableText(
    path.join(outputDirectory, "results_report.md"),
    buildCfxS2ReportMarkdown(reportInput),
  );
  await writeImmutableText(
    path.join(outputDirectory, "report.html"),
    buildCfxS2ReportHtml(reportInput),
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
  if (overallStatus === "failed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
