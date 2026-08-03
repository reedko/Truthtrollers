import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  createOpenAiCf7StructuredProvider,
} from "../../../shared/provider/index.js";
import { writeJsonAtomic } from "../../../shared/artifacts/writeJson.js";
import {
  aggregateGde2ArtifactHash,
  freezeGde2Artifacts,
  Gde2ForensicWriter,
  hashGde2Artifacts,
} from "./artifacts.js";
import {
  loadFrozenSemanticGroupingAssertions,
} from "../semanticGrouping/loadFrozenAssertions.js";
import {
  DEFAULT_GDE2_CONFIG,
  runGde2Experiment,
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
  const frozen = await loadFrozenSemanticGroupingAssertions({ repositoryRoot });
  const runId = `cf7-gde2-cf1-f03-${stamp()}`;
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/semantic-grouping-representative/CF1-F03",
    runId,
  );
  const forensicWriter = new Gde2ForensicWriter(outputDirectory);
  await forensicWriter.initialize();
  const result = await runGde2Experiment({
    assertions: frozen.assertions,
    assertionInventoryHash: frozen.assertionInventoryHash,
    provider: createOpenAiCf7StructuredProvider(),
    forensicWriter,
    config: { ...DEFAULT_GDE2_CONFIG },
  });
  await writeJsonAtomic(
    path.join(outputDirectory, "assertion_inventory.json"),
    frozen.assertions,
  );
  for (const row of result.rows) {
    await writeJsonAtomic(
      path.join(outputDirectory, `${row.experimentId}_groups.json`),
      row.output ?? row.rawOutput,
    );
  }
  await writeJsonAtomic(path.join(outputDirectory, "prompt_manifest.json"), {
    schemaVersion: "cf7.gde2PromptManifest.v1",
    commonRulesHash: result.commonRulesHash,
    assertionInventoryHash: result.assertionInventoryHash,
    experiments: result.rows.map((row) => ({
      experimentId: row.experimentId,
      promptId: row.promptId,
      variantId: row.variantId,
      originalPromptText: row.originalPromptText,
      representativeAddition: row.representativeAddition,
      combinedPromptHash: row.combinedPromptHash,
      schemaHash: row.schemaHash,
      requestHash: row.requestHash,
    })),
  });
  await writeJsonAtomic(path.join(outputDirectory, "validation_summary.json"), {
    status: result.status === "completed" ? "PASS" : "FAIL",
    experiments: result.rows.map((row) => ({
      experimentId: row.experimentId,
      ...row.validation,
      schemaIssues: row.schemaIssues,
    })),
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
      experimentId: row.experimentId,
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
    schemaVersion: "cf7.gde2RunManifest.v1",
    experimentPackageVersion: "1.0",
    runId,
    parentRunId: frozen.parentRunId,
    baselineSemanticGroupingRunId:
      "cf7-semantic-grouping-cf1-f03-20260729005359",
    fixture: "CF1-F03",
    status: result.status,
    model: result.configuration.model,
    frozenInventorySha256: frozen.frozenInventorySha256,
    assertionInventoryHash: result.assertionInventoryHash,
    assertionCount: result.assertionCount,
    promptCount: result.promptCount,
    providerCallCount: result.providerCallCount,
    commonRulesHash: result.commonRulesHash,
    configuration: result.configuration,
    originalPromptIds: ["G", "D", "E"],
    variantIds: ["A", "B", "C"],
    allExperimentsUseIdenticalInventory: true,
    allExperimentsUseIdenticalSettings: true,
    articleTextOutsideAssertionsVisible: false,
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
  const files = await hashGde2Artifacts(outputDirectory);
  await writeJsonAtomic(path.join(outputDirectory, "artifact_hashes.json"), {
    schemaVersion: "cf7.gde2ArtifactHashes.v1",
    algorithm: "sha256",
    selfExcluded: true,
    fileCount: files.length,
    files,
    aggregateSha256: aggregateGde2ArtifactHash(files),
  });
  await freezeGde2Artifacts(outputDirectory);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...manifest,
    accounting,
    artifactManifestSha256: createHash("sha256").update(
      JSON.stringify(files),
    ).digest("hex"),
  }, null, 2)}\n`);
  if (result.status !== "completed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
