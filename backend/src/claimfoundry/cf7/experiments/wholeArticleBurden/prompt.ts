export const WHOLE_ARTICLE_BURDEN_PROMPT = `Read the article.

Return the 12 propositions that carry the burden of proof for the article.

These are the assertions that, if shown false, would most undermine the article's overall argument.

For each provide:

- Assertion
- Assertion source
- Why it matters to the article's thesis`;

export function buildWholeArticleBurdenUserPrompt(articleText: string): string {
  return `${WHOLE_ARTICLE_BURDEN_PROMPT}

${articleText}`;
}
