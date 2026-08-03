import {
  semanticGroupingOutputSchema,
} from "./schema.js";
import type {
  SemanticGroupingAssertion,
  SemanticGroupingOutput,
  SemanticGroupingValidation,
} from "./types.js";

export function validateSemanticGrouping(input: {
  assertions: SemanticGroupingAssertion[];
  output: unknown;
}): {
  output: SemanticGroupingOutput | null;
  validation: SemanticGroupingValidation;
  schemaIssues: unknown[];
} {
  const parsed = semanticGroupingOutputSchema.safeParse(input.output);
  if (!parsed.success) {
    return {
      output: null,
      schemaIssues: parsed.error.issues,
      validation: {
        status: "FAIL",
        assertionCount: input.assertions.length,
        assignedAssertionCount: 0,
        groupCount: 0,
        largestGroupSize: 0,
        smallestGroupSize: 0,
        meanGroupSize: 0,
        emptyGroupIds: [],
        duplicateGroupIds: [],
        duplicateAssertionAssignments: [],
        missingAssertionAssignments: input.assertions.map(
          (row) => row.assertionId,
        ),
        inventedAssertionAssignments: [],
      },
    };
  }
  const output = parsed.data as SemanticGroupingOutput;
  const expected = new Set(input.assertions.map((row) => row.assertionId));
  const groupCounts = new Map<string, number>();
  const assignmentCounts = new Map<string, number>();
  for (const group of output.groups) {
    groupCounts.set(group.groupId, (groupCounts.get(group.groupId) ?? 0) + 1);
    for (const assertionId of group.assertionIds) {
      assignmentCounts.set(
        assertionId,
        (assignmentCounts.get(assertionId) ?? 0) + 1,
      );
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
    },
  };
}
