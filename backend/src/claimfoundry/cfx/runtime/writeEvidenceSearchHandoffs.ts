import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
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
  attachCfxEvidenceSearchHandoffs,
} from "../evidenceSearch/buildEvidenceSearchHandoff.js";
import {
  cfxSubstantiveReviewOutputSchema,
} from "../schemas/substantiveReviewSchema.js";
import {
  cfxUnitAwareInventorySchema,
} from "../schemas/unitAwareInventorySchema.js";
import {
  buildCfxSubstantiveReviewReportHtml,
} from "../substantiveReview/buildReportHtml.js";
import type {
  CfxSubstantiveReviewInventory,
} from "../substantiveReview/types.js";
import {
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
  option,
} from "./paths.js";

const sourceUnitsSchema = z.array(z.object({
  unitId: z.string().regex(/^U[0-9]+$/),
  text: z.string(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
}).strict());

const sourceManifestSchema = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  model: z.string(),
  promptHash: z.string(),
  schemaHash: z.string(),
  requestHash: z.string(),
  sourceInventoryHash: z.string(),
  usage: z.object({
    inputTokens: z.number(),
    cachedInputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
  }),
  latencyMs: z.number(),
}).passthrough();

const artifactHashesSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string(),
  })),
}).passthrough();

async function verifiedSourceFile(
  sourceDirectory: string,
  relativePath: string,
  artifactHashes: z.infer<typeof artifactHashesSchema>,
): Promise<Buffer> {
  const expected = artifactHashes.files.find(
    (entry) => entry.path === relativePath,
  );
  if (!expected) {
    throw new Error(`Missing frozen artifact hash for ${relativePath}`);
  }
  const bytes = await readFile(path.join(sourceDirectory, relativePath));
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
    throw new Error(`Frozen S2 artifact hash mismatch for ${relativePath}`);
  }
  return bytes;
}

async function main(): Promise<void> {
  const sourceOption = option("--s2-run-dir");
  if (!sourceOption) throw new Error("--s2-run-dir is required");
  const sourceDirectory = path.resolve(sourceOption);
  const sourceArtifactHashes = artifactHashesSchema.parse(
    JSON.parse(
      await readFile(
        path.join(sourceDirectory, "artifact_hashes.json"),
        "utf8",
      ),
    ),
  );
  const [
    reviewBytes,
    sourceInventoryBytes,
    sourceUnitsBytes,
    sourceManifestBytes,
  ] = await Promise.all([
    verifiedSourceFile(
      sourceDirectory,
      "substantive_review.json",
      sourceArtifactHashes,
    ),
    verifiedSourceFile(
      sourceDirectory,
      "source_unit_aware_inventory.json",
      sourceArtifactHashes,
    ),
    verifiedSourceFile(
      sourceDirectory,
      "s0/source_units.json",
      sourceArtifactHashes,
    ),
    verifiedSourceFile(
      sourceDirectory,
      "run_manifest.json",
      sourceArtifactHashes,
    ),
  ]);
  const rawReview = JSON.parse(reviewBytes.toString()) as {
    schemaVersion?: unknown;
    sourceUnitAwareInventoryHash?: unknown;
    results?: unknown;
  };
  const parsedReview = cfxSubstantiveReviewOutputSchema.parse({
    results: rawReview.results,
  });
  const reviewInventory: CfxSubstantiveReviewInventory = {
    schemaVersion: "cfx.substantiveReview.v1",
    sourceUnitAwareInventoryHash: String(
      rawReview.sourceUnitAwareInventoryHash ?? "",
    ),
    // On-disk rows may already carry a prior evidenceSearchHandoff (recent
    // runSubstantiveReview.ts attaches it before persisting); discard it here
    // since attachCfxEvidenceSearchHandoffs below recomputes it fresh.
    results: parsedReview.results.map((row) => {
      const { evidenceSearchHandoff: _ignored, ...rest } = row;
      return rest;
    }),
  };
  const sourceInventory = cfxUnitAwareInventorySchema.parse(
    JSON.parse(sourceInventoryBytes.toString()),
  );
  const sourceUnits = sourceUnitsSchema.parse(
    JSON.parse(sourceUnitsBytes.toString()),
  );
  const sourceManifest = sourceManifestSchema.parse(
    JSON.parse(sourceManifestBytes.toString()),
  );
  if (
    reviewInventory.sourceUnitAwareInventoryHash
      !== sourceManifest.sourceInventoryHash
  ) {
    throw new Error("S2 source inventory linkage hash mismatch");
  }
  const attached = attachCfxEvidenceSearchHandoffs({
    reviewInventory,
    sourceInventory,
    article: { sourceUnits },
  });
  const sourceSubstantiveReviewHash = sha256(reviewBytes);
  const inventory = {
    schemaVersion: "cfx.evidenceSearchHandoff.v2" as const,
    sourceSubstantiveReviewHash,
    results: attached.results,
  };
  const inventoryText = `${JSON.stringify(inventory, null, 2)}\n`;
  const inventoryHash = sha256(inventoryText);
  const generatedAt = new Date().toISOString();
  const runId =
    `cfx-s2-evidence-search-${sourceManifest.runId}-${cfxTimestamp()}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/CF1-F03",
    runId,
  );
  await createImmutableDirectory(outputDirectory);
  await writeImmutableText(
    path.join(outputDirectory, "evidence_search_handoffs.json"),
    inventoryText,
  );
  await writeImmutableText(
    path.join(outputDirectory, "report.html"),
    buildCfxSubstantiveReviewReportHtml({
      runId,
      generatedAt,
      model: sourceManifest.model,
      sourceInventory,
      reviewInventory: attached,
      promptHash: sourceManifest.promptHash,
      schemaHash: sourceManifest.schemaHash,
      requestHash: sourceManifest.requestHash,
      sourceInventoryHash: sourceManifest.sourceInventoryHash,
      resultInventoryHash: inventoryHash,
      usage: sourceManifest.usage,
      latencyMs: sourceManifest.latencyMs,
    }),
  );
  await writeImmutableJson(path.join(outputDirectory, "run_manifest.json"), {
    schemaVersion: "cfx.evidenceSearchHandoffRun.v2",
    runId,
    generatedAt,
    status: "completed",
    sourceS2RunDirectory: sourceDirectory,
    sourceS2RunId: sourceManifest.runId,
    sourceSubstantiveReviewHash,
    sourceInventoryHash: sourceManifest.sourceInventoryHash,
    handoffInventoryHash: inventoryHash,
    propositionCount: inventory.results.length,
    modelCallsMade: 0,
    externalSearchesMade: 0,
  });
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
    runId,
    propositionCount: inventory.results.length,
    modelCallsMade: 0,
    externalSearchesMade: 0,
    artifactAggregateSha256: aggregateSha256,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
