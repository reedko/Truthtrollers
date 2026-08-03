import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  createOpenAiCf7StructuredProvider,
} from "../../shared/provider/index.js";
import {
  writeS3Artifacts,
  type Cf7S3RunManifest,
} from "../artifacts/writeS3Artifacts.js";
import {
  Cf7S3ForensicWriter,
  freezeS3ArtifactTree,
} from "../artifacts/S3ForensicWriter.js";
import {
  buildCf7S3BatchPlan,
  DEFAULT_CF7_S3_BATCH_CONFIG,
} from "./batching.js";
import { completeCf7S3Grounding } from "./groundingCompleteness.js";
import { buildCf7S3RoutingManifest } from "./routing.js";
import {
  loadCf7F03S2Input,
} from "./loadFrozenS2.js";
import {
  DEFAULT_CF7_S3_CONFIG,
  runCf7S3Atomicity,
} from "./runAtomicity.js";
import type { Cf7S3Config } from "./types.js";
import {
  buildCf7S3UserPrompt,
  CF7_S3_SYSTEM_PROMPT,
} from "./prompt.js";
import { CF7_S3_JSON_SCHEMA } from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

function stamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function assertNoEvaluatorContamination(visible: string): void {
  if (/goldId|must-select|crux|semantic evaluation|sealed evaluator/i.test(visible)) {
    throw new Error("CF7 S3 model-visible payload contains evaluator markers");
  }
}

async function main(): Promise<void> {
  if (!(process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY)) {
    throw new Error("OpenAI API key is not configured");
  }
  const frozen = await loadCf7F03S2Input({ repositoryRoot });
  const completedGrounding = completeCf7S3Grounding({
    parents: frozen.parents,
    units: frozen.units,
  });
  const routingManifest = buildCf7S3RoutingManifest(
    completedGrounding.parents,
  );
  const routedIds = new Set(routingManifest.decisions
    .filter((decision) => decision.routed)
    .map((decision) => decision.parentHarvestRowId));
  const batchConfig = { ...DEFAULT_CF7_S3_BATCH_CONFIG };
  const preflightPlan = buildCf7S3BatchPlan({
    parents: completedGrounding.parents.filter(
      (parent) => routedIds.has(parent.harvestRowId),
    ),
    units: frozen.units,
    config: batchConfig,
  });
  for (const batch of preflightPlan.batches) {
    assertNoEvaluatorContamination([
      CF7_S3_SYSTEM_PROMPT,
      buildCf7S3UserPrompt({
        batchIndex: batch.batchIndex,
        batchCount: batch.batchCount,
        parents: batch.parents,
        contextUnits: batch.contextUnits,
      }),
      JSON.stringify(CF7_S3_JSON_SCHEMA),
    ].join("\n"));
  }
  const config: Cf7S3Config = { ...DEFAULT_CF7_S3_CONFIG };
  const runId = `cf7-s3-cf1-f03-${stamp()}`;
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/s3/CF1-F03",
    runId,
  );
  const forensicWriter = new Cf7S3ForensicWriter(outputDirectory);
  await forensicWriter.initialize();
  const result = await runCf7S3Atomicity({
    parents: frozen.parents,
    units: frozen.units,
    provider: createOpenAiCf7StructuredProvider(),
    config,
    batchConfig,
    forensicSink: forensicWriter,
  });
  const actionCounts = Object.fromEntries(
    result.validatedEvaluations.reduce((counts, evaluation) => {
      counts.set(
        evaluation.action,
        (counts.get(evaluation.action) ?? 0) + 1,
      );
      return counts;
    }, new Map<string, number>()),
  );
  const files = [
    "s2_reference.json",
    "prompt_manifest.json",
    "batch_manifest.json",
    "routing_manifest.json",
    "grounding_completion_manifest.json",
    "atomicity_results.json",
    "atomic_inventory.json",
    "validated_parent_results.json",
    "validated_atomic_inventory.json",
    "quarantined_rows.json",
    "validation_summary.json",
    "lineage_map.json",
    "sidecars.json",
    "request_accounting.json",
    "run_manifest.json",
    "artifact_hashes.json",
  ];
  const { requests: _requests, ...accountingSummary } = result.accounting;
  const manifest: Cf7S3RunManifest = {
    schemaVersion: "cf7.s3RunManifest.v1",
    architecture: "CF7 Coverage-First Chunk Factory",
    stage: "S3",
    runId,
    parentRunId: frozen.runId,
    fixture: "CF1-F03",
    status: result.status,
    model: config.model,
    frozenS2InventorySha256: frozen.inventorySha256,
    frozenS2InventoryHashVerified: true,
    parentRowCount: frozen.parents.length,
    parentRowsEvaluatedExactlyOnce:
      result.status === "completed"
      && result.validatedEvaluations.length === frozen.parents.length
      && new Set(result.evaluations.map(
        (evaluation) => evaluation.parentHarvestRowId,
      )).size === frozen.parents.length,
    routedParentCount: result.routedParentCount,
    bypassedParentCount: result.bypassedParentCount,
    routingManifestHash: result.routingManifest.routingManifestHash,
    groundingCompletedParentCount: result.groundingCompletions.filter(
      (row) => row.addedContextUnitIds.length > 0,
    ).length,
    expectedRequestCount: result.expectedRequestCount,
    providerCallCount: result.providerCallCount,
    requestDirectoryCount: result.expectedRequestCount,
    forensicEvidenceComplete:
      result.accounting.requestCount === result.expectedRequestCount,
    atomicInventoryCount: result.atomicInventory.length,
    validatedParentCount: result.validatedEvaluations.length,
    quarantinedParentCount: result.quarantinedRows.length,
    validatedAtomicInventoryCount: result.validatedAtomicInventory.length,
    actionCounts,
    promptHash: result.promptHash,
    schemaHash: result.schemaHash,
    batchManifestHash: result.batchManifest.batchManifestHash,
    configuration: config,
    accounting: accountingSummary,
    sealedEvaluationKeyVisibleToModel: false,
    files,
  };
  await writeS3Artifacts({ outputDirectory, result, manifest });
  await freezeS3ArtifactTree(outputDirectory);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...manifest,
  }, null, 2)}\n`);
  if (result.status !== "completed") process.exitCode = 1;
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error
      ? error.stack ?? error.message
      : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
