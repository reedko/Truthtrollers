import {
  SEMANTIC_GROUPING_PROMPTS,
} from "../semanticGrouping/prompts.js";
import type {
  Gde2PromptId,
  Gde2VariantId,
  SemanticGroupingAssertion,
} from "./types.js";

export const GDE2_REPRESENTATIVE_ADDITIONS: Readonly<
  Record<Gde2VariantId, string>
> = Object.freeze({
  A: `For each semantic group, select the single existing assertion that best represents the group's shared substantive meaning.

Return:

- representativeAssertionId

Do not rewrite the assertion.`,
  B: `For each semantic group, generate one concise assertion representing the group's shared substantive meaning.

Use only information contained within the group.

Do not introduce new facts, causal relationships, certainty, or attribution.

Return:

- representativeAssertion`,
  C: `For each semantic group, either:

- select one existing assertion, or
- synthesize one new assertion,

whichever better represents the group's shared substantive meaning.

Return:

- representativeType ("selected" or "synthesized")
- representativeAssertionId (if selected)
- representativeAssertion (if synthesized)

Synthesized assertions may use only information contained within the group.`,
});

export function getGde2OriginalPrompt(promptId: Gde2PromptId): string {
  return SEMANTIC_GROUPING_PROMPTS[promptId];
}

export function buildGde2Instruction(input: {
  promptId: Gde2PromptId;
  variantId: Gde2VariantId;
}): string {
  return `${getGde2OriginalPrompt(input.promptId)}

${GDE2_REPRESENTATIVE_ADDITIONS[input.variantId]}`;
}

export function buildGde2UserPrompt(input: {
  promptId: Gde2PromptId;
  variantId: Gde2VariantId;
  assertions: SemanticGroupingAssertion[];
}): string {
  return `${buildGde2Instruction(input)}

${JSON.stringify(input.assertions, null, 2)}`;
}
