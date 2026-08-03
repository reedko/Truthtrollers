import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  SEMANTIC_GROUPING_PROMPTS,
} from "./prompts.js";
import {
  SEMANTIC_GROUPING_PROMPT_IDS,
} from "./runExperiment.js";
import type {
  SemanticGroupingAssertion,
  SemanticGroupingOutput,
  SemanticGroupingPromptId,
  SemanticGroupingValidation,
} from "./types.js";

const observations: Record<SemanticGroupingPromptId, string[]> = {
  A: [
    "Groups appear primarily topic-oriented.",
    "Several broad umbrellas overlap: injury, policy, ingredients, censorship, and controversy recur across multiple groups.",
    "Very broad umbrella groups formed.",
  ],
  B: [
    "Groups appear primarily reasoning-role-oriented through background, evidence, conclusions, counterarguments, and consequences.",
    "Argument roles overlap extensively; the same assertions are reused across evidence, conclusions, counterarguments, and consequences.",
    "Very broad argument-role groups formed.",
  ],
  C: [
    "Groups appear organized by underlying real-world subjects.",
    "The five connected components are broad and merge several mechanisms and controversies.",
    "Thimerosal-related assertions cross component boundaries.",
  ],
  D: [
    "Distinct conversations are separated into nine substantive issues.",
    "The groups preserve recognizable issue progressions while remaining broader than the reasoning-unit outputs.",
    "No duplicate assignments occurred, although six assertions were omitted.",
  ],
  E: [
    "Groups appear reasoning-oriented and preserve causal and narrative chains.",
    "The twenty groups separate local reasoning units more aggressively than the other prompts.",
    "Over-fragmentation is visible relative to the macro-conversation outputs.",
  ],
  F: [
    "Groups appear topic-oriented.",
    "A 232-assertion vaccination-safety umbrella absorbs most of the inventory.",
    "Unrelated mechanisms, events, policy claims, and consequences are over-merged.",
  ],
  G: [
    "Groups reconstruct a recognizable conceptual progression through the article.",
    "Local events, evidence clusters, policy discussions, ingredient mechanisms, and thimerosal material remain separately organized.",
    "The output is fine-grained without the extensive overlap seen in the broad topic and argument-role prompts.",
  ],
};

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function main(): Promise<void> {
  const runDirectoryArgument = process.argv[2];
  if (!runDirectoryArgument) {
    throw new Error("Usage: writeSemanticGroupingReport.ts <run-directory>");
  }
  const runDirectory = path.resolve(runDirectoryArgument);
  const runManifest = JSON.parse(
    await readFile(path.join(runDirectory, "run_manifest.json"), "utf8"),
  ) as Record<string, unknown>;
  const assertions = JSON.parse(
    await readFile(path.join(runDirectory, "assertion_inventory.json"), "utf8"),
  ) as SemanticGroupingAssertion[];
  const validationSummary = JSON.parse(
    await readFile(path.join(runDirectory, "validation_summary.json"), "utf8"),
  ) as { prompts: Array<SemanticGroupingValidation & {
    promptId: SemanticGroupingPromptId;
  }> };
  const assertionById = new Map(
    assertions.map((row) => [row.assertionId, row.assertionText]),
  );
  const sections: string[] = [];
  for (const promptId of SEMANTIC_GROUPING_PROMPT_IDS) {
    const output = JSON.parse(
      await readFile(
        path.join(runDirectory, `prompt_${promptId}_groups.json`),
        "utf8",
      ),
    ) as SemanticGroupingOutput;
    const validation = validationSummary.prompts.find(
      (row) => row.promptId === promptId,
    );
    if (!validation) throw new Error(`Missing validation for prompt ${promptId}`);
    const groupListing = output.groups.map((group) => {
      const assertionsRendered = group.assertionIds.map((assertionId) =>
        `- \`${assertionId}\`: ${assertionById.get(assertionId)
          ?? "[unknown assertion ID]"}`).join("\n");
      return `### ${group.groupId}

- Assertion IDs: ${group.assertionIds.map((id) => `\`${id}\``).join(", ")}
- Assertion count: ${group.assertionIds.length}

${assertionsRendered}`;
    }).join("\n\n");
    sections.push(`## Prompt ${promptId}

### Prompt

- Prompt identifier: \`${promptId}\`

\`\`\`text
${SEMANTIC_GROUPING_PROMPTS[promptId]}
\`\`\`

### Output statistics

| Metric | Value |
|---|---:|
| Semantic groups | ${validation.groupCount} |
| Largest group | ${validation.largestGroupSize} |
| Smallest group | ${validation.smallestGroupSize} |
| Mean group size | ${validation.meanGroupSize} |
| Empty groups | ${validation.emptyGroupIds.length} |
| Duplicate assertion assignments | ${validation.duplicateAssertionAssignments.length} |
| Missing assertion assignments | ${validation.missingAssertionAssignments.length} |
| Invented assertion assignments | ${validation.inventedAssertionAssignments.length} |

- Empty group IDs: ${validation.emptyGroupIds.map((id) => `\`${id}\``).join(", ") || "none"}
- Duplicate assignments: ${validation.duplicateAssertionAssignments.map((id) => `\`${id}\``).join(", ") || "none"}
- Missing assignments: ${validation.missingAssertionAssignments.map((id) => `\`${id}\``).join(", ") || "none"}

