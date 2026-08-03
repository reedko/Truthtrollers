import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Gde2ExperimentId,
  Gde2Output,
  Gde2Validation,
  SemanticGroupingAssertion,
} from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const runId = "cf7-gde2-cf1-f03-20260729013932";
const baselineRunId = "cf7-semantic-grouping-cf1-f03-20260729005359";
const runDirectory = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cf7/semantic-grouping-representative/CF1-F03",
  runId,
);
const baselineDirectory = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cf7/semantic-grouping/CF1-F03",
  baselineRunId,
);

type ValidationSummary = {
  status: "PASS" | "FAIL";
  experiments: Array<Gde2Validation & {
    experimentId: Gde2ExperimentId;
    schemaIssues: unknown[];
  }>;
};

type Accounting = {
  requestCount: number;
  completedRequestCount: number;
  failedRequestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
};

const judgments: Record<Gde2ExperimentId, {
  success: string;
  failure: string;
}> = {
  "G-A": {
    success:
      "H0068 is a concrete, central statement for its chronic-illness trend group.",
    failure:
      "The run omitted 167 assertions and duplicated seven; a good selected sentence cannot rescue an incomplete partition.",
  },
  "G-B": {
    success:
      "G20 concisely captures the shared thimerosal-deposition and neurotoxicity issue without copying a single row.",
    failure:
      "G2 merges vaccine-hesitant professionals with fervent pro-vaccine actors, so its representative collapses opposed positions into one population.",
  },
  "G-C": {
    success:
      "G014 appropriately synthesized the shared COVID-era reevaluation theme rather than forcing one contextual source row to stand for it.",
    failure:
      "G018 became a 91-assertion catch-all represented only as toxic-substance safety concerns; that sentence cannot represent the many aluminum, mercury, regulatory, concealment, and hazardous-waste propositions inside it.",
  },
  "D-A": {
    success:
      "H0051 provides a strong concrete entry point for the Vaccine Injury Act and manufacturer-liability conversation.",
    failure:
      "Several selections are not standalone representatives: H0081 is a pronoun-dependent fragment, H0181 and H0191 are list introductions, and H0221 is a question.",
  },
  "D-B": {
    success:
      "The synthesized inventory is consistently concise and separates major conversations such as liability, SIDS, aluminum, thimerosal, and censorship.",
    failure:
      "G3 compresses sequence into causation by saying the Act led to both increased doses and chronic health issues; the grouped assertions contain those elements but do not establish that full causal formulation as one bounded assertion.",
  },
  "D-C": {
    success:
      "H0030 is a useful representative of the CDC-cover-up and documentary conversation.",
    failure:
      "Hybrid selected an existing row for all 12 groups, including list-introduction H0191; it never exercised synthesis even when selection produced a weak standalone claim.",
  },
  "E-A": {
    success:
      "H0031 and H0132 are concrete, evidence-shaped representatives for their local reasoning units.",
    failure:
      "Only 95 of 267 assertions were assigned. The resulting representatives describe a small partial inventory, not the article-wide reasoning reconstruction.",
  },
  "E-B": {
    success:
      "G1 clearly expresses the contrast between official thimerosal-safety claims and contrary assertions in the group.",
    failure:
      "G4 introduces a polarity error: it says vaccine-hesitant parents are driven by fervent belief in vaccine safety, conflating two opposed populations present in the mixed group.",
  },
  "E-C": {
    success:
      "H0031 remains a strong selected representative for the MMR-data-manipulation group.",
    failure:
      "Hybrid selected in all 26 groups, including contextual H0126 (death of any child is tragic) and narrow H0176 (a formaldehyde quantity) for broader groups where synthesis was warranted.",
  },
};

function markdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function representativeOf(
  group: Gde2Output["groups"][number],
  assertionsById: Map<string, string>,
): { type: "selected" | "synthesized"; value: string } {
  if ("representativeAssertionId" in group) {
    const text = assertionsById.get(group.representativeAssertionId)
      ?? "[unknown assertion]";
    return {
      type: "selected",
      value: `${group.representativeAssertionId}: ${text}`,
    };
  }
  return { type: "synthesized", value: group.representativeAssertion };
}

