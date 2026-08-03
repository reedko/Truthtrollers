import type {
  Sel1Group,
  Sel1SelectorId,
} from "./types.js";

export const SEL1_SYSTEM_PROMPT = `You are evaluating one frozen semantic group from an article-derived assertion inventory.

Use only the supplied group data.

Do not use outside knowledge.

Return only the strict requested JSON object.

The selected assertion must be one of the supplied assertion IDs.`;

const selectorOpening = `For this semantic group:

Review every assertion.
`;

const subThesisGuidance = `
Also review the synthesized semantic sub-thesis.

Use the sub-thesis only as semantic guidance.
`;

const selectorTask = `
Select the single existing assertion that best represents the shared substantive meaning of the group.

Do not synthesize.

Do not rewrite.

Return:

- assertionId

Produce the most atomic version of that assertion.

Rules:

- preserve meaning
- remove conjunctions where possible
- remove bundled propositions
- split independent factual propositions if necessary
- preserve attribution
- preserve polarity
- do not strengthen certainty
- do not invent information

Return:

- atomicAssertion`;

export const SEL1_SELECTOR_PROMPTS: Readonly<Record<
  Sel1SelectorId,
  string
>> = Object.freeze({
  A: `${selectorOpening}${selectorTask}`,
  B: `${selectorOpening}${subThesisGuidance}${selectorTask}`,
});

export function buildSel1UserPrompt(input: {
  selectorId: Sel1SelectorId;
  group: Sel1Group;
}): string {
  const payload = input.selectorId === "A"
    ? {
      groupId: input.group.groupId,
      assertions: input.group.assertions,
    }
    : {
      groupId: input.group.groupId,
      semanticSubThesis: input.group.semanticSubThesis,
      assertions: input.group.assertions,
    };
  return `${SEL1_SELECTOR_PROMPTS[input.selectorId]}

${JSON.stringify(payload, null, 2)}`;
}
