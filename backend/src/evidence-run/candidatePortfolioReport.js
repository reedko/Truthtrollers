const safe = (value) => String(value || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export function candidatePortfolioMarkdown(plan) {
  const rows = plan.candidates.map((item, index) =>
    `| ${index + 1} | ${item.retrievalPromiseScore.toFixed(4)} | ${safe(item.title)} | ` +
    `${item.plannedTargetIds.join(", ") || "context"} | ${item.laneFamilies.join(", ")} | ` +
    `${item.selectionReasons.join(", ")} |`).join("\n");
  const skipped = plan.highScoreSkipped.slice(0, 10).map((item) =>
    `| ${item.retrievalPromiseScore.toFixed(4)} | ${safe(item.title)} | ${item.skipReasons.join(", ")} |`)
    .join("\n");
  return `# ER1 candidate acquisition portfolio (pre-fetch allocation)\n\n` +
    `This is a bounded pre-fetch spending plan under deterministic caps. It proposes an ` +
    `acquisition candidate per target; it assigns NO source type, bearing, or stance ` +
    `(source-typing belongs to the ER1-2A-S semantic selector).\n\n` +
    `- Deduplicated candidates considered: ${plan.candidateCount}\n` +
    `- Portfolio selected: ${plan.portfolioSelectedCount}\n` +
    `- Targets covered: ${plan.coverage.targetIds.join(", ") || "none"}\n` +
    `- Route provenance (lane families): ${plan.coverage.laneFamilies.join(", ") || "none"}\n` +
    `- Domains: ${plan.coverage.domains.length}\n` +
    `- Evaluated-article copies: ${plan.counts.evaluatedArticleCopies}\n` +
    `- Context candidates: ${plan.counts.contextCandidates}\n\n` +
    `## Proposed acquisition candidates\n\n` +
    `| # | Score | Candidate | Planned targets | Route provenance | Selection reasons |\n` +
    `|---:|---:|---|---|---|---|\n${rows}\n\n` +
    `## High-scoring candidates skipped\n\n` +
    `| Score | Candidate | Reasons |\n|---:|---|---|\n${skipped}\n\n` +
    `## Gaps and warnings\n\n` +
    `- Unresolved targets: ${plan.coverage.unresolvedTargetIds.join(", ") || "none"}\n` +
    `- Warnings: ${plan.warnings.join(", ") || "none"}\n\n` +
    `## Safety\n\nNo fetch, scrape, PDF extraction, model call, database operation, migration, ` +
    `projection, assertion extraction, source-bearing assessment, or source-stance assignment occurred.\n`;
}

export function portfolioQualityReview(previous, plan, promisingCount) {
  return { ...(previous || {}), schemaVersion: "er1.candidateQualityReview.v3",
    portfolioSelection: { promisingCount, portfolioSelectedCount: plan.portfolioSelectedCount,
      distinction: "retrievalPromiseScore ranks cheap target fit; portfolio selection allocates acquisition budget for target and route-provenance diversity under caps, without assigning source type.",
      targetCoverage: plan.coverage.targetIds, laneFamilyCoverage: plan.coverage.laneFamilies,
      domainCoverage: plan.coverage.domains,
      counts: plan.counts, warnings: plan.warnings },
    recommendation: "review_candidate_portfolio_before_er1_2b",
    recommendedNext: "Reviewer approval of the bounded acquisition portfolio; ER1-2B remains blocked." };
}
