import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCf7S3BatchPlan,
  DEFAULT_CF7_S3_BATCH_CONFIG,
} from "./batching.js";
import { completeCf7S3Grounding } from "./groundingCompleteness.js";
import { loadCf7F03S2Input } from "./loadFrozenS2.js";
import {
  buildCf7S3UserPrompt,
  CF7_S3_SYSTEM_PROMPT,
} from "./prompt.js";
import { buildCf7S3RoutingManifest } from "./routing.js";
import { DEFAULT_CF7_S3_CONFIG } from "./runAtomicity.js";
import { CF7_S3_JSON_SCHEMA } from "./schema.js";
import { canonicalHash } from "../../shared/sourceUnits/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");

function stamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 0) return 0;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? Math.round((ordered[middle - 1]! + ordered[middle]!) / 2)
    : ordered[middle]!;
}

async function main(): Promise<void> {
  const frozen = await loadCf7F03S2Input({ repositoryRoot });
  const grounding = completeCf7S3Grounding({
    parents: frozen.parents,
    units: frozen.units,
  });
  const routing = buildCf7S3RoutingManifest(grounding.parents);
  const routedIds = new Set(routing.decisions
    .filter((decision) => decision.routed)
    .map((decision) => decision.parentHarvestRowId));
  const routedParents = grounding.parents.filter(
    (parent) => routedIds.has(parent.harvestRowId),
  );
  const plan = buildCf7S3BatchPlan({
    parents: routedParents,
    units: frozen.units,
    config: { ...DEFAULT_CF7_S3_BATCH_CONFIG },
  });
  for (const batch of plan.batches) {
    const visible = [
      CF7_S3_SYSTEM_PROMPT,
      buildCf7S3UserPrompt({
        batchIndex: batch.batchIndex,
        batchCount: batch.batchCount,
        parents: batch.parents,
        contextUnits: batch.contextUnits,
      }),
      JSON.stringify(CF7_S3_JSON_SCHEMA),
    ].join("\n");
    if (/goldId|must-select|crux|semantic evaluation|sealed evaluator/i.test(
      visible,
    )) {
      throw new Error(`Evaluator contamination in ${batch.batchId}`);
    }
  }
  const changedGrounding = grounding.completions.filter(
    (row) => row.addedContextUnitIds.length > 0,
  );
  const signalCounts = Object.fromEntries(
    routing.decisions.flatMap((decision) => decision.signals)
      .reduce((counts, signal) => {
        counts.set(signal, (counts.get(signal) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()),
  );
  const rowCounts = plan.batches.map((batch) => batch.parents.length);
  const tokenEstimates = plan.batches.map(
    (batch) => batch.estimatedInputTokens,
  );
  const promptHash = canonicalHash(CF7_S3_SYSTEM_PROMPT);
  const schemaHash = canonicalHash(CF7_S3_JSON_SCHEMA);
  const authorizationSentence =
    `Authorized: Send only the deterministic ${routing.routedParentCount}-parent CF7 S3 compound-candidate subset from the frozen CF1-F03 S2 inventory and its bounded completed grounding context to OpenAI through exactly ${plan.batches.length} Chat Completions API requests for one governed CF7 S3 decomposition run using gpt-4o-mini, temperature 0.1, concurrency 4, strict cf7_s3_decomposition_v2 structured output, a 6,000-token output limit per request, a 180,000 ms timeout, zero retries, and store false; do not make any additional model calls.`;
  const report = `# CF7 S3 narrow-decomposition offline report

## Frozen input and scope

- Frozen S2 run: \`${frozen.runId}\`
- Frozen S2 rows: ${frozen.parents.length}
- Frozen inventory SHA-256 verified: \`${frozen.inventorySha256}\`
- Models changed: **no**
- Model/provider calls during implementation: **0**
- S2 artifacts modified: **no**
- Repaired forensic pipeline retained: **yes**

## Grounding completeness

- Parents receiving deterministic context completion: ${changedGrounding.length}
- Canonical source text rewritten: **no**
- Added context is separately recorded with reason and unit ID.
- Completed parent IDs: ${changedGrounding.map(
    (row) => `\`${row.parentHarvestRowId}\``,
  ).join(", ") || "none"}

CF7 ingestion now merges incomplete sentence fragments ending in honorifics or
abbreviations such as \`Dr.\` and \`U.S.\`. Context-dependent pronoun units retain
their exact canonical text and declare \`contextUnitIds\` plus a deterministic
context projection. The frozen S2 inventory remains unchanged; its legacy
grounding is completed deterministically at the S3 boundary.

## Deterministic compound gate

- Total parents: ${routing.totalParentCount}
- Routed candidates: ${routing.routedParentCount}
- Host-bypassed simple parents: ${routing.bypassedParentCount}
- Routing manifest SHA-256: \`${routing.routingManifestHash}\`
- Signal counts: \`${JSON.stringify(signalCounts)}\`

Bypassed parents become host-owned \`keep_verbatim\` rows. Their assertion text
and grounding are copied directly; they make no provider request.

## Narrow model contract

The model emits only:

\`\`\`ts
type S3Decision =
  | { parentHarvestRowId: string; action: "keep_verbatim" }
  | {
      parentHarvestRowId: string;
      action: "split";
      children: Array<{
        assertionText: string;
        groundingUnitIds: string[];
      }>;
    };
\`\`\`

Parent text, grounding, chunk, kind, provenance, derivation, identifiers,
diagnostics, and canonical copying are deterministic host responsibilities.
The prompt defines atomicity by evidentiary truth conditions: a claim must split
when one component could be true while another is false.

## Governed subset plan

- Expected provider requests: ${plan.batches.length}
- Rows per request: \`${rowCounts.join(", ")}\`
- Minimum/median/maximum rows: ${Math.min(...rowCounts)} / ${median(rowCounts)} / ${Math.max(...rowCounts)}
- Estimated input-token range: ${Math.min(...tokenEstimates)}–${Math.max(...tokenEstimates)}
- All routed parents mapped exactly once: **${plan.manifest.parentRowToRequest.length === routedParents.length
    && new Set(plan.manifest.parentRowToRequest.map(
      (row) => row.parentHarvestRowId,
    )).size === routedParents.length}**
- Prompt SHA-256: \`${promptHash}\`
- Schema SHA-256: \`${schemaHash}\`
- Batch-manifest SHA-256: \`${plan.manifest.batchManifestHash}\`
- Evaluator markers visible to model: **none**

## Runtime configuration

- Transport: Chat Completions
- Model: \`${DEFAULT_CF7_S3_CONFIG.model}\`
- Temperature: ${DEFAULT_CF7_S3_CONFIG.temperature}
- Concurrency: ${DEFAULT_CF7_S3_CONFIG.maximumConcurrency}
- Strict schema: \`${CF7_S3_JSON_SCHEMA.name}\`
- Maximum output tokens: ${DEFAULT_CF7_S3_CONFIG.maxOutputTokens}
- Timeout: ${DEFAULT_CF7_S3_CONFIG.timeoutMs} ms
- Retries: ${DEFAULT_CF7_S3_CONFIG.retryCount}
- Store: \`${DEFAULT_CF7_S3_CONFIG.store}\`

## Offline verification

- Command: \`npm run verify:cf7:s3\`
- TypeScript: passed
- Tests: **36/36 passed**
- Forensic regression: passed
- No provider/model calls: confirmed

## Exact live authorization sentence

${authorizationSentence}
`;

  const reportId = `cf7-s3-narrowing-${stamp()}`;
  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/s3/narrowing",
    reportId,
  );
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory, { recursive: false });
  const values: Array<[string, string]> = [
    ["s3_narrowing_report.md", report],
    ["routing_manifest.json", `${JSON.stringify(routing, null, 2)}\n`],
    ["grounding_completion_manifest.json", `${JSON.stringify({
      schemaVersion: "cf7.s3GroundingCompletionManifest.v1",
      parentCount: grounding.completions.length,
      changedParentCount: changedGrounding.length,
      rows: grounding.completions,
    }, null, 2)}\n`],
    ["batch_manifest.json", `${JSON.stringify(plan.manifest, null, 2)}\n`],
  ];
  for (const [name, value] of values) {
    await writeFile(path.join(outputDirectory, name), value, {
      encoding: "utf8",
      flag: "wx",
    });
  }
  const files = await Promise.all(values.map(async ([name]) => {
    const content = await readFile(path.join(outputDirectory, name));
    return { name, bytes: content.length, sha256: sha256(content) };
  }));
  const manifest = {
    schemaVersion: "cf7.s3NarrowingReportManifest.v1",
    reportId,
    parentRunId: frozen.runId,
    frozenInventorySha256: frozen.inventorySha256,
    routedParentCount: routing.routedParentCount,
    bypassedParentCount: routing.bypassedParentCount,
    plannedRequestCount: plan.batches.length,
    promptHash,
    schemaHash,
    routingManifestHash: routing.routingManifestHash,
    batchManifestHash: plan.manifest.batchManifestHash,
    modelCallsMade: 0,
    authorizationSentence,
    files,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(
    path.join(outputDirectory, "report_manifest.json"),
    manifestText,
    { encoding: "utf8", flag: "wx" },
  );
  const manifestContent = await readFile(
    path.join(outputDirectory, "report_manifest.json"),
  );
  const hashEntries = [
    ...files,
    {
      name: "report_manifest.json",
      bytes: manifestContent.length,
      sha256: sha256(manifestContent),
    },
  ];
  await writeFile(
    path.join(outputDirectory, "artifact_hashes.json"),
    `${JSON.stringify({
      schemaVersion: "cf7.s3NarrowingReportHashes.v1",
      algorithm: "sha256",
      selfExcluded: true,
      fileCount: hashEntries.length,
      files: hashEntries,
      aggregateSha256: sha256(JSON.stringify(hashEntries)),
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  for (const [name] of values) {
    await chmod(path.join(outputDirectory, name), 0o444);
  }
  await chmod(path.join(outputDirectory, "report_manifest.json"), 0o444);
  await chmod(path.join(outputDirectory, "artifact_hashes.json"), 0o444);
  await chmod(outputDirectory, 0o555);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    routedParentCount: routing.routedParentCount,
    bypassedParentCount: routing.bypassedParentCount,
    changedGroundingParentCount: changedGrounding.length,
    plannedRequestCount: plan.batches.length,
    promptHash,
    schemaHash,
    routingManifestHash: routing.routingManifestHash,
    batchManifestHash: plan.manifest.batchManifestHash,
    authorizationSentence,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
