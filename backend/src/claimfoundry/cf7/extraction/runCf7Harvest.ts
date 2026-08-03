import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  createOpenAiCf7StructuredProvider,
} from "../../shared/provider/index.js";
import { Cf7Error } from "../../shared/errors/Cf7Error.js";
import {
  writeS2Artifacts,
  type Cf7S2RunManifest,
} from "../artifacts/writeS2Artifacts.js";
import {
  buildCf7Phase1,
  loadCf7Fixture,
} from "../runCf7.js";
import {
  DEFAULT_CF7_HARVEST_CONFIG,
  runCf7Harvest,
  type Cf7HarvestConfig,
} from "./runHarvest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Cf7Error("CF7_INVALID_HARVEST_CONFIG", `${name} must be positive`);
  }
  return parsed;
}

function stamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

async function main(): Promise<void> {
  const fixture = option("--fixture", "CF1-F03");
  const model = option(
    "--model",
    DEFAULT_CF7_HARVEST_CONFIG.model,
  );
  const config: Cf7HarvestConfig = {
    model,
    maximumConcurrency: positiveInteger(
      option(
        "--concurrency",
        String(DEFAULT_CF7_HARVEST_CONFIG.maximumConcurrency),
      ),
      DEFAULT_CF7_HARVEST_CONFIG.maximumConcurrency,
      "--concurrency",
    ),
    maxOutputTokens: positiveInteger(
      option(
        "--max-output-tokens",
        String(DEFAULT_CF7_HARVEST_CONFIG.maxOutputTokens),
      ),
      DEFAULT_CF7_HARVEST_CONFIG.maxOutputTokens,
      "--max-output-tokens",
    ),
    timeoutMs: positiveInteger(
      option("--timeout-ms", String(DEFAULT_CF7_HARVEST_CONFIG.timeoutMs)),
      DEFAULT_CF7_HARVEST_CONFIG.timeoutMs,
      "--timeout-ms",
    ),
    temperature: DEFAULT_CF7_HARVEST_CONFIG.temperature,
    retryCount: 0,
    store: false,
  };
  if (!(process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY)) {
    throw new Cf7Error("CF7_MISSING_API_KEY", "OpenAI API key is not configured");
  }

  const article = await loadCf7Fixture(fixture);
  const phase1 = buildCf7Phase1(article);
  const runId = `cf7-s2-${fixture.toLowerCase()}-${stamp()}`;
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/s2",
    fixture,
    runId,
  );
  const harvest = await runCf7Harvest({
    chunks: phase1.chunks,
    units: phase1.ingest.units,
    provider: createOpenAiCf7StructuredProvider(),
    config,
  });
  const disputedAssertionCount = harvest.inventory.filter(
    (row) => row.rowKind === "disputed",
  ).length;
  const emptyChunkCount = harvest.findings.filter(
    (finding) => finding.code === "CF7_EMPTY_CHUNK",
  ).length;
  const rejectedOutOfRangeRowCount = harvest.findings.filter(
    (finding) => finding.code === "CF7_OUT_OF_RANGE_GROUNDING",
  ).length;
  const files = [
    "phase1_reference.json",
    "prompt_manifest.json",
    "harvest_results.json",
    "harvest_inventory.json",
    "harvest_findings.json",
    "request_accounting.json",
    "run_manifest.json",
    "artifact_hashes.json",
  ];
  const manifest: Cf7S2RunManifest = {
    schemaVersion: "cf7.s2RunManifest.v1",
    architecture: "CF7 Coverage-First Chunk Factory",
    stage: "S2",
    runId,
    fixture,
    status: harvest.status,
    model,
    sourceUnitCount: phase1.ingest.units.length,
    chunkCount: phase1.chunks.length,
    expectedHarvestCallCount: phase1.chunks.length,
    harvestCallCount: harvest.harvestCallCount,
    acceptedHarvestRowCount: harvest.inventory.length,
    disputedAssertionCount,
    assertionCount: harvest.inventory.length - disputedAssertionCount,
    emptyChunkCount,
    rejectedOutOfRangeRowCount,
    providerFailureCount: harvest.accounting.failedRequestCount,
    promptHash: harvest.promptHash,
    schemaHash: harvest.schemaHash,
    phase1DeterminismHash: phase1.determinismHash,
    modelCallsMade: harvest.harvestCallCount,
    configuration: config,
    accounting: harvest.accounting,
    sealedKeyOpenedDuringExecution: false,
    files,
  };
  await writeS2Artifacts({
    outputDirectory,
    phase1,
    harvest,
    manifest,
  });
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...manifest,
  }, null, 2)}\n`);
  if (harvest.status !== "completed") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
