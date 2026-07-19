// Single host-owned budget policy for the split Call-1 path.
export function deriveSplitClaimBudgets(article = {}) {
  const length = String(article.text ?? "").length;
  if (length >= 5_000) return { call1bCandidateMaximum: 16, finalPortfolioMinimum: 10, finalPortfolioMaximum: 12 };
  if (length >= 2_000) return { call1bCandidateMaximum: 12, finalPortfolioMinimum: 6, finalPortfolioMaximum: 10 };
  return { call1bCandidateMaximum: 10, finalPortfolioMinimum: 1, finalPortfolioMaximum: 10 };
}
