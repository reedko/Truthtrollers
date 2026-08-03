import type {
  ComparisonRow,
  ClosestChoice,
} from "./comparison.js";
import { structuralObservations } from "./comparison.js";
import type {
  GOnlyFrozenInput,
  GOnlySelection,
  SemanticGroupingConfig,
} from "./types.js";

function md(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function prior(choice: ClosestChoice | null): string {
  if (!choice) return "no defensible counterpart";
  return `${choice.comparison}: ${choice.selectedAssertionId} — ${
    md(choice.selectedAssertionText)
  }`;
}

export function buildGOnlyComparisonReport(input: {
  runId: string;
  frozen: GOnlyFrozenInput;
  selections: GOnlySelection[];
  comparisons: ComparisonRow[];
  config: SemanticGroupingConfig;
  expectedRequests: number;
  completedRequests: number;
  failedRequests: number;
  retriedRequests: number;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencyMs: number;
  };
  coreArtifactAggregateSha256: string;
}): string {
  const lines = [
    "# CF7 G-Only Selector A Comparison Report",
    "",
    "## 1. Run identity and integrity",
    "",
    `- Run ID: \`${input.runId}\``,
    "- Fixture: `CF1-F03`",
    `- Model: \`${input.config.model}\``,
    `- Temperature: ${input.config.temperature}`,
    "- Seed: not configured",
    "- Response format: strict `cf7_g_only_selector_a_v1` JSON schema",
    `- Maximum output tokens: ${input.config.maxOutputTokens}`,
    `- Timeout: ${input.config.timeoutMs} ms`,
    `- Concurrency: ${input.config.maximumConcurrency}`,
    `- Source Prompt G artifact: \`${input.frozen.sourceGroupPath}\``,
    `- Source Prompt G SHA-256: \`${input.frozen.sourceGroupSha256}\``,
    `- Source assertion inventory: \`${input.frozen.sourceInventoryPath}\``,
    `- Source inventory SHA-256: \`${input.frozen.sourceInventorySha256}\``,
    `- Requests expected/completed/failed/retried: ${input.expectedRequests}/${input.completedRequests}/${input.failedRequests}/${input.retriedRequests}`,
    "- Group membership changed: no",
    "- Article text visible: no",
    "- Evaluator materials visible: no",
    `- Input/cached/output/total tokens: ${input.usage.inputTokens}/${input.usage.cachedInputTokens}/${input.usage.outputTokens}/${input.usage.totalTokens}`,
    `- Aggregate request latency: ${input.usage.latencyMs} ms`,
    `- Core artifact aggregate SHA-256: \`${input.coreArtifactAggregateSha256}\``,
    "",
    "The core aggregate covers the frozen sources, requests, responses, selections, usage, and manifest. The report and final hash manifest are hashed separately after this report is written.",
    "",
    "## 2. Original G partition accounting",
    "",
    `- Frozen groups: ${input.frozen.groupCount}`,
    `- Assigned assertions: ${input.frozen.assignedAssertionCount}`,
    `- Duplicate assignments: ${input.frozen.duplicateAssertionIds.length}`,
    `- Original missing assertions: ${input.frozen.missingAssertionIds.join(", ")}`,
    "- Missing assertions silently repaired: no",
    "",
    "| Group | Size | Assertion IDs |",
    "|---|---:|---|",
    ...input.frozen.groups.map((group) =>
      `| ${group.groupId} | ${group.assertionIds.length} | ${
        group.assertionIds.join(", ")
      } |`),
    "",
    "## 3. Full selected-assertion listing",
    "",
  ];
  for (const group of input.frozen.groups) {
    const selection = input.selections.find(
      (row) => row.groupId === group.groupId,
    )!;
    lines.push(
      `### ${group.groupId}`,
      "",
      "| Assertion ID | Exact frozen assertion text |",
      "|---|---|",
      ...group.assertions.map((assertion) =>
        `| ${assertion.assertionId} | ${md(assertion.assertionText)} |`),
      "",
      `- Selected assertion ID: ${selection.selectedAssertionId ?? "INVALID"}`,
      `- Selected assertion text: ${
        selection.selectedAssertionText
          ? md(selection.selectedAssertionText)
          : "No structurally valid selection"
      }`,
      `- Structurally valid: ${selection.structurallyValid}`,
      "",
    );
  }
  lines.push(
    "## 4. Side-by-side comparison with frozen prior experiments",
    "",
    "Correspondences below are conservative structural matches: a unique prior group must share at least two assertion IDs. This does not assert semantic equivalence.",
    "",
    "| Original G group | G-only Selector A | G-A closest choice | G-B→A closest choice | G-B→B closest choice |",
    "|---|---|---|---|---|",
    ...input.comparisons.map((row) =>
      `| ${row.groupId} | ${row.current.selectedAssertionId ?? "INVALID"} — ${
        md(row.current.selectedAssertionText ?? "")
      } | ${prior(row.gA)} | ${prior(row.gBSelectorA)} | ${
        prior(row.gBSelectorB)
      } |`),
    "",
    "## 5. Human-review worksheet",
    "",
    "| Original G group | G-only Selector A choice | G-A closest choice | G-B→A closest choice | G-B→B closest choice | Human notes |",
    "|---|---|---|---|---|---|",
    ...input.comparisons.map((row) =>
      `| ${row.groupId} | ${row.current.selectedAssertionId ?? "INVALID"} — ${
        md(row.current.selectedAssertionText ?? "")
      } | ${prior(row.gA)} | ${prior(row.gBSelectorA)} | ${
        prior(row.gBSelectorB)
      } |  |`),
    "",
    "## 6. Structural observations only",
    "",
    "| Group | Valid ID | Observable text features |",
    "|---|---:|---|",
    ...input.selections.map((selection) => {
      const observations = selection.selectedAssertionText
        ? structuralObservations(selection.selectedAssertionText)
        : ["no valid selected text"];
      return `| ${selection.groupId} | ${selection.structurallyValid} | ${
        observations.length > 0 ? observations.join("; ") : "none detected"
      } |`;
    }),
    "",
    "No semantic accuracy, centrality, atomicity, or evidence-readiness verdict is assigned. Human notes are intentionally blank.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