### Group listing

${groupListing}

### Observations

${observations[promptId].map((item) => `- ${item}`).join("\n")}`);
  }
  const report = `# CF7 Semantic Grouping Experiment report

## Run

- Run ID: \`${String(runManifest.runId)}\`
- Experiment package: v0.1
- Frozen assertion count: ${assertions.length}
- Model: \`${String(runManifest.model)}\`
- Provider calls: ${String(runManifest.providerCallCount)}
- Additional calls: 0
- Frozen inventory SHA-256: \`${String(runManifest.frozenInventorySha256)}\`
- Assertion inventory hash: \`${String(runManifest.assertionInventoryHash)}\`
- Common-rules hash: \`${String(runManifest.commonRulesHash)}\`
- Schema hash: \`${String(runManifest.schemaHash)}\`
- Run status: \`${String(runManifest.status)}\`

The following observations describe the returned structures. They do not score
assertion truth and do not alter any grouping.

${sections.join("\n\n")}

## Final comparison

### Which prompt produced the most coherent semantic organization?

Prompt G. Its twenty-one groups form recognizable conceptual blocks with
limited overlap and preserve distinct local issues.

### Which prompt grouped primarily by topic?

Prompt A grouped primarily by named topics. Prompt F also grouped by topic but
formed much broader umbrellas. Prompt C grouped by real-world subject.

### Which grouped primarily by reasoning?

Prompt E grouped most directly by local reasoning units. Prompt B used
argument-role categories, but those categories overlapped extensively.

### Which appeared to reconstruct the article most naturally?

Prompt G. Its output follows a recognizable conceptual progression while
keeping major evidence and mechanism clusters distinct.

### Which over-fragmented the assertions?

Prompt E showed the strongest over-fragmentation into small local reasoning
units. Prompt G produced a similar number of groups, but its blocks remained
more visibly connected.

### Which over-merged unrelated assertions?

Prompt F over-merged most strongly, including a 232-assertion umbrella group.
Prompts B and A also formed broad overlapping groups.

### Which prompt appears to provide the strongest foundation for the next semantic model call?

Prompt G. This is an observation about the returned organization, not a
recommendation to change CF7 architecture or modify the prompt.
`;
  const outputDirectory = path.join(
    path.dirname(path.dirname(runDirectory)),
    "reports",
    String(runManifest.runId),
  );
  await mkdir(path.dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory, { recursive: false });
  const reportPath = path.join(
    outputDirectory,
    "semantic_grouping_experiment_report.md",
  );
  await writeFile(reportPath, report, { encoding: "utf8", flag: "wx" });
  const reportContent = await readFile(reportPath);
  const manifest = {
    schemaVersion: "cf7.semanticGroupingReportManifest.v1",
    runId: runManifest.runId,
    reportSha256: sha256(reportContent),
    reportBytes: reportContent.length,
    sourceRunArtifactAggregateSha256: JSON.parse(
      await readFile(path.join(runDirectory, "artifact_hashes.json"), "utf8"),
    ).aggregateSha256,
    modelCallsMade: 0,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(
    path.join(outputDirectory, "report_manifest.json"),
    manifestText,
    { encoding: "utf8", flag: "wx" },
  );
  const files = [
    {
      name: "semantic_grouping_experiment_report.md",
      bytes: reportContent.length,
      sha256: sha256(reportContent),
    },
    {
      name: "report_manifest.json",
      bytes: Buffer.byteLength(manifestText),
      sha256: sha256(manifestText),
    },
  ];
  await writeFile(
    path.join(outputDirectory, "artifact_hashes.json"),
    `${JSON.stringify({
      schemaVersion: "cf7.semanticGroupingReportHashes.v1",
      algorithm: "sha256",
      selfExcluded: true,
      fileCount: files.length,
      files,
      aggregateSha256: sha256(JSON.stringify(files)),
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  for (const name of [
    "semantic_grouping_experiment_report.md",
    "report_manifest.json",
    "artifact_hashes.json",
  ]) {
    await chmod(path.join(outputDirectory, name), 0o444);
  }
  await chmod(outputDirectory, 0o555);
  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    ...manifest,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
