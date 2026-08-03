import type {
  Gde2Output,
  Gde2Validation,
  Gde2VariantId,
  SemanticGroupingAssertion,
} from "./types.js";
import { getGde2ZodSchema } from "./schema.js";

function failure(
  assertions: SemanticGroupingAssertion[],
): Gde2Validation {
  return {
    status: "FAIL",
    assertionCount: assertions.length,
    assignedAssertionCount: 0,
    groupCount: 0,
    largestGroupSize: 0,
    smallestGroupSize: 0,
    meanGroupSize: 0,
    emptyGroupIds: [],
    duplicateGroupIds: [],
    duplicateAssertionAssignments: [],
    missingAssertionAssignments: assertions.map((row) => row.assertionId),
    inventedAssertionAssignments: [],
    invalidRepresentativeGroupIds: [],
    selectedRepresentativeOutsideGroup: [],
  };
}

export function validateGde2Output(input: {
  assertions: SemanticGroupingAssertion[];
  variantId: Gde2VariantId;
  output: unknown;
}): {
  output: Gde2Output | null;
  validation: Gde2Validation;
  schemaIssues: unknown[];
} {
  const parsed = getGde2ZodSchema(input.variantId).safeParse(input.output);
  if (!parsed.success) {
    return {
      output: null,
      validation: failure(input.assertions),
      schemaIssues: parsed.error.issues,
    };
  }
  const output = parsed.data as Gde2Output;
  const expected = new Set(input.assertions.map((row) => row.assertionId));
  const groupCounts = new Map<string, number>();
  const assignmentCounts = new Map<string, number>();
  const invalidRepresentativeGroupIds: string[] = [];
  const selectedRepresentativeOutsideGroup: Array<{
    groupId: string;
    representativeAssertionId: string;
  }> = [];
  for (const group of output.groups) {
    groupCounts.set(group.groupId, (groupCounts.get(group.groupId) ?? 0) + 1);
    for (const assertionId of group.assertionIds) {
      assignmentCounts.set(
        assertionId,
        (assignmentCounts.get(assertionId) ?? 0) + 1,
      );
    }
    if ("representativeAssertionId" in group) {
      if (!group.assertionIds.includes(group.representativeAssertionId)) {
        invalidRepresentativeGroupIds.push(group.groupId);
        selectedRepresentativeOutsideGroup.push({
          groupId: group.groupId,
          representativeAssertionId: group.representativeAssertionId,
        });
      }
    } else if (
      !("representativeAssertion" in group)
      || group.representativeAssertion.trim().length === 0
    ) {
      invalidRepresentativeGroupIds.push(group.groupId);
    }
  }
  const sizes = output.groups.map((group) => group.assertionIds.length);
  const duplicateGroupIds = [...groupCounts]
    .filter(([, count]) => count > 1)
    .map(([groupId]) => groupId);
  const duplicateAssertionAssignments = [...assignmentCounts]
    .filter(([, count]) => count > 1)
    .map(([assertionId]) => assertionId);
  const missingAssertionAssignments = [...expected]
    .filter((assertionId) => !assignmentCounts.has(assertionId));
  const inventedAssertionAssignments = [...assignmentCounts.keys()]
    .filter((assertionId) => !expected.has(assertionId));
  const emptyGroupIds = output.groups
    .filter((group) => group.assertionIds.length === 0)
    .map((group) => group.groupId);
  const status = (
    duplicateGroupIds.length === 0
    && duplicateAssertionAssignments.length === 0
    && missingAssertionAssignments.length === 0
    && inventedAssertionAssignments.length === 0
    && emptyGroupIds.length === 0
    && invalidRepresentativeGroupIds.length === 0
  ) ? "PASS" as const : "FAIL" as const;
  return {
    output,
    schemaIssues: [],
    validation: {
      status,
      assertionCount: input.assertions.length,
      assignedAssertionCount: [...assignmentCounts.keys()]
        .filter((assertionId) => expected.has(assertionId)).length,
      groupCount: output.groups.length,
      largestGroupSize: Math.max(...sizes),
      smallestGroupSize: Math.min(...sizes),
      meanGroupSize: Number(
        (sizes.reduce((sum, size) => sum + size, 0) / sizes.length).toFixed(3),
      ),
      emptyGroupIds,
      duplicateGroupIds,
      duplicateAssertionAssignments,
      missingAssertionAssignments,
      inventedAssertionAssignments,
      invalidRepresentativeGroupIds,
      selectedRepresentativeOutsideGroup,
    },
  };
}
