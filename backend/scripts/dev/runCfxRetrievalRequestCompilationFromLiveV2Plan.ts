// backend/scripts/dev/runCfxRetrievalRequestCompilationFromLiveV2Plan.ts
//
// One-off diagnostic (not wired into any request path, not a permanent
// automated test): compiles the final retrieval-request set from the
// canonical live v2 query plan
//   artifacts/claim-foundry/cfx/CF1-F03/cfx-live-query-planning-v2-from-s1-20260804070737-s2-20260804070755-20260804074312/query-plan.json
// through the real, unmodified production compiler
// (retrievalRequests() in src/claimfoundry/cfx/retrieval/executeRetrieval.ts).
// Makes no provider/model calls of any kind -- retrievalRequests() is a pure
// function over an already-merged CfxQueryPlan.
//
// Usage: npx tsx scripts/dev/runCfxRetrievalRequestCompilationFromLiveV2Plan.ts

import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { retrievalRequests } from "../../src/claimfoundry/cfx/retrieval/executeRetrieval.js";
import type { CfxQueryPlan, CfxRetrievalRequest } from "../../src/claimfoundry/cfx/retrieval/types.js";
import {
  createImmutableDirectory,
  writeImmutableJson,
  hashArtifactTree,
  aggregateArtifactHash,
} from "../../src/claimfoundry/cfx/artifacts/immutableArtifacts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../..");

function cfxTimestamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

