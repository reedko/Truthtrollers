import type {
  CfxEvidenceInput,
  CfxQueryPlan,
} from "./types.js";

export function cfxQueryPlanMarkdown(input: {
  evidenceInputs: CfxEvidenceInput[];
  plan: CfxQueryPlan;
}): string {
  const sourceById = new Map(
    input.evidenceInputs.map((row) => [row.propositionId, row]),
  );
  const lines = [
    "# CFX initial query plan",
    "",
    "The canonical assertions are immutable. Missing lanes are retained with typed reasons.",
    "",
  ];
  for (const proposition of input.plan.propositions) {
    const source = sourceById.get(proposition.propositionId)!;
    lines.push(
      `## ${proposition.propositionId}`,
      "",
      `**Assertion:** ${source.substantiveAssertion}`,
      "",
      `**Source:** ${source.assertionSource}`,
      "",
      `**PubMed applicable:** ${proposition.pubmedApplicable ? "yes" : "no"}`,
      "",
      ...proposition.queries.flatMap((query) => [
        `### ${query.queryId} — ${query.lane}`,
        "",
        `- Provider: ${query.provider ?? "not executed"}`,
        `- Query: ${query.query ?? "—"}`,
        `- Model-proposed query: ${query.modelProposedQuery ?? "—"}`,
        `- Literal PubMed compilation: ${query.compiledFromLiteralComponents ? "yes" : "no"}`,
        `- Missing reason: ${query.missingReason ?? "—"}`,
        `- Origin: ${query.origin}`,
        `- Rationale: ${query.rationale}`,
        "",
      ]),
    );
  }
  return `${lines.join("\n")}\n`;
}
