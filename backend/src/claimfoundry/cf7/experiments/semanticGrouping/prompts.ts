import type {
  SemanticGroupingAssertion,
  SemanticGroupingPromptId,
} from "./types.js";

export const SEMANTIC_GROUPING_COMMON_RULES = `Common Rules (Apply to Every Prompt)

Input:

The complete harvested assertion inventory from one article.
Each assertion includes:
assertionId
assertionText

No additional article text should be supplied.

No chunk text.

No headings.

No title.

No thesis.

No summaries.

No provenance except assertion IDs.

The model must not:

rewrite assertions
summarize assertions
generate new assertions
rank assertions
select assertions
infer article truth
perform atomic decomposition
explain reasoning

Unless explicitly requested by the prompt, return only the requested structure.`;

export const SEMANTIC_GROUPING_PROMPTS: Readonly<
  Record<SemanticGroupingPromptId, string>
> = Object.freeze({
  A: `You are given a set of assertions extracted from one article.

Your task is to organize them into semantic groups.

Assertions belong in the same group when they concern the same underlying proposition, mechanism, event, controversy, finding, or line of reasoning.

Groups should reflect substantive meaning, not where the assertions appeared in the article.

Every assertion must belong to exactly one group.

Do not rewrite assertions.
Do not summarize assertions.
Do not generate new assertions.

Return only:

{
  "groups": [
    {
      "groupId": "...",
      "assertionIds": [...]
    }
  ]
}`,
  B: `You are given a set of assertions extracted from one article.

Organize the assertions into the article's logical argument.

Group assertions that work together to support the same conclusion.

Separate background, mechanisms, evidence, conclusions, counterarguments, and consequences where appropriate.

Every assertion must belong to exactly one group.

Do not rewrite assertions.
Do not summarize assertions.

Return only group IDs and assertion IDs.`,
  C: `Treat each assertion as a node.

Determine which assertions refer to the same underlying real-world subject or proposition.

Produce connected groups.

Every assertion must belong to exactly one group.

Do not summarize.

Do not rank.

Return only group IDs and assertion IDs.`,
  D: `These assertions were extracted from one article.

Partition them into the distinct conversations occurring within the article.

Each conversation should contain assertions that jointly develop one substantive issue.

Every assertion must belong to exactly one conversation.

Return only group IDs and assertion IDs.`,
  E: `If these assertions were shuffled randomly and you had never seen the article, how would you reconstruct the author's reasoning?

Organize the assertions into the smallest number of coherent reasoning units.

Every assertion must belong to exactly one reasoning unit.

Do not summarize.

Do not rewrite.

Return only group IDs and assertion IDs.`,
  F: `These assertions were extracted from one article.

Organize them into coherent semantic groups.

Every assertion must belong to exactly one group.

Return only group IDs and assertion IDs.`,
  G: `These assertions collectively describe one article.

Imagine the article has been shredded.

Your task is to reconstruct the conceptual organization of the article using only these assertions.

Group assertions that belong together.

Every assertion must belong to exactly one group.

Return only group IDs and assertion IDs.`,
});

export function buildSemanticGroupingUserPrompt(input: {
  promptId: SemanticGroupingPromptId;
  assertions: SemanticGroupingAssertion[];
}): string {
  return `${SEMANTIC_GROUPING_PROMPTS[input.promptId]}

${JSON.stringify(input.assertions, null, 2)}`;
}
