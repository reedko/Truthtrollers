import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  createOpenAiCf7StructuredProvider,
} from "../../../shared/provider/index.js";
import { writeJsonAtomic } from "../../../shared/artifacts/writeJson.js";
import {
  aggregateSel1ArtifactHash,
  freezeSel1Artifacts,
  hashSel1Artifacts,
  Sel1ForensicWriter,
} from "./artifacts.js";
import { loadFrozenSel1Input } from "./loadFrozenGde2Gb.js";
import {
  DEFAULT_SEL1_CONFIG,
  runSel1Experiment,
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
  const frozen = await loadFrozenSel1Input({ repositoryRoot });
  const runId = `cf7-sel1-cf1-f03-${stamp()}`;
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/selector-experiment/CF1-F03",
    runId,
  );
  const forensicWriter = new Sel1ForensicWriter(outputDirectory);
  await forensicWriter.initialize();
  const result = await runSel1Experiment({
    frozen,
    provider: createOpenAiCf7StructuredProvider(),
    forensicWriter,
    config: { ...DEFAULT_SEL1_CONFIG },
  });
  await writeJsonAtomic(path.join(outputDirectory, "frozen_input.json"), frozen);
  for (const selectorId of ["A", "B"] as const) {
    await writeJsonAtomic(
      path.join(outputDirectory, `selector_${selectorId}_results.json`),
      result.rows
        .filter((row) => row.selectorId === selectorId)
        .map((row) => ({
          groupId: row.groupId,
          groupIndex: row.groupIndex,
          output: row.output,
          validation: row.validation,
          schemaIssues: row.schemaIssues,
          error: row.error,
        })),
    );
  }
  await writeJsonAtomic(path.join(outputDirectory, "validation_summary.json"), {
    status: result.status === "completed" ? "PASS" : "FAIL",
    selectors: ["A", "B"].map((selectorId) => {
      const rows = result.rows.filter((row) => row.selectorId === selectorId);
      return {
        selectorId,
        requestCount: rows.length,
        passedCount: rows.filter(
          (row) => row.validation.status === "PASS",
        ).length,
        failedCount: rows.filter(
          (row) => row.validation.status === "FAIL",
        ).length,
        introducedProtectedTokenCount: rows.reduce(
          (sum, row) =>
            sum + row.validation.introducedProtectedTokens.length,
          0,
        ),
        rows: rows.map((row) => ({
          requestKey: row.requestKey,
          groupId: row.groupId,
          ...row.validation,
          schemaIssues: row.schemaIssues,
        })),
      };
    }),
  });
  const accounting = {
    requestCount: result.rows.length,
    completedRequestCount: result.rows.filter((row) => !row.error).length,
    failedRequestCount: result.rows.filter((row) => row.error).length,
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
      selectorId: row.selectorId,
      groupId: row.groupId,
      model: row.model,
      responseId: row.responseId,
      requestId: row.requestId,
      usage: row.usage,
      latencyMs: row.latencyMs,
      error: row.error,
    })),
  };
  await writeJsonAtomic(
    path.join(outputDirectory, "request_accounting.json"),
    accounting,
  );
  const manifest = {
    schemaVersion: "cf7.sel1RunManifest.v1",
    experimentPackageVersion: "1.0",
    runId,
    fixture: "CF1-F03",
    status: result.status,
    sourceRunId: frozen.sourceRunId,
    sourceArtifactAggregateSha256:
      frozen.sourceArtifactAggregateSha256,
    sourceGde2GroupFileSha256: frozen.sourceGde2GroupFileSha256,
    sourceInputHash: frozen.sourceInputHash,
    groupCount: frozen.groupCount,
    sourceAssertionAssignmentCount:
      frozen.assertionAssignmentCount,
    sourceUniqueAssertionCount: frozen.uniqueAssertionCount,
    duplicateSourceAssertionIds: frozen.duplicateAssertionIds,
    selectorCount: result.selectorCount,
    expectedProviderCallCount: result.expectedProviderCallCount,
    providerCallCount: result.providerCallCount,
    promptHashes: result.promptHashes,
    schemaHash: result.schemaHash,
    model: result.configuration.model,
    configuration: result.configuration,
    selectorASeesSubThesis: false,
    selectorBSeesSubThesis: true,
    bothSelectorsSeeIdenticalGroupAssertions: true,
    articleTextVisible: false,
    provenanceOutsideAssertionIdsVisible: false,
    sealedEvaluatorVisible: false,
    validationPassed: result.rows.every(
      (row) => row.validation.status === "PASS",
    ),
    accounting: {
      ...accounting,
      requests: undefined,
    },
  };
  await writeJsonAtomic(path.join(outputDirectory, "run_manifest.json"), manifest);
  const files = await hashSel1Artifacts(outputDirectory);
  await writeJsonAtomic(path.join(outputDirectory, "artifact_hashes.json"), {
    schemaVersion: "cf7.sel1ArtifactHashes.v1",
    algorithm: "sha256",
    selfExcluded: true,
    fileCount: files.length,
    files,
    aggregateSha256: aggregateSel1ArtifactHash(files),
  });
  await freezeSel1Artifacts(outputDirectory);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...manifest,
    accounting,
    artifactAggregateSha256: aggregateSel1ArtifactHash(files),
  }, null, 2)}\n`);
  if (result.status !== "completed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
