import type {
  SemanticGroupingConfig,
} from "../semanticGrouping/types.js";

export type Sel1SelectorId = "A" | "B";

export type Sel1Assertion = {
  assertionId: string;
  assertionText: string;
};

export type Sel1Group = {
  groupId: string;
  groupIndex: number;
  semanticSubThesis: string;
  assertions: Sel1Assertion[];
};

export type Sel1Output = {
  groupId: string;
  selectedAssertionId: string;
  atomicAssertion: string;
};

export type Sel1ProtectedToken = {
  token: string;
  category: string;
  reason: string;
};

export type Sel1Validation = {
  status: "PASS" | "FAIL";
  schemaValid: boolean;
  groupIdMatches: boolean;
  selectedAssertionInGroup: boolean;
  atomicAssertionPresent: boolean;
  introducedProtectedTokens: Sel1ProtectedToken[];
};

export type Sel1RunRow = {
  requestKey: string;
  selectorId: Sel1SelectorId;
  groupId: string;
  groupIndex: number;
  promptHash: string;
  schemaHash: string;
  requestHash: string;
  output: Sel1Output | null;
  rawOutput: unknown;
  validation: Sel1Validation;
  schemaIssues: unknown[];
  responseId: string | null;
  requestId: string | null;
  model: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  error: { name: string; message: string } | null;
};

export type Sel1RunResult = {
  status: "completed" | "failed";
  providerCallCount: number;
  expectedProviderCallCount: 48;
  selectorCount: 2;
  groupCount: 24;
  sourceAssertionAssignmentCount: number;
  sourceUniqueAssertionCount: number;
  sourceInputHash: string;
  promptHashes: Record<Sel1SelectorId, string>;
  schemaHash: string;
  configuration: SemanticGroupingConfig;
  rows: Sel1RunRow[];
};

export type Sel1FrozenInput = {
  sourceRunId: string;
  sourceArtifactAggregateSha256: string;
  sourceGde2InventoryHash: string;
  sourceGde2GroupFileSha256: string;
  groupCount: 24;
  assertionAssignmentCount: number;
  uniqueAssertionCount: number;
  duplicateAssertionIds: string[];
  sourceInputHash: string;
  groups: Sel1Group[];
};

export type { SemanticGroupingConfig };
