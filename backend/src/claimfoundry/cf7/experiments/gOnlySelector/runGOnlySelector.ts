import { createHash } from "node:crypto";
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
import { writeJsonAtomic } from "../../../shared/artifacts/writeJson.js";
import {
  aggregateGOnlyArtifactHash,
  freezeGOnlyArtifacts,
  GOnlyForensicWriter,
  hashGOnlyArtifacts,
} from "./artifacts.js";
import { buildFrozenComparisons } from "./comparison.js";
import { loadFrozenOriginalG } from "./loadFrozenOriginalG.js";
import { buildGOnlyComparisonReport } from "./report.js";
import {
  DEFAULT_G_ONLY_SELECTOR_CONFIG,
  G_ONLY_PROMPT_HASH,
  G_ONLY_SCHEMA_HASH,
  runGOnlySelectorExperiment,
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
  const frozen = await loadFrozenOriginalG({ repositoryRoot });
  const verificationSelections = frozen.groups.map((group) => ({
    groupId: group.groupId,
    assertionIds: [...group.assertionIds],
    selectedAssertionId: null,
    selectedAssertionText: null,
    structurallyValid: false,
  }));
  await buildFrozenComparisons({
    repositoryRoot,
    frozen,
    selections: verificationSelections,
  });
  const runId = `cf7-g-only-selector-a-cf1-f03-${stamp()}`;
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/g-only-selector/CF1-F03",
    runId,
  );
  const forensicWriter = new GOnlyForensicWriter(outputDirectory);
  await forensicWriter.initialize();
  await writeFile(
    path.join(outputDirectory, "source_g_groups.json"),
    await readFile(frozen.sourceGroupPath),
    { flag: "wx" },
  );
  await writeFile(
    path.join(outputDirectory, "source_assertion_inventory.json"),
    await readFile(frozen.sourceInventoryPath),
    { flag: "wx" },
  );
  const result = await runGOnlySelectorExperiment({
    frozen,
    provider: createOpenAiCf7StructuredProvider(),
    forensicWriter,
    config: { ...DEFAULT_G_ONLY_SELECTOR_CONFIG },
  });
  const selectionsArtifact = {
    runId,
    sourceGroupingRun: frozen.sourceGroupingRun,
    selector: "G_ONLY_SELECTOR_A",
    groups: result.selections,
  };
  await writeJsonAtomic(
    path.join(outputDirectory, "selections.json"),
    selectionsArtifact,
  );
  const usage = {
    expectedRequests: 21,
    completedRequests: result.rows.filter((row) => !row.error).length,
    failedRequests: result.rows.filter((row) => row.error).length,
    retriedRequests: 0,
    providerCallCount: result.providerCallCount,
    inputTokens: result.rows.reduce(
      (sum, row) => sum + row.usage.inputTokens,
      0,
    ),
    cachedInputTokens: result.rows.reduce(
      (sum, row) => sum + row.usage.cachedInputTokens,
      0,
    ),
    outputTokens: result.rows.reduce(
      (sum, row) => sum + row.usage.outputTokens,
      0,
    ),
    totalTokens: result.rows.reduce(
      (sum, row) => sum + row.usage.totalTokens,
      0,
    ),
    latencyMs: result.rows.reduce((sum, row) => sum + row.latencyMs, 0),
    requests: result.rows.map((row) => ({
      requestKey: row.requestKey,
      groupId: row.groupId,
      model: row.model,
      responseId: row.responseId,
      providerRequestId: row.requestId,
      usage: row.usage,
      latencyMs: row.latencyMs,
      structurallyValid: row.structurallyValid,
      error: row.error,
    })),
  };
  await writeJsonAtomic(path.join(outputDirectory, "usage.json"), usage);
  const comparisons = await buildFrozenComparisons({
    repositoryRoot,
    frozen,
    selections: result.selections,
  });
  const manifest = {
    schemaVersion: "cf7.gOnlySelectorRunManifest.v1",
    experimentPackageVersion: "1.0",
    runId,
    fixture: "CF1-F03",
    status: result.status,
    sourceGroupingRun: frozen.sourceGroupingRun,
    sourceGroupPath: frozen.sourceGroupPath,
    sourceGroupSha256: frozen.sourceGroupSha256,
    sourceInventoryPath: frozen.sourceInventoryPath,
    sourceInventorySha256: frozen.sourceInventorySha256,
    sourceArtifactAggregateSha256:
      frozen.sourceArtifactAggregateSha256,
    groupMembershipHash: frozen.groupMembershipHash,
    groupMembershipChanged: false,
    groupCount: frozen.groupCount,
    assignedAssertionCount: frozen.assignedAssertionCount,
    duplicateAssertionIds: frozen.duplicateAssertionIds,
    missingAssertionIds: frozen.missingAssertionIds,
    missingAssertionsRepaired: false,
    expectedProviderCallCount: 21,
    providerCallCount: result.providerCallCount,
    retryCount: 0,
    promptHash: G_ONLY_PROMPT_HASH,
    schemaHash: G_ONLY_SCHEMA_HASH,
    model: result.configuration.model,
    configuration: result.configuration,
    articleTextVisible: false,
    subThesisVisible: false,
    priorSelectorOutputsVisible: false,
    evaluatorMaterialsVisible: false,
    atomicityInstructionsVisible: false,
    structurallyValidSelectionCount: result.selections.filter(
      (selection) => selection.structurallyValid,
    ).length,
    comparisonSourceHashes: comparisons.sourceHashes,
  };
  await writeJsonAtomic(path.join(outputDirectory, "manifest.json"), manifest);
  const coreFiles = await hashGOnlyArtifacts(outputDirectory);
  const coreAggregateSha256 = aggregateGOnlyArtifactHash(coreFiles);
  const report = buildGOnlyComparisonReport({
    runId,
    frozen,
    selections: result.selections,
    comparisons: comparisons.rows,
    config: result.configuration,
    expectedRequests: usage.expectedRequests,
    completedRequests: usage.completedRequests,
    failedRequests: usage.failedRequests,
    retriedRequests: usage.retriedRequests,
    usage,
    coreArtifactAggregateSha256: coreAggregateSha256,
  });
  await writeFile(
    path.join(outputDirectory, "comparison_report.md"),
    report,
    { encoding: "utf8", flag: "wx" },
  );
  const allFiles = await hashGOnlyArtifacts(outputDirectory);
  const fullAggregateSha256 = aggregateGOnlyArtifactHash(allFiles);
  await writeJsonAtomic(path.join(outputDirectory, "artifact_hashes.json"), {
    schemaVersion: "cf7.gOnlySelectorArtifactHashes.v1",
    algorithm: "sha256",
    selfExcluded: true,
    coreAggregateExcludes: ["comparison_report.md", "artifact_hashes.json"],
    coreFileCount: coreFiles.length,
    coreAggregateSha256,
    fullFileCount: allFiles.length,
    files: allFiles,
    fullAggregateSha256,
  });
  await freezeGOnlyArtifacts(outputDirectory);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...manifest,
    usage,
    coreArtifactAggregateSha256: coreAggregateSha256,
    fullArtifactAggregateSha256: fullAggregateSha256,
    reportSha256: createHash("sha256").update(report).digest("hex"),
  }, null, 2)}\n`);
  if (result.status !== "completed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