async function main(): Promise<void> {
  const sourceRunDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cfx/CF1-F03/cfx-live-query-planning-v2-from-s1-20260804070737-s2-20260804070755-20260804074312",
  );
  const plan = JSON.parse(
    await readFile(path.join(sourceRunDirectory, "query-plan.json"), "utf8"),
  ) as CfxQueryPlan;
  const evidenceInputs = JSON.parse(
    await readFile(path.join(sourceRunDirectory, "evidence_inputs.json"), "utf8"),
  );

  const runId = `cfx-retrieval-request-compilation-v2-from-s1-20260804070737-s2-20260804070755-${cfxTimestamp()}`;
  const outputDirectory = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03", runId);
  await createImmutableDirectory(outputDirectory);

  await writeImmutableJson(path.join(outputDirectory, "provenance.json"), {
    sourceQueryPlanningRunDirectory: path.relative(repositoryRoot, sourceRunDirectory),
    sourceEvidenceInputHash: plan.sourceEvidenceInputHash,
  });
  await writeImmutableJson(path.join(outputDirectory, "evidence_inputs.json"), evidenceInputs);
  await writeImmutableJson(path.join(outputDirectory, "merged_query_plan.json"), plan);

  // ---- Every logical Q1-Q5 lane before final compilation (already the
  // merged plan's own shape -- preserved verbatim, not recomputed).
  const logicalLanes = plan.propositions.flatMap((proposition) =>
    proposition.queries.map((query) => ({
      propositionId: proposition.propositionId,
      queryId: query.queryId,
      queryIntent: query.queryIntent,
      lane: query.lane,
      query: query.query,
      provider: query.provider,
      origin: query.origin,
      missingReason: query.missingReason,
      compiledFromLiteralComponents: query.compiledFromLiteralComponents,
      pubmedFallbacks: query.pubmedFallbacks,
    })));
  await writeImmutableJson(path.join(outputDirectory, "logical_lanes.json"), logicalLanes);

  // ---- THE COMPILATION CALL: the real, unmodified production compiler.
  const requests: CfxRetrievalRequest[] = retrievalRequests(plan);
  await writeImmutableJson(path.join(outputDirectory, "retrieval_requests.json"), requests);

  // ---- Accounting.
  const omittedLanes = logicalLanes.filter((lane) => !lane.query || !lane.provider);
  const requestIds = requests.map((r) => r.requestId);
  const duplicateRequestIds = requestIds.filter((id, i) => requestIds.indexOf(id) !== i);
  const propositionIds = [...new Set(requests.map((r) => r.propositionId))].sort();
  const perProposition: Record<string, { laneCounts: Record<string, number>; requestCount: number }> = {};
  for (const proposition of plan.propositions) {
    const propRequests = requests.filter((r) => r.propositionId === proposition.propositionId);
    perProposition[proposition.propositionId] = {
      laneCounts: Object.fromEntries(
        ["Q1", "Q2", "Q3", "Q4", "Q5"].map((id) => [id, propRequests.filter((r) => r.queryId === id).length]),
      ),
      requestCount: propRequests.length,
    };
  }
  const laneAccounting = Object.fromEntries(
    ["Q1", "Q2", "Q3", "Q4", "Q5"].map((id) => [id, requests.filter((r) => r.queryId === id).length]),
  );
  const providerAccounting = {
    web: requests.filter((r) => r.provider === "web").length,
    pubmed: requests.filter((r) => r.provider === "pubmed").length,
  };
  const omittedLaneReasonCounts: Record<string, number> = {};
  for (const lane of omittedLanes) {
    const reason = lane.missingReason || "UNKNOWN";
    omittedLaneReasonCounts[reason] = (omittedLaneReasonCounts[reason] || 0) + 1;
  }
  const studyPubmedExpansions = logicalLanes.filter((lane) => lane.compiledFromLiteralComponents);
  const emptyQueryStrings = requests.filter((r) => !r.query || !r.query.trim());
  const unknownPropositionIds = propositionIds.filter(
    (id) => !plan.propositions.some((p) => p.propositionId === id),
  );

  const accounting = {
    logicalLaneCount: logicalLanes.length,
    finalRequestCount: requests.length,
    perProposition,
    laneAccounting,
    providerAccounting,
    omittedLanes,
    omittedLaneReasonCounts,
    studyPubmedExpansionCount: studyPubmedExpansions.length,
    studyPubmedExpansions,
    duplicateRequestIds,
    emptyQueryStrings,
    unknownPropositionIds,
    propositionCount: propositionIds.length,
    allPropositionsHaveQ1: plan.propositions.every((p) => perProposition[p.propositionId]!.laneCounts.Q1 === 1),
    allPropositionsHaveQ2: plan.propositions.every((p) => perProposition[p.propositionId]!.laneCounts.Q2 === 1),
    allPropositionsHaveQ4: plan.propositions.every((p) => perProposition[p.propositionId]!.laneCounts.Q4 === 1),
    allPropositionsHaveQ5: plan.propositions.every((p) => perProposition[p.propositionId]!.laneCounts.Q5 === 1),
  };
  await writeImmutableJson(path.join(outputDirectory, "accounting.json"), accounting);

  const files = await hashArtifactTree(outputDirectory);
  const artifactAggregateSha256 = aggregateArtifactHash(files);
  await writeImmutableJson(path.join(outputDirectory, "run-manifest.json"), {
    schemaVersion: "cfx.retrievalRequestCompilationRun.v1",
    runId,
    generatedAt: new Date().toISOString(),
    sourceQueryPlanningRunDirectory: path.relative(repositoryRoot, sourceRunDirectory),
    sourceEvidenceInputHash: plan.sourceEvidenceInputHash,
    compilerFunction: "retrievalRequests (src/claimfoundry/cfx/retrieval/executeRetrieval.ts)",
    modelCallCount: 0,
    providerCallCount: 0,
    logicalLaneCount: accounting.logicalLaneCount,
    finalRequestCount: accounting.finalRequestCount,
    artifactAggregateSha256,
  });
  await writeImmutableJson(path.join(outputDirectory, "artifact-hashes.json"), { files, artifactAggregateSha256 });

  console.log(JSON.stringify({
    outputDirectory: path.relative(repositoryRoot, outputDirectory),
    ...accounting,
  }, null, 2));
}

main().catch((error) => {
  console.error("[RETRIEVAL REQUEST COMPILATION] FAILED:", error);
  process.exitCode = 1;
});
