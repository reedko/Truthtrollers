import type { GOnlyGroup } from "./types.js";

export const G_ONLY_SELECTOR_PROMPT = `You are given one semantic group of assertions extracted from an article.

Select the single existing assertion that best represents the shared substantive content of the group.

Choose among the supplied assertions only.

Return the assertion that most directly captures what the group is substantively about, rather than an introductory, rhetorical, contextual, transitional, or merely illustrative statement.

Do not synthesize.
Do not rewrite.
Do not shorten.
Do not combine assertions.
Do not resolve references.
Do not perform atomic decomposition.
Do not explain your choice.

Return only the selected assertion ID.`;

export function buildGOnlySelectorUserPrompt(group: GOnlyGroup): string {
  return `${G_ONLY_SELECTOR_PROMPT}

${JSON.stringify({
    groupId: group.groupId,
    assertions: group.assertions,
  }, null, 2)}`;
}
