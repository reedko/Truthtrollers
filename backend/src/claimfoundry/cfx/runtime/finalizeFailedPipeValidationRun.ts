import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  aggregateArtifactHash,
  freezeArtifactTree,
  hashArtifactTree,
  sha256,
  writeImmutableJson,
  writeImmutableText,
} from "../artifacts/immutableArtifacts.js";
import {
  CFX_REPOSITORY_ROOT,
  option,
} from "./paths.js";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function main(): Promise<void> {
  const relativeRun = option("--run-dir");
  if (!relativeRun) throw new Error("--run-dir is required");
  const runDirectory = path.resolve(relativeRun);
  const repositoryArtifactRoot = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/pipe-validation",
  );
  if (!runDirectory.startsWith(`${repositoryArtifactRoot}${path.sep}`)) {
    throw new Error("Failed run is outside the CFX validation artifact root");
  }
  const [validation, parsed, metadata] = await Promise.all([
    readFile(path.join(runDirectory, "s1-validation.json"), "utf8")
      .then(JSON.parse),
    readFile(
      path.join(runDirectory, "raw-provider-responses/s1-model.parsed.json"),
      "utf8",
    ).then(JSON.parse),
    readFile(
      path.join(runDirectory, "raw-provider-responses/s1-model.metadata.json"),
      "utf8",
    ).then(JSON.parse),
  ]);
  if (validation.status !== "failed") {
    throw new Error("Run is not an S1 failure");
  }
  const pathParts = runDirectory.split(path.sep);
  const runId = pathParts.at(-1)!;
  const fixtureId = pathParts.at(-2)!;
  const validationId = pathParts.at(-3)!;
  await writeImmutableJson(path.join(runDirectory, "s1-propositions.json"), {
    status: "rejected",
    publicationBlocked: true,
    rawParsedOutput: parsed,
    diagnostics: validation.diagnostics,
  });
  for (const file of [
    "s2-substantive-review.json",
    "deterministic-evidence-handoff.json",
    "query-plan.json",
  ]) {
    await writeImmutableJson(path.join(runDirectory, file), {
      status: "not_run",
      reason: "S1_STRUCTURAL_VALIDATION_FAILED",
    });
  }
  await writeImmutableJson(
    path.join(runDirectory, "normalized-candidates.json"),
    [],
  );
  await writeImmutableJson(
    path.join(runDirectory, "deduped-candidates.json"),
    { candidates: [], duplicateMerges: [] },
  );
  const usage = metadata.usage ?? {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  await writeImmutableJson(
    path.join(runDirectory, "retrieval-accounting.json"),
    {
      schemaVersion: "cfx.pipeValidationAccounting.v1",
      modelRequestCount: 1,
      retrievalRequestCount: 0,
      retrievalProviderRequestCount: 0,
      retrievalProviderFailureCount: 0,
      ...usage,
      modelLatencyMs: metadata.latencyMs ?? 0,
      retrievalLatencyMs: 0,
      rawCandidateCount: 0,
      deduplicatedCandidateCount: 0,
      duplicateCount: 0,
      estimatedCostUsd: null,
    },
  );
  await writeImmutableText(
    path.join(runDirectory, "report.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(runId)} failed</title></head>
<body><h1>${escapeHtml(runId)} — S1 validation failure</h1>
<p>The provider returned twelve rows, but publication and all downstream calls were blocked.</p>
<pre>${escapeHtml(JSON.stringify(validation.diagnostics, null, 2))}</pre>
<p>No retry, S2 call, planning call, or retrieval call occurred.</p></body></html>`,
  );
  const runManifest = {
    schemaVersion: "cfx.pipeValidationRun.v1",
    validationId,
    runId,
    runLabel: runId.endsWith("run-a") ? "run-a" : "run-b",
    fixtureId,
    status: "failed_s1_validation",
    generatedAt: new Date().toISOString(),
    modelCallCount: 1,
    propositionCount: 0,
    rawS1RowCount: Array.isArray(parsed.propositions)
      ? parsed.propositions.length
      : 0,
    retrievalRequestCount: 0,
    retrievalProviderRequestCount: 0,
    providerFailureCount: 0,
    rawCandidateCount: 0,
    deduplicatedCandidateCount: 0,
    fullTextFetchCount: 0,
    bearingJudgmentCount: 0,
    evidenceStanceJudgmentCount: 0,
    candidateScoreCount: 0,
    usage,
    failure: {
      stage: "S1",
      diagnostics: validation.diagnostics,
      rawResponsePreserved: true,
      downstreamCallsPrevented: 2,
    },
  };
  await writeImmutableJson(
    path.join(runDirectory, "run-manifest.json"),
    runManifest,
  );
  const files = await hashArtifactTree(runDirectory);
  const aggregateSha256 = aggregateArtifactHash(files);
  await writeImmutableJson(
    path.join(runDirectory, "artifact-hashes.json"),
    {
      schemaVersion: "cfx.artifactHashes.v1",
      algorithm: "sha256",
      selfExcluded: true,
      files,
      aggregateSha256,
    },
  );
  await freezeArtifactTree(runDirectory);
  process.stdout.write(`${JSON.stringify({
    runDirectory,
    status: runManifest.status,
    modelCallCount: 1,
    artifactAggregateSha256: aggregateSha256,
    manifestSha256: sha256(`${JSON.stringify(runManifest, null, 2)}\n`),
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
