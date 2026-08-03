import type { CfxS2ReportInput } from "./reportTypes.js";

function safe(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

export function buildCfxS2ReportMarkdown(input: CfxS2ReportInput): string {
  const lines = [
    "# CFX S2 Exact Grounding Report",
    "",
    `- Run ID: \`${input.runId}\``,
    `- Fixture: \`${input.fixtureId}\``,
    `- Model: \`${input.model}\``,
    `- Prompt hash: \`${input.promptHash}\``,
    `- Schema hash: \`${input.schemaHash}\``,
    `- Article hash: \`${input.article.articleTextSha256}\``,
    `- Arm A status: **${input.wholeArticle.status}**`,
    `- Arm B status: **${input.perProposition.status}**`,
    "",
    "## Comparison",
    "",
    "| Proposition | Canonical assertion | Arm A | Arm B | Status agrees | Citations agree |",
    "|---|---|---|---|---:|---:|",
    ...input.comparison.perPropositionComparison.map((comparison) => {
      const proposition = input.canonicalInventory.propositions.find(
        (item) => item.propositionId === comparison.propositionId,
      )!;
      return `| ${comparison.propositionId} | ${safe(proposition.assertion)} | ${comparison.wholeArticleStatus} | ${comparison.perPropositionStatus} | ${comparison.statusAgrees} | ${comparison.citedUnitSetsAgree && comparison.exactQuotationsAgree} |`;
    }),
    "",
    "No automatic semantic winner is declared.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}
