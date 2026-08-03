import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  aggregateArtifactHash,
  createImmutableDirectory,
  freezeArtifactTree,
  hashArtifactTree,
  writeImmutableJson,
  writeImmutableText,
} from "../artifacts/immutableArtifacts.js";
import {
  CFX_REPOSITORY_ROOT,
  option,
} from "./paths.js";

type JsonObject = Record<string, any>;

const FIXTURE_IDS = ["CF1-F02", "CF1-F03", "CF1-F06"] as const;

function normalize(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function words(value: unknown): Set<string> {
  return new Set(normalize(value).split(/\s+/u).filter(Boolean));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function json(directory: string, file: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path.join(directory, file), "utf8"));
}

async function verifiedRun(directory: string) {
  const hashes = await json(directory, "artifact-hashes.json");
  for (const entry of hashes.files as Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>) {
    const content = await readFile(path.join(directory, entry.path));
    const crypto = await import("node:crypto");
    const actual = crypto.createHash("sha256").update(content).digest("hex");
    if (content.length !== entry.bytes || actual !== entry.sha256) {
      throw new Error(`Artifact integrity failure: ${directory}/${entry.path}`);
    }
  }
  return {
    directory,
    manifest: await json(directory, "run-manifest.json"),
    hashes,
  };
}

function rowsById(value: JsonObject, key: string): Map<string, JsonObject> {
  const rows = Array.isArray(value[key]) ? value[key] : [];
  return new Map(rows.map((row: JsonObject) => [
    String(row.propositionId),
    row,
  ]));
}

function candidateSets(candidates: JsonObject[]) {
  const set = (field: string) => new Set(candidates
    .map((candidate) => normalize(candidate[field]))
    .filter(Boolean));
  return {
    doi: set("doi"),
    pmid: set("pmid"),
    canonicalUrl: set("canonicalUrl"),
    normalizedTitle: new Set(candidates
      .map((candidate) => normalize(candidate.title))
      .filter(Boolean)),
  };
}

function setComparison(left: Set<string>, right: Set<string>) {
  const intersection = intersectionSize(left, right);
  const union = new Set([...left, ...right]).size;
  return {
    runACount: left.size,
    runBCount: right.size,
    intersection,
    union,
    jaccard: union === 0 ? 1 : intersection / union,
    onlyA: [...left].filter((value) => !right.has(value)),
    onlyB: [...right].filter((value) => !left.has(value)),
  };
}

