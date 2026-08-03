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
  loadVerifiedCfxEvidenceInputs,
} from "../retrieval/loadEvidenceInputs.js";
import {
  mergeCfxQueryPlan,
} from "../retrieval/queryPlanning.js";
import {
  CFX_REPOSITORY_ROOT,
  cfxTimestamp,
  option,
} from "./paths.js";

const artifactManifestSchema = z.object({
  aggregateSha256: z.string(),
  files: z.array(z.object({
    path: z.string(),
    bytes: z.number(),
    sha256: z.string(),
  })),
}).passthrough();

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownCell(value: unknown): string {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

async function verifiedFile(
  directory: string,
  relativePath: string,
  manifest: z.infer<typeof artifactManifestSchema>,
): Promise<Buffer> {
  const expected = manifest.files.find((file) =>
    file.path === relativePath);
  if (!expected) throw new Error(`Missing hash for ${relativePath}`);
  const content = await readFile(path.join(directory, relativePath));
  if (
    content.length !== expected.bytes
    || sha256(content) !== expected.sha256
  ) {
    throw new Error(`Artifact hash mismatch for ${relativePath}`);
  }
  return content;
}

async function main(): Promise<void> {
  const evidenceRun = option("--evidence-handoff-run-dir");
  const retrievalRunOption = option("--retrieval-run-dir");
  if (!evidenceRun || !retrievalRunOption) {
    throw new Error(
      "--evidence-handoff-run-dir and --retrieval-run-dir are required",
    );
  }
  const retrievalRun = path.resolve(retrievalRunOption);
  const sourceManifest = artifactManifestSchema.parse(JSON.parse(
    await readFile(
      path.join(retrievalRun, "artifact-hashes.json"),
      "utf8",
    ),
  ));
  const [oldPlanBytes, modelOutputBytes] = await Promise.all([
    verifiedFile(retrievalRun, "query-plan.json", sourceManifest),
    verifiedFile(
      retrievalRun,
      "planning-parsed-response.json",
      sourceManifest,
    ),
  ]);
  const baselinePath = path.join(
    CFX_REPOSITORY_ROOT,
    "backend/test/claimfoundry/cfx/fixtures/f03PubmedRetrievalBaseline.json",
  );
  const baselineBytes = await readFile(baselinePath);
  const baseline = JSON.parse(baselineBytes.toString()) as {
    protectedSuccessfulQueries: Array<{
      propositionId: string;
      queryId: string;
      query: string;
      goodPmidIds: string[];
    }>;
    protectedWebCandidates: Array<{
      propositionId: string;
      queryId: string;
      query: string;
      url: string;
      title: string;
      classification: "user_confirmed_good";
      reason: string;
    }>;
    zeroResultQueries: Array<{
      propositionId: string;
      queryId: string;
      query: string;
    }>;
    reviewedCandidates: Array<{
      propositionId: string;
      queryId: string;
      pmid: string;
      title: string;
      classification: "good" | "not_good";
      reason: string;
    }>;
  };
  if (baseline.protectedSuccessfulQueries.length !== 2) {
    throw new Error("Unexpected protected PubMed baseline shape");
  }
  const verifiedInputs = await loadVerifiedCfxEvidenceInputs(evidenceRun);
  const oldPlan = JSON.parse(oldPlanBytes.toString()) as {
    propositions: Array<{
      propositionId: string;
      queries: Array<{
        queryId: string;
        provider: string | null;
        query: string | null;
      }>;
    }>;
  };
  const newPlan = mergeCfxQueryPlan({
    inputs: verifiedInputs.inputs,
    sourceEvidenceInputHash: verifiedInputs.inputHash,
    modelOutput: JSON.parse(modelOutputBytes.toString()),
  });
  const before = oldPlan.propositions.flatMap((proposition) =>
    proposition.queries.filter((query) => query.provider === "pubmed")
      .map((query) => ({
        propositionId: proposition.propositionId,
        queryId: query.queryId,
        query: query.query,
      }))
  );
  const after = newPlan.propositions.flatMap((proposition) =>
    proposition.queries.filter((query) => query.provider === "pubmed")
      .map((query) => ({
        propositionId: proposition.propositionId,
        queryId: query.queryId,
        query: query.query,
        modelProposedQuery: query.modelProposedQuery,
        compiledFromLiteralComponents:
          query.compiledFromLiteralComponents,
      }))
  );
  const afterBySlot = new Map(after.map((query) => [
    `${query.propositionId}:${query.queryId}`,
    query,
  ]));
  const newPlanBySlot = new Map<
    string,
    (typeof newPlan.propositions)[number]["queries"][number]
  >(newPlan.propositions.flatMap(
    (proposition) => proposition.queries.map((query) => [
      `${proposition.propositionId}:${query.queryId}`,
      query,
    ] as const),
  ));
  const protectedQueryChecks = baseline.protectedSuccessfulQueries.map(
    (protectedQuery) => {
      const afterQuery = afterBySlot.get(
        `${protectedQuery.propositionId}:${protectedQuery.queryId}`,
      );
      return {
        ...protectedQuery,
        preservedAsModelProposedQuery:
          afterQuery?.modelProposedQuery === protectedQuery.query,
        newlyCompiledQuery: afterQuery?.query ?? null,
      };
    },
  );
  if (protectedQueryChecks.some(
    (check) => !check.preservedAsModelProposedQuery,
  )) {
    throw new Error("Protected successful PubMed query was not preserved");
  }
  const protectedWebCandidateChecks = baseline.protectedWebCandidates.map(
    (candidate) => {
      const planned = newPlanBySlot.get(
        `${candidate.propositionId}:${candidate.queryId}`,
      );
      return {
        ...candidate,
        queryPreserved: planned?.query === candidate.query,
        providerPreserved: planned?.provider === "web",
      };
    },
  );
  if (protectedWebCandidateChecks.some(
    (check) => !check.queryPreserved || !check.providerPreserved,
  )) {
    throw new Error("Protected successful web candidate lane was not preserved");
  }
  const prohibitedFluff =
    /\b(?:high-quality evidence|no credible studies|research on|evidence on|evidence that|studies suggesting)\b/iu;
  const afterFluffViolations = after.filter(
    (query) => query.query && prohibitedFluff.test(query.query),
  );
  if (afterFluffViolations.length > 0) {
    throw new Error("Compiled PubMed query retained evidentiary fluff");
  }
  const comparison = {
    schemaVersion: "cfx.pubmedCompilerComparison.v1",
    sourceRetrievalRunDirectory: retrievalRun,
    sourceRetrievalArtifactAggregateSha256:
      sourceManifest.aggregateSha256,
    sourceEvidenceInputHash: verifiedInputs.inputHash,
    baselineHash: sha256(baselineBytes),
    beforePubmedQueryCount: before.length,
    afterPubmedQueryCount: after.length,
    reviewedGoodCandidateCount: baseline.reviewedCandidates.filter(
      (candidate) => candidate.classification === "good",
    ).length,
    reviewedNotGoodCandidateCount: baseline.reviewedCandidates.filter(
      (candidate) => candidate.classification === "not_good",
    ).length,
    zeroResultQueryCount: baseline.zeroResultQueries.length,
    protectedQueryChecks,
    protectedWebCandidateChecks,
    afterFluffViolations,
    modelCallsMade: 0,
    retrievalCallsMade: 0,
  };
  const runId = `cfx-pubmed-compiler-comparison-${cfxTimestamp()}`;
  const outputDirectory = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/CF1-F03",
    runId,
  );
  await createImmutableDirectory(outputDirectory);
  await writeImmutableText(
    path.join(outputDirectory, "frozen_pubmed_baseline.json"),
    baselineBytes.toString(),
  );
  await writeImmutableJson(
    path.join(outputDirectory, "before_pubmed_queries.json"),
    before,
  );
  await writeImmutableJson(
    path.join(outputDirectory, "after_pubmed_queries.json"),
    after,
  );
  await writeImmutableJson(
    path.join(outputDirectory, "query-plan-v2.json"),
    newPlan,
  );
  await writeImmutableJson(
    path.join(outputDirectory, "comparison.json"),
    comparison,
  );
  const report = [
    "# CFX PubMed query compiler comparison",
    "",
    `Source run: \`${path.basename(retrievalRun)}\``,
    "",
    "No model or retrieval call was made.",
    "",
    "The old broad prose queries contained indexed biomedical terms, so PubMed could still return top-ranked matches. The frozen review shows the result: a few useful records mixed with many records that did not bear on the proposition.",
    "",
    "## Frozen candidate review",
    "",
    `- Good or materially relevant: ${comparison.reviewedGoodCandidateCount}`,
    `- Not good / off-target: ${comparison.reviewedNotGoodCandidateCount}`,
    `- PubMed queries with zero results: ${comparison.zeroResultQueryCount}`,
    "",
    "### Good or materially relevant",
    "",
    "| Proposition/query | PMID | Title | Review reason |",
    "|---|---:|---|---|",
    ...baseline.reviewedCandidates
      .filter((candidate) => candidate.classification === "good")
      .map((candidate) =>
        `| ${candidate.propositionId}/${candidate.queryId} | [${candidate.pmid}](https://pubmed.ncbi.nlm.nih.gov/${candidate.pmid}/) | ${markdownCell(candidate.title)} | ${markdownCell(candidate.reason)} |`
      ),
    "",
    "### Not good / off-target",
    "",
    "| Proposition/query | PMID | Title | Review reason |",
    "|---|---:|---|---|",
    ...baseline.reviewedCandidates
      .filter((candidate) => candidate.classification === "not_good")
      .map((candidate) =>
        `| ${candidate.propositionId}/${candidate.queryId} | [${candidate.pmid}](https://pubmed.ncbi.nlm.nih.gov/${candidate.pmid}/) | ${markdownCell(candidate.title)} | ${markdownCell(candidate.reason)} |`
      ),
    "",
    "## Protected successful-query lineage",
    "",
    ...protectedQueryChecks.flatMap((check) => [
      `### ${check.propositionId}/${check.queryId}`,
      "",
      `- Original successful query: \`${check.query}\``,
      `- Preserved as model proposal: ${check.preservedAsModelProposedQuery ? "yes" : "no"}`,
      `- New executed PubMed query: \`${check.newlyCompiledQuery}\``,
      `- Protected good PMIDs: ${check.goodPmidIds.join(", ")}`,
      "",
    ]),
    "## Protected web candidate outside the PubMed compiler",
    "",
    ...protectedWebCandidateChecks.flatMap((check) => [
      `- ${check.propositionId}/${check.queryId}: [${check.title}](${check.url})`,
      `  - Canonical query preserved: ${check.queryPreserved ? "yes" : "no"}`,
      `  - Web provider preserved: ${check.providerPreserved ? "yes" : "no"}`,
      `  - Reason: ${check.reason}`,
    ]),
    "",
    "## All PubMed query changes",
    "",
    ...before.flatMap((oldQuery) => {
      const replacement = afterBySlot.get(
        `${oldQuery.propositionId}:${oldQuery.queryId}`,
      );
      return [
        `- ${oldQuery.propositionId}/${oldQuery.queryId}`,
        `  - Before: \`${oldQuery.query}\``,
        `  - After: \`${replacement?.query ?? "routed away from PubMed"}\``,
      ];
    }),
    "",
  ].join("\n");
  await writeImmutableText(
    path.join(outputDirectory, "report.md"),
    report,
  );
  const candidateRows = (classification: "good" | "not_good") =>
    baseline.reviewedCandidates
      .filter((candidate) => candidate.classification === classification)
      .map((candidate) => `<tr>
        <td>${escapeHtml(candidate.propositionId)}/${escapeHtml(candidate.queryId)}</td>
        <td><a href="https://pubmed.ncbi.nlm.nih.gov/${escapeHtml(candidate.pmid)}/">${escapeHtml(candidate.pmid)}</a></td>
        <td>${escapeHtml(candidate.title)}</td>
        <td>${escapeHtml(candidate.reason)}</td>
      </tr>`).join("\n");
  const queryRows = before.map((oldQuery) => {
    const replacement = afterBySlot.get(
      `${oldQuery.propositionId}:${oldQuery.queryId}`,
    );
    return `<tr>
      <td>${escapeHtml(oldQuery.propositionId)}/${escapeHtml(oldQuery.queryId)}</td>
      <td><code>${escapeHtml(oldQuery.query)}</code></td>
      <td><code>${escapeHtml(replacement?.query ?? "routed away from PubMed")}</code></td>
    </tr>`;
  }).join("\n");
  const reportHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CFX PubMed query compiler comparison</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:1280px;margin:32px auto;padding:0 24px;color:#17212b;background:#f7f8fa}
h1,h2{line-height:1.2} .card{background:#fff;border:1px solid #d9dee5;border-radius:10px;padding:18px;margin:18px 0}
.metrics{display:flex;gap:12px;flex-wrap:wrap}.metric{background:#eef3f8;border-radius:8px;padding:10px 14px}
table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #d9dee5;padding:8px;text-align:left;vertical-align:top}
th{background:#eef3f8}code{white-space:pre-wrap;overflow-wrap:anywhere}.good{color:#146c43}.bad{color:#9a3412}
</style>
</head>
<body>
<h1>CFX PubMed query compiler comparison</h1>
<p>Frozen source run: <code>${escapeHtml(path.basename(retrievalRun))}</code></p>
<p><strong>No model or retrieval call was made.</strong> This is an offline compiler comparison against the frozen provider output.</p>
<div class="metrics">
  <div class="metric"><strong>${comparison.reviewedGoodCandidateCount}</strong><br>good/materially relevant</div>
  <div class="metric"><strong>${comparison.reviewedNotGoodCandidateCount}</strong><br>not good/off-target</div>
  <div class="metric"><strong>${comparison.zeroResultQueryCount}</strong><br>zero-result queries</div>
  <div class="metric"><strong>${before.length} → ${after.length}</strong><br>PubMed query lanes</div>
</div>
<div class="card"><h2>Why the old queries returned PubMed articles</h2>
<p>The broad prose strings still contained indexed biomedical terms, so PubMed could return top-ranked matches. The result was mixed: a few useful records and substantial off-target retrieval.</p></div>
<h2 class="good">Good or materially relevant</h2>
<table><thead><tr><th>Slot</th><th>PMID</th><th>Title</th><th>Review reason</th></tr></thead>
<tbody>${candidateRows("good")}</tbody></table>
<h2 class="bad">Not good / off-target</h2>
<table><thead><tr><th>Slot</th><th>PMID</th><th>Title</th><th>Review reason</th></tr></thead>
<tbody>${candidateRows("not_good")}</tbody></table>
<h2>Before / after executable PubMed queries</h2>
<table><thead><tr><th>Slot</th><th>Before</th><th>After</th></tr></thead>
<tbody>${queryRows}</tbody></table>
<div class="card"><h2>Preservation gate</h2>
<p>The two productive original query strings remain unchanged in <code>modelProposedQuery</code>, and their five reviewed-good PMIDs are frozen as regression targets. The rewritten queries have not yet been sent to PubMed, so live PMID retention is not claimed by this offline report.</p>
<p>The user-confirmed good article <a href="${escapeHtml(protectedWebCandidateChecks[0]?.url)}">${escapeHtml(protectedWebCandidateChecks[0]?.title)}</a> remains protected by the unchanged ${escapeHtml(protectedWebCandidateChecks[0]?.propositionId)}/${escapeHtml(protectedWebCandidateChecks[0]?.queryId)} canonical web lane.</p>
<p>Artifact source hash: <code>${escapeHtml(sourceManifest.aggregateSha256)}</code></p></div>
</body></html>`;
  await writeImmutableText(
    path.join(outputDirectory, "report.html"),
    reportHtml,
  );
  await writeImmutableJson(
    path.join(outputDirectory, "run_manifest.json"),
    {
      schemaVersion: "cfx.pubmedCompilerComparisonRun.v1",
      runId,
      generatedAt: new Date().toISOString(),
      status: "completed",
      comparison,
    },
  );
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
    ...comparison,
    artifactAggregateSha256: aggregateSha256,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
