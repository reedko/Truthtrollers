import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalHash } from "../shared/sourceUnits/index.js";
import { Cf7Error } from "../shared/errors/Cf7Error.js";
import {
  writePhase1Artifacts,
  type Cf7Phase1RunManifest,
} from "./artifacts/writePhase1Artifacts.js";
import {
  chunkArticle,
  DEFAULT_CF7_CHUNK_CONFIG,
} from "./chunking/chunkArticle.js";
import { buildCoverageReport } from "./chunking/coverage.js";
import { ingestArticle, type Cf7ArticleInput } from "./ingest/ingestArticle.js";
import type {
  Cf7Chunk,
  Cf7CoverageReport,
  Cf7IngestResult,
} from "./types/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../..");
const repositoryRoot = path.resolve(backendRoot, "..");

export type Cf7Phase1Result = {
  ingest: Cf7IngestResult;
  chunks: Cf7Chunk[];
  coverageReport: Cf7CoverageReport;
  determinismHash: string;
};

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function buildCf7Phase1(input: Cf7ArticleInput): Cf7Phase1Result {
  const ingest = ingestArticle(input);
  const chunks = chunkArticle(ingest, DEFAULT_CF7_CHUNK_CONFIG);
  const coverageReport = buildCoverageReport(
    ingest,
    chunks,
    DEFAULT_CF7_CHUNK_CONFIG,
  );
  if (
    !coverageReport.coverageComplete
    || !coverageReport.unitsInSourceOrder
    || !coverageReport.overlapAdjacentOnly
    || coverageReport.sentenceFragmentationCount !== 0
  ) {
    throw new Cf7Error(
      "CF7_COVERAGE_PROOF_FAILED",
      "CF7 deterministic coverage proof failed",
      { coverageReport },
    );
  }
  return {
    ingest,
    chunks,
    coverageReport,
    determinismHash: canonicalHash({
      units: ingest.units,
      regions: ingest.regions,
      sourceManifest: ingest.sourceManifest,
      chunks,
      coverageReport,
    }),
  };
}

export async function loadCf7Fixture(fixture: string): Promise<Cf7ArticleInput> {
  if (!/^CF1-F\d{2}$/.test(fixture)) {
    throw new Cf7Error("CF7_INVALID_FIXTURE", `Invalid fixture ID: ${fixture}`);
  }
  const fixturePath = path.join(
    backendRoot,
    "test/claim-foundry/fixtures",
    fixture,
    "article.json",
  );
  const raw = JSON.parse(await readFile(fixturePath, "utf8"));
  const article = raw.article ?? raw;
  return {
    text: article.text,
    title: article.title,
    language: article.language,
    url: article.url,
  };
}

async function main(): Promise<void> {
  const fixture = option("--fixture", "CF1-F03");
  const outputDirectory = path.resolve(option(
    "--output",
    path.join(
      repositoryRoot,
      "artifacts/claim-foundry/cf7/phase1",
      fixture,
    ),
  ));
  const input = await loadCf7Fixture(fixture);
  const first = buildCf7Phase1(input);
  const second = buildCf7Phase1(input);
  const repeatedRunDeterministic = first.determinismHash === second.determinismHash;
  if (!repeatedRunDeterministic) {
    throw new Cf7Error(
      "CF7_NONDETERMINISTIC_PHASE1",
      "Repeated CF7 Phase 1 runs produced different manifests",
    );
  }

  const tokenEstimates = first.chunks.map((chunk) => chunk.tokenEstimate);
  const files = [
    "units.json",
    "regions.json",
    "source_manifest.json",
    "chunks.json",
    "coverage_report.json",
    "run_manifest.json",
  ];
  const runManifest: Cf7Phase1RunManifest = {
    schemaVersion: "cf7.phase1RunManifest.v1",
    architecture: "CF7 Coverage-First Chunk Factory",
    phase: 1,
    fixture,
    sourceUnitCount: first.ingest.units.length,
    regionCount: first.ingest.regions.length,
    chunkCount: first.chunks.length,
    expectedHarvestCallCount: first.chunks.length,
    modelCallsMade: 0,
    chunkConfig: { ...DEFAULT_CF7_CHUNK_CONFIG },
    tokenDistribution: {
      minimum: Math.min(...tokenEstimates),
      median: median(tokenEstimates),
      maximum: Math.max(...tokenEstimates),
    },
    overlapPercentage: first.coverageReport.overlapPercentage,
    coverageComplete: first.coverageReport.coverageComplete,
    repeatedRunDeterministic,
    phase1DeterminismHash: first.determinismHash,
    files,
  };
  await writePhase1Artifacts({
    outputDirectory,
    ingest: first.ingest,
    chunks: first.chunks,
    coverageReport: first.coverageReport,
    runManifest,
  });
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...runManifest,
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
