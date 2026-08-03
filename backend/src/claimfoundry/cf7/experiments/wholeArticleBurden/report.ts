import type {
  WholeArticleBurdenFrozenInput,
  WholeArticleBurdenRunResult,
} from "./types.js";

function md(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

export function buildWholeArticleBurdenReport(input: {
  runId: string;
  frozen: WholeArticleBurdenFrozenInput;
  result: WholeArticleBurdenRunResult;
  coreArtifactAggregateSha256: string;
}): string {
  const propositions = input.result.output?.propositions ?? [];
  const exactSourceMatches = propositions.filter((row) =>
    input.frozen.article.text.includes(row.assertionSource)).length;
  const normalizedAssertions = propositions.map((row) =>
    row.assertion.toLowerCase().replace(/\s+/g, " ").trim());
  const duplicateAssertions = normalizedAssertions.filter(
    (value, index) => normalizedAssertions.indexOf(value) !== index,
  );
  const lines = [
    "# CF7 Whole-Article Burden-of-Proof Baseline Report",
    "",
    "## Run identity and integrity",
    "",
    `- Run ID: \`${input.runId}\``,
    `- Fixture: \`${input.frozen.fixture}\``,
    `- Status: **${input.result.status.toUpperCase()}**`,
    `- Model: \`${input.result.model}\``,
    `- Temperature: ${input.result.configuration.temperature}`,
    `- Provider calls: ${input.result.providerCallCount}`,
    "- Retries: 0",
    `- Fixture path: \`${input.frozen.fixturePath}\``,
    `- Fixture file SHA-256: \`${input.frozen.fixtureFileSha256}\``,
    `- Article text SHA-256: \`${input.frozen.articleTextSha256}\``,
    `- Article characters: ${input.frozen.articleCharacterCount}`,
    `- Request hash: \`${input.result.requestHash}\``,
    `- Core artifact aggregate SHA-256: \`${input.coreArtifactAggregateSha256}\``,
    "- Article text visible: complete frozen article",
    "- Grouping, sub-theses, selector outputs, and evaluator material visible: no",
    "",
    "## Results",
    "",
  ];
  propositions.forEach((row, index) => {
    lines.push(
      `### ${index + 1}. ${row.assertion}`,
      "",
      `**Assertion source:** ${row.assertionSource}`,
      "",
      `**Why it matters to the article's thesis:** ${
        row.whyItMattersToArticleThesis
      }`,
      "",
    );
  });
  lines.push(
    "## Structural accounting",
    "",
    `- Propositions returned: ${propositions.length}`,
    `- Assertion-source strings found verbatim in the article: ${exactSourceMatches}/${propositions.length}`,
    `- Duplicate normalized assertion texts: ${duplicateAssertions.length}`,
    `- Schema issues: ${input.result.schemaIssues.length}`,
    "",
    "| # | Assertion | Source exact substring? | Assertion words | Source words | Why words |",
    "|---:|---|---:|---:|---:|---:|",
    ...propositions.map((row, index) => {
      const words = (value: string) =>
        value.match(/\b[\p{L}\p{N}'’-]+\b/gu)?.length ?? 0;
      return `| ${index + 1} | ${md(row.assertion)} | ${
        input.frozen.article.text.includes(row.assertionSource)
      } | ${words(row.assertion)} | ${words(row.assertionSource)} | ${
        words(row.whyItMattersToArticleThesis)
      } |`;
    }),
    "",
    "## Usage",
    "",
    `- Input tokens: ${input.result.usage.inputTokens}`,
    `- Cached input tokens: ${input.result.usage.cachedInputTokens}`,
    `- Output tokens: ${input.result.usage.outputTokens}`,
    `- Total tokens: ${input.result.usage.totalTokens}`,
    `- Latency: ${input.result.latencyMs} ms`,
    "",
    "No sealed evaluator or additional semantic model was used to score these propositions. This report presents the one-call baseline output and deterministic structural facts only.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