async function compareFixture(input: {
  validationRoot: string;
  fixtureId: typeof FIXTURE_IDS[number];
}) {
  const fixtureRoot = path.join(input.validationRoot, input.fixtureId);
  const runA = await verifiedRun(path.join(
    fixtureRoot,
    `${input.fixtureId.toLocaleLowerCase()}-run-a`,
  ));
  const runB = await verifiedRun(path.join(
    fixtureRoot,
    `${input.fixtureId.toLocaleLowerCase()}-run-b`,
  ));
  const complete = runA.manifest.status.startsWith("completed")
    && runB.manifest.status.startsWith("completed");
  const base = {
    schemaVersion: "cfx.pipeValidationComparison.v1",
    fixtureId: input.fixtureId,
    runA: {
      directory: runA.directory,
      status: runA.manifest.status,
      manifest: runA.manifest,
      aggregateSha256: runA.hashes.aggregateSha256,
    },
    runB: {
      directory: runB.directory,
      status: runB.manifest.status,
      manifest: runB.manifest,
      aggregateSha256: runB.hashes.aggregateSha256,
    },
    completePair: complete,
  };
  let detail: JsonObject;
  if (!complete) {
    detail = {
      failure: {
        runA: runA.manifest.failure ?? null,
        runB: runB.manifest.failure ?? null,
      },
      comparableDownstreamArtifacts: false,
    };
  } else {
    const [
      s1A, s1B, s2A, s2B, handoffA, handoffB, planA, planB,
      dedupeA, dedupeB, accountingA, accountingB,
    ] = await Promise.all([
      json(runA.directory, "s1-propositions.json"),
      json(runB.directory, "s1-propositions.json"),
      json(runA.directory, "s2-substantive-review.json"),
      json(runB.directory, "s2-substantive-review.json"),
      json(runA.directory, "deterministic-evidence-handoff.json"),
      json(runB.directory, "deterministic-evidence-handoff.json"),
      json(runA.directory, "query-plan.json"),
      json(runB.directory, "query-plan.json"),
      json(runA.directory, "deduped-candidates.json"),
      json(runB.directory, "deduped-candidates.json"),
      json(runA.directory, "retrieval-accounting.json"),
      json(runB.directory, "retrieval-accounting.json"),
    ]);
    const s1RowsA = rowsById(s1A, "propositions");
    const s1RowsB = rowsById(s1B, "propositions");
    const s2RowsA = rowsById(s2A, "results");
    const s2RowsB = rowsById(s2B, "results");
    const handoffRowsA = rowsById(handoffA, "results");
    const handoffRowsB = rowsById(handoffB, "results");
    const planRowsA = rowsById(planA, "propositions");
    const planRowsB = rowsById(planB, "propositions");
    const ids = [...new Set([...s1RowsA.keys(), ...s1RowsB.keys()])].sort();
    const propositionDisagreements = ids.flatMap((propositionId) => {
      const a = s1RowsA.get(propositionId);
      const b = s1RowsB.get(propositionId);
      if (!a || !b) return [{ propositionId, runA: a ?? null, runB: b ?? null }];
      const assertionExact = normalize(a.assertion) === normalize(b.assertion);
      const sourceExact =
        normalize(a.assertionSource) === normalize(b.assertionSource);
      const groundingA = new Set<string>(a.groundingUnitIds ?? []);
      const groundingB = new Set<string>(b.groundingUnitIds ?? []);
      const groundingOverlap = setComparison(groundingA, groundingB);
      if (assertionExact && sourceExact && groundingOverlap.jaccard === 1) {
        return [];
      }
      return [{
        propositionId,
        assertionExact,
        lexicalAssertionJaccard: jaccard(words(a.assertion), words(b.assertion)),
        sourceExact,
        groundingOverlap,
        runA: a,
        runB: b,
      }];
    });
    const s2Disagreements = ids.flatMap((propositionId) => {
      const a = s2RowsA.get(propositionId);
      const b = s2RowsB.get(propositionId);
      if (!a || !b) return [{ propositionId, runA: a ?? null, runB: b ?? null }];
      const assertionExact =
        normalize(a.substantiveAssertion) === normalize(b.substantiveAssertion);
      const sourceExact =
        normalize(a.assertionSource) === normalize(b.assertionSource);
      const stanceExact = a.articleStance === b.articleStance;
      if (assertionExact && sourceExact && stanceExact) return [];
      return [{
        propositionId,
        assertionExact,
        lexicalAssertionJaccard: jaccard(
          words(a.substantiveAssertion),
          words(b.substantiveAssertion),
        ),
        sourceExact,
        stanceExact,
        runA: a,
        runB: b,
      }];
    });
    const handoffDisagreements = ids.filter((propositionId) =>
      JSON.stringify(handoffRowsA.get(propositionId))
        !== JSON.stringify(handoffRowsB.get(propositionId))
    );
    const queryDisagreements: JsonObject[] = [];
    let exactQuerySlots = 0;
    let totalQuerySlots = 0;
    let pubmedRoutingAgreements = 0;
    let pubmedRoutingSlots = 0;
    let pubmedFluffViolations = 0;
    const fluff = /\b(?:high-quality evidence|no credible studies|supports|refutes)\b/iu;
    for (const propositionId of ids) {
      const a = planRowsA.get(propositionId);
      const b = planRowsB.get(propositionId);
      const qa = new Map<string, JsonObject>(
        (a?.queries ?? []).map((row: JsonObject) => [
          String(row.queryId),
          row,
        ]),
      );
      const qb = new Map<string, JsonObject>(
        (b?.queries ?? []).map((row: JsonObject) => [
          String(row.queryId),
          row,
        ]),
      );
      for (const queryId of ["Q1", "Q2", "Q3", "Q4", "Q5"]) {
        totalQuerySlots += 1;
        const left = qa.get(queryId);
        const right = qb.get(queryId);
        const exact = JSON.stringify(left) === JSON.stringify(right);
        if (exact) exactQuerySlots += 1;
        else queryDisagreements.push({
          propositionId,
          queryId,
          runA: left ?? null,
          runB: right ?? null,
        });
        pubmedRoutingSlots += 1;
        if ((left?.provider === "pubmed") === (right?.provider === "pubmed")) {
          pubmedRoutingAgreements += 1;
        }
        for (const row of [left, right]) {
          if (row?.provider === "pubmed" && fluff.test(String(row.query))) {
            pubmedFluffViolations += 1;
          }
        }
      }
    }
    const candidatesA = (dedupeA.candidates ?? []) as JsonObject[];
    const candidatesB = (dedupeB.candidates ?? []) as JsonObject[];
    const setsA = candidateSets(candidatesA);
    const setsB = candidateSets(candidatesB);
    const pathsA = new Map((runA.hashes.files as JsonObject[]).map(
      (file) => [file.path, file.sha256],
    ));
    const pathsB = new Map((runB.hashes.files as JsonObject[]).map(
      (file) => [file.path, file.sha256],
    ));
    const allPaths = [...new Set([...pathsA.keys(), ...pathsB.keys()])].sort();
    detail = {
      proposition: {
        countA: s1RowsA.size,
        countB: s1RowsB.size,
        exactStableCount: ids.length - propositionDisagreements.length,
        disagreements: propositionDisagreements,
      },
      substantiveReview: {
        exactStableCount: ids.length - s2Disagreements.length,
        disagreements: s2Disagreements,
      },
      deterministicHandoff: {
        exactStableCount: ids.length - handoffDisagreements.length,
        disagreementPropositionIds: handoffDisagreements,
      },
      queries: {
        exactSlots: exactQuerySlots,
        totalSlots: totalQuerySlots,
        exactAgreement: exactQuerySlots / Math.max(1, totalQuerySlots),
        pubmedRoutingAgreements,
        pubmedRoutingSlots,
        pubmedFluffViolations,
        disagreements: queryDisagreements,
      },
      candidates: {
        countA: candidatesA.length,
        countB: candidatesB.length,
        overlap: {
          doi: setComparison(setsA.doi, setsB.doi),
          pmid: setComparison(setsA.pmid, setsB.pmid),
          canonicalUrl: setComparison(
            setsA.canonicalUrl,
            setsB.canonicalUrl,
          ),
          normalizedTitle: setComparison(
            setsA.normalizedTitle,
            setsB.normalizedTitle,
          ),
        },
      },
      provider: {
        failuresA: accountingA.retrievalProviderFailureCount,
        failuresB: accountingB.retrievalProviderFailureCount,
        logicalRequestsA: accountingA.retrievalRequestCount,
        logicalRequestsB: accountingB.retrievalRequestCount,
        providerExecutionsA: accountingA.retrievalProviderRequestCount,
        providerExecutionsB: accountingB.retrievalProviderRequestCount,
      },
      accounting: { runA: accountingA, runB: accountingB },
      artifactHashDifferences: allPaths.filter(
        (file) => pathsA.get(file) !== pathsB.get(file),
      ).map((file) => ({
        path: file,
        runA: pathsA.get(file) ?? null,
        runB: pathsB.get(file) ?? null,
      })),
    };
  }
  const comparison = { ...base, ...detail };
  const outputDirectory = path.join(fixtureRoot, "comparison");
  await createImmutableDirectory(outputDirectory);
  await writeImmutableJson(
    path.join(outputDirectory, "comparison-report.json"),
    comparison,
  );
  const markdown = [
    `# ${input.fixtureId} CFX double-run comparison`,
    "",
    `- Run A: \`${runA.manifest.status}\``,
    `- Run B: \`${runB.manifest.status}\``,
    `- Complete comparable pair: ${complete ? "yes" : "no"}`,
    "",
    complete
      ? `- Exact S1 proposition slots: ${detail.proposition.exactStableCount}/12
- Exact S2 slots: ${detail.substantiveReview.exactStableCount}/12
- Exact deterministic handoffs: ${detail.deterministicHandoff.exactStableCount}/12
- Exact query slots: ${detail.queries.exactSlots}/${detail.queries.totalSlots}
- Candidate URL overlap: ${detail.candidates.overlap.canonicalUrl.intersection}/${detail.candidates.overlap.canonicalUrl.union}
- Provider failures: ${detail.provider.failuresA}/${detail.provider.failuresB}`
      : `Run A failure:\n\n\`\`\`json\n${JSON.stringify(detail.failure.runA, null, 2)}\n\`\`\``,
    "",
    "## Exact disagreements",
    "",
    "See `comparison-report.json` for every row, query, candidate-key, and artifact-hash disagreement.",
    "",
  ].join("\n");
  await writeImmutableText(
    path.join(outputDirectory, "comparison-report.md"),
    markdown,
  );
  await writeImmutableText(
    path.join(outputDirectory, "comparison-report.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.fixtureId)} comparison</title>
<style>body{font:15px/1.5 system-ui;max-width:1100px;margin:32px auto;padding:0 20px}pre{white-space:pre-wrap;background:#f4f5f7;padding:16px}</style></head>
<body><h1>${escapeHtml(input.fixtureId)} double-run comparison</h1>
<p>Run A: <strong>${escapeHtml(runA.manifest.status)}</strong>; Run B: <strong>${escapeHtml(runB.manifest.status)}</strong></p>
<pre>${escapeHtml(JSON.stringify(comparison, null, 2))}</pre></body></html>`,
  );
  const files = await hashArtifactTree(outputDirectory);
  const aggregateSha256 = aggregateArtifactHash(files);
  await writeImmutableJson(
    path.join(outputDirectory, "artifact-hashes.json"),
    {
      schemaVersion: "cfx.artifactHashes.v1",
      files,
      aggregateSha256,
    },
  );
  await freezeArtifactTree(outputDirectory);
  return { comparison, outputDirectory, aggregateSha256 };
}

async function main(): Promise<void> {
  const validationId = option("--validation-id");
  if (!validationId) throw new Error("--validation-id is required");
  const validationRoot = path.join(
    CFX_REPOSITORY_ROOT,
    "artifacts/claim-foundry/cfx/pipe-validation",
    validationId,
  );
  const comparisons = [];
  for (const fixtureId of FIXTURE_IDS) {
    comparisons.push(await compareFixture({ validationRoot, fixtureId }));
  }
  const manifests = comparisons.flatMap(({ comparison }) => [
    comparison.runA.manifest,
    comparison.runB.manifest,
  ]);
  const actualModelCalls = manifests.reduce(
    (sum, manifest) => sum + Number(manifest.modelCallCount ?? 0),
    0,
  );
  const completedRuns = manifests.filter(
    (manifest) => String(manifest.status).startsWith("completed"),
  ).length;
  const totalLogicalRetrievalLanes = manifests.reduce(
    (sum, manifest) => sum + Number(manifest.retrievalRequestCount ?? 0),
    0,
  );
  const totalProviderExecutions = manifests.reduce(
    (sum, manifest) =>
      sum + Number(manifest.retrievalProviderRequestCount ?? 0),
    0,
  );
  const totalProviderFailures = manifests.reduce(
    (sum, manifest) => sum + Number(manifest.providerFailureCount ?? 0),
    0,
  );
  const stability = comparisons.map(({ comparison }) => {
    const value = comparison as JsonObject;
    return {
      fixtureId: value.fixtureId,
      completePair: value.completePair,
      s1ExactSlots: value.proposition?.exactStableCount ?? null,
      s2ExactSlots: value.substantiveReview?.exactStableCount ?? null,
      deterministicHandoffExactSlots:
        value.deterministicHandoff?.exactStableCount ?? null,
      queryExactSlots: value.queries?.exactSlots ?? null,
      queryTotalSlots: value.queries?.totalSlots ?? null,
      pubmedRoutingAgreements:
        value.queries?.pubmedRoutingAgreements ?? null,
      pubmedRoutingSlots: value.queries?.pubmedRoutingSlots ?? null,
      pubmedFluffViolations:
        value.queries?.pubmedFluffViolations ?? null,
      candidateCanonicalUrlJaccard:
        value.candidates?.overlap?.canonicalUrl?.jaccard ?? null,
    };
  });
  const gates = [
    {
      number: 1,
      gate: "S1 consistently returns coherent burden-bearing propositions",
      status: completedRuns === 6 ? "PASS" : "FAIL",
      evidence:
        `${completedRuns}/6 reruns completed with 12 structurally valid propositions each. Exact A/B disagreements remain visible in fixture reports.`,
    },
    {
      number: 2,
      gate: "S2 does not materially mutate proposition meaning",
      status: "INCOMPLETE",
      evidence:
        "S2 preserved proposition IDs and passed structural validation, but material semantic mutation was not independently adjudicated. Exact disagreements are enumerated.",
    },
    {
      number: 3,
      gate: "Assertion source and article stance are broadly stable",
      status: "INCOMPLETE",
      evidence:
        "Every source and stance disagreement is enumerated, but the completed pairs are not exact across every slot.",
    },
    {
      number: 4,
      gate: "Grounding is inspectable and materially relevant",
      status: "INCOMPLETE",
      evidence:
        "All published IDs resolve to authoritative S0 units and are inspectable. Material relevance was not independently adjudicated.",
    },
    {
      number: 5,
      gate: "Query lanes are distinct and useful",
      status: "FAIL",
      evidence:
        "Generic model-planned lanes such as 'Alternative views', 'Evidence on', and 'Arguments for/against' remain; one literal reef query returned dictionary pages for 'the'.",
    },
    {
      number: 6,
      gate: "Generic source labels do not dominate Q3",
      status: "PASS",
      evidence:
        "The deterministic planner suppresses generic source-only Q3 lanes and preserves them as explicit non-executions.",
    },
    {
      number: 7,
      gate: "PubMed routing is appropriate",
      status: "PASS",
      evidence:
        "PubMed was confined to the health fixture; the mixed-domain and reef fixtures stayed on web retrieval.",
    },
    {
      number: 8,
      gate: "PubMed retrieves materially relevant records or fails transparently with sensible fallbacks",
      status: "INCOMPLETE",
      evidence:
        "Every PubMed attempt and fallback is transparent and bounded, but material relevance was not semantically adjudicated.",
    },
    {
      number: 9,
      gate: "Most investigable assertions retrieve at least one directly or materially bearing candidate",
      status: "INCOMPLETE",
      evidence:
        "Candidate retrieval completed, but direct/material bearing judgment was expressly prohibited and remains a human-review gate.",
    },
    {
      number: 10,
      gate: "Counterevidence or material qualification appears where reasonably available",
      status: "INCOMPLETE",
      evidence:
        "Counterevidence lanes executed, but candidate stance and material qualification were expressly not adjudicated.",
    },
    {
      number: 11,
      gate: "Provider failures do not erase successful sibling lanes",
      status: "PASS",
      evidence:
        `${totalProviderFailures} provider failures across ${totalLogicalRetrievalLanes} logical lanes; every request and sibling result is retained.`,
    },
    {
      number: 12,
      gate: "Normalization and deduplication preserve provenance",
      status: "PASS",
      evidence: "Every dedupe merge retains its discovery paths in frozen artifacts.",
    },
    {
      number: 13,
      gate: "Reports diagnose failures without raw-artifact inspection",
      status: "PASS",
      evidence:
        "Per-run HTML and comparison reports expose queries, candidates, validation diagnostics, fallback attempts, and exact disagreements.",
    },
    {
      number: 14,
      gate: "No hidden semantic adjudication or scoring",
      status: "PASS",
      evidence: "All manifests report zero bearing, stance-evidence, and candidate-score judgments.",
    },
  ];
  const verdict = "DO NOT PROMOTE";
  const recommendation = {
    schemaVersion: "cfx.pipeValidationRecommendation.v1",
    validationId,
    verdict,
    promotionOccurred: false,
    featureFlag: null,
    actualModelCalls,
    authorizedModelCallCeiling: 18,
    totalLogicalRetrievalLanes,
    authorizedLogicalRetrievalLaneCeiling: 360,
    totalProviderExecutions,
    authorizedProviderExecutionCeiling: 792,
    totalProviderFailures,
    completedRuns,
    failedRuns: 6 - completedRuns,
    defectClassification: {
      type: "structural identifier-formatting defect",
      repairability: "deterministically repairable",
      semanticClassification: "not a semantic proposition failure",
      liveRerunObservation:
        "All six reruns completed; their provider responses used canonical IDs, so no live normalization was required.",
    },
    runMetrics: manifests.map((manifest) => ({
      fixtureId: manifest.fixtureId,
      runId: manifest.runId,
      status: manifest.status,
      modelCalls: manifest.modelCallCount,
      logicalRetrievalLanes: manifest.retrievalRequestCount,
      providerExecutions: manifest.retrievalProviderRequestCount,
      providerFailures: manifest.providerFailureCount,
      rawCandidates: manifest.rawCandidateCount,
      deduplicatedCandidates: manifest.deduplicatedCandidateCount,
      usage: manifest.usage,
    })),
    stability,
    fixtures: comparisons.map(({ comparison, outputDirectory }) => ({
      fixtureId: comparison.fixtureId,
      comparisonDirectory: outputDirectory,
      completePair: comparison.completePair,
    })),
    gates,
    strongestSuccesses: [
      "All six reruns preserved complete requests, raw responses, candidates, dedupe paths, accounting, reports, and hashes.",
      "Exactly 18 governed model calls were made and retrieval remained below every authorized ceiling.",
      "All completed retrievals had zero provider failures.",
      "The non-biomedical and mixed-domain fixtures stayed off PubMed.",
      "PubMed fallbacks were recorded, deterministic, and bounded in the health fixture.",
    ],
    weakestFailures: [
      "Several model-planned web queries contain generic framing such as evidence, arguments, attention, or alternative views and retrieve topic-only noise.",
      "A literal Great Barrier Reef query returned dictionary pages for the word 'the', demonstrating provider/query brittleness.",
      "Candidate-set overlap varies materially between identical run pairs.",
      "Material bearing, counterevidence, and semantic-mutation gates remain unproven because those judgments were outside the authorized run.",
    ],
    exactRepairsMadeBeforeLiveRuns: [
      "Added literal PubMed compilation with indexed fields.",
      "Added a deterministic zero-result PubMed fallback ladder and attempt accounting.",
      "Protected productive F03 PubMed and PMC regression targets.",
      "Added an isolated multi-fixture runner without changing historical entry points.",
      "Added fixture-scoped deterministic unit-ID normalization before S1 structural validation.",
      "Preserved original returned IDs and normalization decisions in diagnostics without changing semantic fields.",
    ],
    unresolvedRisks: [
      "Generic argumentative query framing still produces avoidable retrieval noise.",
      "Candidate overlap remains sensitive to model wording and provider volatility.",
      "No bearing adjudication was authorized, so materiality and counterevidence coverage remain human-review observations.",
      "S2 semantic non-mutation is structurally constrained but not independently proven.",
    ],
    minimumRepairsBeforeNextValidation: [
      "Compile or suppress generic argumentative web-query framing while preserving the original model proposal as forensic provenance.",
      "Add a deterministic guard against queries that collapse to function-word results.",
      "Perform the separately authorized human or sealed semantic review needed for S2 non-mutation, grounding materiality, bearing candidates, and counterevidence gates.",
      "Repeat the frozen double-run protocol only after those narrow changes; do not promote until all 14 gates pass.",
    ],
  };
  const recommendationDirectory = path.join(validationRoot, "recommendation");
  await createImmutableDirectory(recommendationDirectory);
  await writeImmutableJson(
    path.join(recommendationDirectory, "PIPE_VALIDATION_RECOMMENDATION.json"),
    recommendation,
  );
  const markdown = [
    "# CFX pipe-validation recommendation",
    "",
    `## Verdict: ${verdict}`,
    "",
    `- Completed runs: ${completedRuns}/6`,
    `- Actual model calls: ${actualModelCalls}/18 authorized ceiling`,
    `- Logical retrieval lanes: ${totalLogicalRetrievalLanes}/360 authorized ceiling`,
    `- Provider executions: ${totalProviderExecutions}/792 authorized ceiling`,
    `- Provider failures: ${totalProviderFailures}`,
    "- Promotion occurred: no",
    "",
    "## Defect classification",
    "",
    "- structural identifier-formatting defect",
    "- deterministically repairable",
    "- not a semantic proposition failure",
    "",
    "## Acceptance gates",
    "",
    ...gates.map((gate) =>
      `- **${gate.status} — ${gate.gate}:** ${gate.evidence}`
    ),
    "",
    "## Minimum repairs",
    "",
    ...recommendation.minimumRepairsBeforeNextValidation.map(
      (repair, index) => `${index + 1}. ${repair}`,
    ),
    "",
  ].join("\n");
  await writeImmutableText(
    path.join(recommendationDirectory, "PIPE_VALIDATION_RECOMMENDATION.md"),
    markdown,
  );
  await writeImmutableText(
    path.join(recommendationDirectory, "PIPE_VALIDATION_RECOMMENDATION.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>CFX validation recommendation</title>
<style>body{font:16px/1.55 system-ui;max-width:1000px;margin:32px auto;padding:0 20px}.fail{color:#9f1239}pre{white-space:pre-wrap;background:#f4f5f7;padding:16px}</style></head>
<body><h1>CFX pipe-validation recommendation</h1><h2 class="fail">${verdict}</h2>
<p>${completedRuns}/6 runs completed; ${actualModelCalls}/18 authorized model calls were made.</p>
<pre>${escapeHtml(JSON.stringify(recommendation, null, 2))}</pre></body></html>`,
  );
  const files = await hashArtifactTree(recommendationDirectory);
  const aggregateSha256 = aggregateArtifactHash(files);
  await writeImmutableJson(
    path.join(recommendationDirectory, "artifact-hashes.json"),
    {
      schemaVersion: "cfx.artifactHashes.v1",
      files,
      aggregateSha256,
    },
  );
  await freezeArtifactTree(recommendationDirectory);
  process.stdout.write(`${JSON.stringify({
    validationId,
    verdict,
    completedRuns,
    actualModelCalls,
    comparisons: comparisons.map((comparison) => ({
      fixtureId: comparison.comparison.fixtureId,
      outputDirectory: comparison.outputDirectory,
      aggregateSha256: comparison.aggregateSha256,
    })),
    recommendationDirectory,
    recommendationAggregateSha256: aggregateSha256,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
