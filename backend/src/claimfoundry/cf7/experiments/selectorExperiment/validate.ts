import { sel1OutputSchema } from "./schema.js";
import type {
  Sel1Group,
  Sel1Output,
  Sel1ProtectedToken,
  Sel1Validation,
} from "./types.js";

const exactProtectedTerms = [
  "no", "not", "never", "none", "without", "cannot", "can't",
  "didn't", "doesn't", "isn't", "wasn't", "weren't",
  "may", "might", "could", "can", "must", "should", "would", "likely",
  "possible", "possibly", "alleged", "allegedly", "reported", "claimed",
] as const;

const protectedGroups = {
  strong_causality: [
    "cause", "caused", "causal", "because", "result", "resulted", "led",
  ],
  association: ["link", "linked", "associated", "risk"],
  upward_comparison: [
    "more", "higher", "increase", "increased", "exceed", "exceeded",
  ],
  downward_comparison: ["less", "lower", "decrease", "decreased"],
  numeric_comparison: ["times", "percent"],
  within_relation: ["within"],
  before_relation: ["before"],
  after_relation: ["after"],
} as const;

function normalizedWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?|\d+(?:\.\d+)?%?/g) ?? [],
  );
}

export function inspectSel1ProtectedContent(
  atomicAssertion: string,
  selectedAssertion: string,
): Sel1ProtectedToken[] {
  const childWords = normalizedWords(atomicAssertion);
  const sourceWords = normalizedWords(selectedAssertion);
  const introduced: Sel1ProtectedToken[] = [];
  const childNumbers = atomicAssertion.match(/\d+(?:\.\d+)?%?/g) ?? [];
  const sourceNumbers = new Set(
    selectedAssertion.match(/\d+(?:\.\d+)?%?/g) ?? [],
  );
  for (const number of childNumbers) {
    if (!sourceNumbers.has(number)) {
      introduced.push({
        token: number,
        category: "number_or_date",
        reason: `"${number}" is not present in the selected assertion.`,
      });
    }
  }
  for (const term of exactProtectedTerms) {
    if (childWords.has(term) && !sourceWords.has(term)) {
      introduced.push({
        token: term,
        category: "negation_or_modality",
        reason: `"${term}" is not present in the selected assertion.`,
      });
    }
  }
  for (const [category, terms] of Object.entries(protectedGroups)) {
    const used = terms.filter((term) => childWords.has(term));
    const sourceUsesGroup = terms.some((term) => sourceWords.has(term));
    if (used.length > 0 && !sourceUsesGroup) {
      for (const term of used) {
        introduced.push({
          token: term,
          category,
          reason:
            `"${term}" introduces ${category.replaceAll("_", " ")} `
            + "not present in the selected assertion.",
        });
      }
    }
  }
  const capitalizedTokens = atomicAssertion.match(
    /\b[A-Z][A-Za-z0-9'-]{1,}\b/g,
  ) ?? [];
  const firstToken = atomicAssertion.match(
    /^\s*([A-Za-z][A-Za-z0-9'-]*)/,
  )?.[1];
  const commonStarters = new Set([
    "A", "An", "The", "In", "On", "At", "By", "According", "This", "That",
    "These", "Those", "It", "He", "She", "They", "We", "Our", "Their",
    "Its", "When", "After", "Before", "During", "For", "Of", "As", "If",
    "While", "New", "More",
  ]);
  for (const token of capitalizedTokens) {
    if (
      (token === firstToken && commonStarters.has(token))
      || selectedAssertion.toLowerCase().includes(token.toLowerCase())
    ) {
      continue;
    }
    introduced.push({
      token,
      category: "name",
      reason: `"${token}" is not present in the selected assertion.`,
    });
  }
  return [...new Map(
    introduced.map((item) => [
      `${item.category}:${item.token.toLowerCase()}`,
      item,
    ]),
  ).values()];
}

function failedValidation(): Sel1Validation {
  return {
    status: "FAIL",
    schemaValid: false,
    groupIdMatches: false,
    selectedAssertionInGroup: false,
    atomicAssertionPresent: false,
    introducedProtectedTokens: [],
  };
}

export function validateSel1Output(input: {
  group: Sel1Group;
  output: unknown;
}): {
  output: Sel1Output | null;
  validation: Sel1Validation;
  schemaIssues: unknown[];
} {
  const parsed = sel1OutputSchema.safeParse(input.output);
  if (!parsed.success) {
    return {
      output: null,
      validation: failedValidation(),
      schemaIssues: parsed.error.issues,
    };
  }
  const output = parsed.data;
  const groupIdMatches = output.groupId === input.group.groupId;
  const selected = input.group.assertions.find(
    (row) => row.assertionId === output.selectedAssertionId,
  );
  const selectedAssertionInGroup = Boolean(selected);
  const atomicAssertionPresent = output.atomicAssertion.trim().length > 0;
  const introducedProtectedTokens = selected
    ? inspectSel1ProtectedContent(
      output.atomicAssertion,
      selected.assertionText,
    )
    : [];
  const validation: Sel1Validation = {
    status: groupIdMatches && selectedAssertionInGroup && atomicAssertionPresent
      ? "PASS"
      : "FAIL",
    schemaValid: true,
    groupIdMatches,
    selectedAssertionInGroup,
    atomicAssertionPresent,
    introducedProtectedTokens,
  };
  return { output, validation, schemaIssues: [] };
}