async function main(): Promise<void> {
  const inventory = await readJson<SemanticGroupingAssertion[]>(
    path.join(runDirectory, "assertion_inventory.json"),
  );
  const assertionsById = new Map(
    inventory.map((row) => [row.assertionId, row.assertionText]),
  );
  const validation = await readJson<ValidationSummary>(
    path.join(runDirectory, "validation_summary.json"),
  );
  const accounting = await readJson<Accounting>(
    path.join(runDirectory, "request_accounting.json"),
  );
  const runManifest = await readJson<Record<string, unknown>>(
    path.join(runDirectory, "run_manifest.json"),
  );
  const artifactHashes = await readJson<{
    aggregateSha256: string;
    files: Array<{ name: string; bytes: number; sha256: string }>;
  }>(path.join(runDirectory, "artifact_hashes.json"));
  const baselineValidation = await readJson<{
    prompts: Array<{
      promptId: string;
      status: "PASS" | "FAIL";
      groupCount: number;
      largestGroupSize: number;
      smallestGroupSize: number;
      duplicateAssertionAssignments: string[];
      missingAssertionAssignments: string[];
      inventedAssertionAssignments: string[];
    }>;
  }>(path.join(baselineDirectory, "validation_summary.json"));

  const outputs = new Map<Gde2ExperimentId, Gde2Output>();
  for (const experiment of validation.experiments) {
    outputs.set(
      experiment.experimentId,
      await readJson<Gde2Output>(
        path.join(runDirectory, `${experiment.experimentId}_groups.json`),
      ),
    );
  }

  const lines: string[] = [
    "# CF7 GDE-2 Semantic Group Representative Assertion Experiment Report",
    "",
    "## Run identity",
    "",
    `- Run ID: \`${runId}\``,
    `- Frozen S2 parent run: \`${String(runManifest.parentRunId)}\``,
    `- Original GDE baseline: \`${baselineRunId}\``,
    `- Status: **${String(runManifest.status).toUpperCase()}**`,
    `- Model: \`${String(runManifest.model)}\``,
    `- Provider calls: ${String(runManifest.providerCallCount)} (exactly nine; no retries)`,
    `- Frozen assertion count: ${inventory.length}`,
    `- Frozen inventory SHA-256: \`${String(runManifest.frozenInventorySha256)}\``,
    `- Assertion inventory hash: \`${String(runManifest.assertionInventoryHash)}\``,
    `- Artifact aggregate SHA-256: \`${artifactHashes.aggregateSha256}\``,
    "- Article text outside assertions visible: no",
    "- Provenance outside assertion IDs visible: no",
    "- Sealed evaluator visible: no",
    "",
    "The provider completed all nine requests. The run status is failed because no output satisfied the complete, exactly-once grouping contract.",
    "",
    "## Experimental summary",
    "",
    "| Run | Grouping | Groups | Largest | Smallest | Duplicate assignments | Missing assertions | Selected reps | Synthesized reps |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const experiment of validation.experiments) {
    const output = outputs.get(experiment.experimentId)!;
    const representatives = output.groups.map((group) =>
      representativeOf(group, assertionsById));
    lines.push(
      `| ${experiment.experimentId} | ${experiment.status} | `
      + `${experiment.groupCount} | ${experiment.largestGroupSize} | `
      + `${experiment.smallestGroupSize} | `
      + `${experiment.duplicateAssertionAssignments.length} | `
      + `${experiment.missingAssertionAssignments.length} | `
      + `${representatives.filter((row) => row.type === "selected").length} | `
      + `${representatives.filter((row) => row.type === "synthesized").length} |`,
    );
  }

  lines.push(
    "",
    "## Comparison with original GDE grouping",
    "",
    "| Prompt | Run | Groups | Largest | Smallest | Duplicate assignments | Missing assertions |",
    "|---|---|---:|---:|---:|---:|---:|",
  );
  for (const promptId of ["G", "D", "E"]) {
    const baseline = baselineValidation.prompts.find(
      (row) => row.promptId === promptId,
    )!;
    lines.push(
      `| ${promptId} | Original | ${baseline.groupCount} | `
      + `${baseline.largestGroupSize} | ${baseline.smallestGroupSize} | `
      + `${baseline.duplicateAssertionAssignments.length} | `
      + `${baseline.missingAssertionAssignments.length} |`,
    );
    for (const experiment of validation.experiments.filter(
      (row) => row.experimentId.startsWith(`${promptId}-`),
    )) {
      lines.push(
        `| ${promptId} | ${experiment.experimentId} | `
        + `${experiment.groupCount} | ${experiment.largestGroupSize} | `
        + `${experiment.smallestGroupSize} | `
        + `${experiment.duplicateAssertionAssignments.length} | `
        + `${experiment.missingAssertionAssignments.length} |`,
      );
    }
  }
  lines.push(
    "",
    "Adding representative production was not partition-neutral. G moved from 21 groups to 10/24/18, D from 9 to 25/22/12, and E from 20 to 19/12/26. The representative task therefore changed the grouping behavior rather than merely annotating the original partition.",
    "",
  );

  for (const experiment of validation.experiments) {
    const output = outputs.get(experiment.experimentId)!;
    lines.push(
      `## ${experiment.experimentId}`,
      "",
      `- Grouping success/failure: **${experiment.status}**`,
      `- Group count: ${experiment.groupCount}`,
      `- Largest/smallest group: ${experiment.largestGroupSize}/${experiment.smallestGroupSize}`,
      `- Duplicate assignments: ${experiment.duplicateAssertionAssignments.length}`,
      `- Missing assertions: ${experiment.missingAssertionAssignments.length}`,
      `- Notable success: ${judgments[experiment.experimentId].success}`,
      `- Notable failure: ${judgments[experiment.experimentId].failure}`,
      "",
      "| Group | Size | Representative type | Representative assertion output |",
      "|---|---:|---|---|",
    );
    for (const group of output.groups) {
      const representative = representativeOf(group, assertionsById);
      lines.push(
        `| ${markdown(group.groupId)} | ${group.assertionIds.length} | `
        + `${representative.type} | ${markdown(representative.value)} |`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Comparative analysis",
    "",
    "### Did the representatives capture group meaning?",
    "",
    "Often, but not reliably. The best synthesized representatives are concise abstractions of coherent groups. The weakest outputs expose a coupling problem: when grouping is mixed or oversized, the representative either collapses distinct propositions or describes only one slice of the group.",
    "",
    "### Did selected assertions adequately represent their groups?",
    "",
    "Selection was provenance-safe but uneven. Strong selections such as H0031, H0051, H0068, and H0132 are concrete and standalone. Weak selections include pronoun-dependent fragments (H0081), list introductions (H0181/H0191), a question (H0221), and general context (H0126). An existing member is not necessarily a semantic representative.",
    "",
    "### Did synthesized assertions introduce unsupported information?",
    "",
    "At least one clear polarity conflation occurred: E-B G4 says vaccine-hesitant parents are driven by fervent belief in vaccine safety, combining statements about vaccine-hesitant people with separate statements attacking fervent pro-vaccine actors. Several other rows introduced causal compression or generalized beyond a heterogeneous group, notably D-B G3 and G-B G2. These are not safe to publish as evidence-ready claims without another semantic or grounding check.",
    "",
    "### Did Hybrid choose appropriately?",
    "",
    "No. Hybrid selected existing rows for 50 of 56 groups (89.3%). D-C and E-C selected for every group. It retained weak fragments and context even where synthesis was explicitly available. G-C did synthesize six groups, but one synthesis represented an oversized 91-assertion catch-all, which is a grouping failure rather than a representative solution.",
    "",
    "### Strongest prompt and variant",
    "",
    "- Strongest representative prose: **G-B**. It produced 24 generally coherent synthesized representatives and covered 260 of 267 assertions, but still duplicated five assignments and contained a population/polarity conflation.",
    "- Most provenance-safe variant: **A**, because every representative is a byte-identical existing assertion with a direct ID. It is not consistently representative or complete.",
    "- Most evidence-ready surface form: **B**, but only after downstream grounding/semantic validation. Without that additional pass, A is safer but lower quality.",
    "- Hybrid did not outperform the fixed strategies; its strong bias toward selection prevented it from using synthesis where selection was visibly weak.",
    "",
    "### Excellent representatives",
    "",
    "- G-B G20: “Thimerosal in vaccines has been shown to accumulate in the brain, raising concerns about its neurotoxic effects.”",
    "- D-B G7: “Efforts to screen films and discussions about vaccine safety have faced significant censorship and resistance.”",
    "- E-B G1: “The type of mercury in vaccines is claimed to be harmless, yet evidence suggests otherwise.”",
    "- D-A G5 selected H0051, a concrete statement of the liability pressure preceding the 1986 Act.",
    "",
    "### Poor representatives",
    "",
    "- E-B G4 conflates vaccine-hesitant and pro-vaccine populations and reverses their relationship to vaccine-safety belief.",
    "- D-A G7 selects H0081, “it has nothing to do with the vaccines,” which is not standalone.",
    "- D-C G9 selects H0191, a list-introduction sentence, for a broader aluminum-safety conversation.",
    "- G-C G018 uses a generic toxic-substances sentence for 91 assertions spanning multiple distinct mechanisms, substances, studies, institutions, and regulatory claims.",
    "",
    "## Integrity and accounting",
    "",
    `- Requests expected/completed/failed: 9/${accounting.completedRequestCount}/${accounting.failedRequestCount}`,
    "- Retries: 0",
    `- Input tokens: ${accounting.inputTokens}`,
    `- Cached input tokens: ${accounting.cachedInputTokens}`,
    `- Output tokens: ${accounting.outputTokens}`,
    `- Total tokens: ${accounting.totalTokens}`,
    `- Aggregate request latency: ${accounting.latencyMs} ms`,
    `- Immutable run-artifact files hashed: ${artifactHashes.files.length}`,
    "- Every request has request.json, raw_response.json, response metadata, hashes, and validation.",
    "- Every raw response was written before validation.",
    "",
    "## Judgment",
    "",
    "**GDE2_SINGLE_PASS_REPRESENTATIVE_FAIL**",
    "",
    "Semantic grouping can generate useful representative candidates in the same call, especially with synthesis, but this experiment does not support eliminating an additional semantic pass. All nine partitions failed completeness; selected representatives were sometimes non-standalone or unrepresentative; synthesized representatives sometimes conflated polarity or compressed causality; and Hybrid did not reliably choose between the two modes.",
    "",
    "The representative outputs are valuable candidate-generation artifacts. They are not yet a governed replacement for downstream claim selection and grounding validation.",
  );

  const reportDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/semantic-grouping-representative/reports",
    runId,
  );
  await mkdir(path.dirname(reportDirectory), { recursive: true });
  await mkdir(reportDirectory, { recursive: false });
  const reportText = `${lines.join("\n")}\n`;
  const reportName = "gde2_semantic_group_representative_report.md";
  await writeFile(path.join(reportDirectory, reportName), reportText, {
    encoding: "utf8",
    flag: "wx",
  });
  const manifest = {
    schemaVersion: "cf7.gde2ReportManifest.v1",
    runId,
    baselineRunId,
    reportFile: reportName,
    reportSha256: sha256(reportText),
    sourceRunArtifactAggregateSha256: artifactHashes.aggregateSha256,
    semanticReviewMethod:
      "Direct human-readable review of representatives against their model-visible group assertion texts; no model or sealed evaluator used.",
    modelCallsMade: 0,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(
    path.join(reportDirectory, "report_manifest.json"),
    manifestText,
    { encoding: "utf8", flag: "wx" },
  );
  await chmod(path.join(reportDirectory, reportName), 0o444);
  await chmod(path.join(reportDirectory, "report_manifest.json"), 0o444);
  await chmod(reportDirectory, 0o555);
  process.stdout.write(`${JSON.stringify({
    reportDirectory,
    ...manifest,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
