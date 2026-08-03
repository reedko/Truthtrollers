import type { Cf7SourceUnit } from "../types/index.js";
import { Cf7Error } from "../../shared/errors/Cf7Error.js";
import { cf7S3DecisionSchema } from "./schema.js";
import type {
  Cf7S3BatchValidation,
  Cf7S3Decision,
  Cf7S3ParentEvaluation,
  Cf7S3ParentRow,
  Cf7S3RejectedParent,
  Cf7S3ValidationViolation,
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

type IntroducedToken = {
  token: string;
  category: string;
  reason: string;
};

function normalizedWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?|\d+(?:\.\d+)?%?/g) ?? [],
  );
}

function protectedTokenViolations(
  childText: string,
  groundingText: string,
): IntroducedToken[] {
  const childWords = normalizedWords(childText);
  const groundingWords = normalizedWords(groundingText);
  const introduced: IntroducedToken[] = [];
  const childNumbers = childText.match(/\d+(?:\.\d+)?%?/g) ?? [];
  const groundingNumbers = new Set(
    groundingText.match(/\d+(?:\.\d+)?%?/g) ?? [],
  );
  for (const number of childNumbers) {
    if (!groundingNumbers.has(number)) {
      introduced.push({
        token: number,
        category: "number_or_date",
        reason: `"${number}" is not present in the parent's permitted grounding text.`,
      });
    }
  }
  for (const term of exactProtectedTerms) {
    if (childWords.has(term) && !groundingWords.has(term)) {
      introduced.push({
        token: term,
        category: "negation_or_modality",
        reason: `"${term}" is not present in the parent's permitted grounding text.`,
      });
    }
  }
  for (const [group, terms] of Object.entries(protectedGroups)) {
    const usedTerms = terms.filter((term) => childWords.has(term));
    const groundingUsesGroup = terms.some((term) => groundingWords.has(term));
    if (usedTerms.length > 0 && !groundingUsesGroup) {
      for (const term of usedTerms) {
        introduced.push({
          token: term,
          category: group,
          reason: `"${term}" introduces ${group.replaceAll("_", " ")} not present in the parent's permitted grounding text.`,
        });
      }
    }
  }
  const capitalizedTokens = childText.match(/\b[A-Z][A-Za-z0-9'-]{1,}\b/g)
    ?? [];
  const firstToken = childText.match(/^\s*([A-Za-z][A-Za-z0-9'-]*)/)?.[1];
  const commonSentenceStarters = new Set([
    "A", "An", "The", "In", "On", "At", "By", "According", "This", "That",
    "These", "Those", "It", "He", "She", "They", "We", "Our", "Their",
    "Its", "When", "After", "Before", "During", "For", "Of", "As", "If",
    "While", "New", "More",
  ]);
  for (const token of capitalizedTokens) {
    if (
      (token === firstToken && commonSentenceStarters.has(token))
      || groundingText.toLowerCase().includes(token.toLowerCase())
    ) {
      continue;
    }
    introduced.push({
      token,
      category: "name",
      reason: `"${token}" is not present in the parent's permitted grounding text.`,
    });
  }
  return [...new Map(
    introduced.map((item) => [
      `${item.category}:${item.token.toLowerCase()}`,
      item,
    ]),
  ).values()];
}

function violation(input: Omit<
  Cf7S3ValidationViolation,
  "comparison" | "childText" | "childGroundingUnitIds"
> & Partial<Pick<
  Cf7S3ValidationViolation,
  "comparison" | "childText" | "childGroundingUnitIds"
>>): Cf7S3ValidationViolation {
  return {
    ...input,
    childText: input.childText ?? null,
    childGroundingUnitIds: input.childGroundingUnitIds ?? [],
    comparison: input.comparison ?? {},
  };
}

function hostEvaluation(
  parent: Cf7S3ParentRow,
  decision: Cf7S3Decision,
): Cf7S3ParentEvaluation {
  return {
    parentHarvestRowId: parent.harvestRowId,
    parentChunkId: parent.chunkId,
    parentRowKind: parent.rowKind,
    parentAssertionText: parent.assertionText,
    parentGroundingUnitIds: [...parent.groundingUnitIds],
    action: decision.action,
    children: decision.action === "keep_verbatim"
      ? [{
        assertionText: parent.assertionText,
        groundingUnitIds: [...parent.groundingUnitIds],
        derivation: "preserved",
      }]
      : decision.children.map((child) => ({
        assertionText: child.assertionText,
        groundingUnitIds: [...child.groundingUnitIds],
        derivation: "split_component" as const,
      })),
    decisionSource: "model",
  };
}

export function createCf7S3BypassEvaluation(
  parent: Cf7S3ParentRow,
): Cf7S3ParentEvaluation {
  return {
    ...hostEvaluation(parent, {
      parentHarvestRowId: parent.harvestRowId,
      action: "keep_verbatim",
    }),
    decisionSource: "host_bypass",
  };
}

function validateSplit(input: {
  parent: Cf7S3ParentRow;
  decision: Extract<Cf7S3Decision, { action: "split" }>;
  unitById: Map<string, Cf7SourceUnit>;
}): Cf7S3ValidationViolation[] {
  const { parent, decision, unitById } = input;
  const violations: Cf7S3ValidationViolation[] = [];
  if (decision.children.length < 2) {
    violations.push(violation({
      parentHarvestRowId: parent.harvestRowId,
      rule: "actionCardinality",
      message: `${parent.harvestRowId} split requires at least two children`,
      comparison: { expected: "at least 2", actual: decision.children.length },
    }));
  }
  const parentGrounding = new Set(parent.groundingUnitIds);
  const childTexts = new Set<string>();
  for (const child of decision.children) {
    if (childTexts.has(child.assertionText)) {
      violations.push(violation({
        parentHarvestRowId: parent.harvestRowId,
        rule: "duplicateChild",
        message: `Duplicate child for ${parent.harvestRowId}`,
        childText: child.assertionText,
        childGroundingUnitIds: child.groundingUnitIds,
      }));
    }
    childTexts.add(child.assertionText);
    const uniqueGrounding = [...new Set(child.groundingUnitIds)];
    const invalidGrounding = uniqueGrounding.filter(
      (unitId) => !parentGrounding.has(unitId) || !unitById.has(unitId),
    );
    if (
      uniqueGrounding.length !== child.groundingUnitIds.length
      || invalidGrounding.length > 0
    ) {
      violations.push(violation({
        parentHarvestRowId: parent.harvestRowId,
        rule: "unknownChildGrounding",
        message:
          `${parent.harvestRowId} child cites grounding outside its parent`,
        childText: child.assertionText,
        childGroundingUnitIds: child.groundingUnitIds,
        comparison: {
          allowedParentGroundingUnitIds: parent.groundingUnitIds,
          expected: parent.groundingUnitIds,
          actual: child.groundingUnitIds,
        },
      }));
      continue;
    }
    const allowedGroundingText = uniqueGrounding.map((unitId) => ({
      unitId,
      text: unitById.get(unitId)!.text,
    }));
    const introducedTokens = protectedTokenViolations(
      child.assertionText,
      allowedGroundingText.map((unit) => unit.text).join("\n"),
    );
    if (introducedTokens.length > 0) {
      violations.push(violation({
        parentHarvestRowId: parent.harvestRowId,
        rule: "protectedContent",
        message: `${parent.harvestRowId} child introduces protected content`,
        childText: child.assertionText,
        childGroundingUnitIds: child.groundingUnitIds,
        comparison: {
          allowedParentGroundingUnitIds: parent.groundingUnitIds,
          allowedGroundingText,
          introducedTokens,
        },
      }));
    }
  }
  return violations;
}

function inferredParentId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>).parentHarvestRowId;
  return typeof value === "string" ? value : null;
}

export function inspectCf7S3BatchResponse(input: {
  expectedParents: Cf7S3ParentRow[];
  units: Cf7SourceUnit[];
  output: unknown;
}): Cf7S3BatchValidation {
  const expectedById = new Map(
    input.expectedParents.map((parent) => [parent.harvestRowId, parent]),
  );
  const unitById = new Map(input.units.map((unit) => [unit.unitId, unit]));
  const acceptedRows: Cf7S3ParentEvaluation[] = [];
  const rejectedRows: Cf7S3RejectedParent[] = [];
  const requestViolations: Cf7S3ValidationViolation[] = [];
  let rawResults: unknown[] = [];

  if (!input.output || typeof input.output !== "object") {
    requestViolations.push(violation({
      parentHarvestRowId: null,
      rule: "schema",
      message: "Provider output must be an object containing results",
      comparison: { expected: "{ results: [...] }", actual: input.output },
    }));
  } else {
    const outputRecord = input.output as Record<string, unknown>;
    const keys = Object.keys(outputRecord);
    if (keys.length !== 1 || keys[0] !== "results") {
      requestViolations.push(violation({
        parentHarvestRowId: null,
        rule: "schema",
        message: "Provider output contains missing or additional top-level keys",
        comparison: { expected: ["results"], actual: keys },
      }));
    }
    if (!Array.isArray(outputRecord.results)) {
      requestViolations.push(violation({
        parentHarvestRowId: null,
        rule: "schema",
        message: "Provider output results must be an array",
        comparison: { expected: "array", actual: typeof outputRecord.results },
      }));
    } else {
      rawResults = outputRecord.results;
      if (rawResults.length < 1 || rawResults.length > 12) {
        requestViolations.push(violation({
          parentHarvestRowId: null,
          rule: "schema",
          message: "Provider output results must contain 1 through 12 rows",
          comparison: { expected: "1..12", actual: rawResults.length },
        }));
      }
    }
  }

  const occurrenceCounts = new Map<string, number>();
  for (const raw of rawResults) {
    const id = inferredParentId(raw);
    if (id) occurrenceCounts.set(id, (occurrenceCounts.get(id) ?? 0) + 1);
  }
  const representedExpectedIds = new Set<string>();
  for (const raw of rawResults) {
    const id = inferredParentId(raw);
    if (id && expectedById.has(id)) representedExpectedIds.add(id);
    const parsed = cf7S3DecisionSchema.safeParse(raw);
    if (!parsed.success) {
      const parent = id ? expectedById.get(id) ?? null : null;
      rejectedRows.push({
        parentHarvestRowId: id,
        expectedParent: parent,
        rawResult: raw,
        violations: [violation({
          parentHarvestRowId: id,
          rule: "schema",
          message: `Schema-invalid parent decision${id ? ` ${id}` : ""}`,
          comparison: {
            expected: "cf7_s3_decomposition_v2 decision",
            actual: parsed.error.issues,
          },
        })],
      });
      continue;
    }
    const decision = parsed.data as Cf7S3Decision;
    const parent = expectedById.get(decision.parentHarvestRowId);
    const rowViolations: Cf7S3ValidationViolation[] = [];
    if (!parent) {
      rowViolations.push(violation({
        parentHarvestRowId: decision.parentHarvestRowId,
        rule: "unknownParent",
        message: `Unknown parent ${decision.parentHarvestRowId}`,
      }));
    }
    if ((occurrenceCounts.get(decision.parentHarvestRowId) ?? 0) > 1) {
      rowViolations.push(violation({
        parentHarvestRowId: decision.parentHarvestRowId,
        rule: "duplicateParent",
        message: `Duplicate decision ${decision.parentHarvestRowId}`,
      }));
    }
    if (parent && decision.action === "split") {
      rowViolations.push(...validateSplit({ parent, decision, unitById }));
    }
    if (parent && rowViolations.length === 0) {
      acceptedRows.push(hostEvaluation(parent, decision));
    } else if (rowViolations.length > 0) {
      rejectedRows.push({
        parentHarvestRowId: decision.parentHarvestRowId,
        expectedParent: parent ?? null,
        rawResult: raw,
        violations: rowViolations,
      });
    }
  }

  for (const parent of input.expectedParents) {
    if (!representedExpectedIds.has(parent.harvestRowId)) {
      rejectedRows.push({
        parentHarvestRowId: parent.harvestRowId,
        expectedParent: parent,
        rawResult: null,
        violations: [violation({
          parentHarvestRowId: parent.harvestRowId,
          rule: "missingParent",
          message: `Missing decision: ${parent.harvestRowId}`,
          comparison: { expected: parent.harvestRowId, actual: null },
        })],
      });
    }
  }

  const acceptedById = new Map(
    acceptedRows.map((row) => [row.parentHarvestRowId, row]),
  );
  const orderedAccepted = input.expectedParents.flatMap((parent) => {
    const row = acceptedById.get(parent.harvestRowId);
    return row ? [row] : [];
  });
  const violations = [
    ...requestViolations,
    ...rejectedRows.flatMap((row) => row.violations),
  ];
  return {
    status: violations.length === 0 ? "PASS" : "FAIL",
    acceptedRows: orderedAccepted,
    rejectedRows,
    violations,
  };
}

const codeByRule: Record<Cf7S3ValidationViolation["rule"], string> = {
  schema: "CF7_S3_SCHEMA_INVALID",
  providerFailure: "CF7_S3_PROVIDER_FAILURE",
  unknownParent: "CF7_S3_UNKNOWN_PARENT_ID",
  duplicateParent: "CF7_S3_DUPLICATE_PARENT_EVALUATION",
  missingParent: "CF7_S3_MISSING_PARENT_EVALUATION",
  actionCardinality: "CF7_S3_ACTION_CARDINALITY",
  duplicateChild: "CF7_S3_DUPLICATE_CHILD",
  unknownChildGrounding: "CF7_S3_UNKNOWN_CHILD_GROUNDING",
  protectedContent: "CF7_S3_UNSUPPORTED_PROTECTED_TOKEN",
};

export function validateCf7S3BatchResponse(input: {
  expectedParents: Cf7S3ParentRow[];
  units: Cf7SourceUnit[];
  output: unknown;
}): Cf7S3ParentEvaluation[] {
  const result = inspectCf7S3BatchResponse(input);
  const first = result.violations[0];
  if (first) {
    throw new Cf7Error(codeByRule[first.rule], first.message, {
      violation: first,
      allViolations: result.violations,
    });
  }
  return result.acceptedRows;
}
