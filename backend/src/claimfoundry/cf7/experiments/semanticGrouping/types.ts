export type SemanticGroupingPromptId = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type SemanticGroupingAssertion = {
  assertionId: string;
  assertionText: string;
};

export type SemanticGroupingGroup = {
  groupId: string;
  assertionIds: string[];
};

export type SemanticGroupingOutput = {
  groups: SemanticGroupingGroup[];
};

export type SemanticGroupingValidation = {
  status: "PASS" | "FAIL";
  assertionCount: number;
  assignedAssertionCount: number;
  groupCount: number;
  largestGroupSize: number;
  smallestGroupSize: number;
  meanGroupSize: number;
  emptyGroupIds: string[];
  duplicateGroupIds: string[];
  duplicateAssertionAssignments: string[];
  missingAssertionAssignments: string[];
  inventedAssertionAssignments: string[];
};

export type SemanticGroupingConfig = {
  model: string;
  temperature: number;
  maximumConcurrency: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryCount: 0;
  store: false;
};
