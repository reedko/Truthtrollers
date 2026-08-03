import type {
  SemanticGroupingConfig,
} from "../semanticGrouping/types.js";

export type GOnlyAssertion = {
  assertionId: string;
  assertionText: string;
};

export type GOnlyGroup = {
  groupId: string;
  groupIndex: number;
  assertionIds: string[];
  assertions: GOnlyAssertion[];
};

export type GOnlyFrozenInput = {
  sourceGroupingRun: "cf7-semantic-grouping-cf1-f03-20260729005359";
  sourceGroupPath: string;
  sourceGroupSha256: string;
  sourceInventoryPath: string;
  sourceInventorySha256: string;
  sourceArtifactAggregateSha256: string;
  groupMembershipHash: string;
  groupCount: 21;
  assignedAssertionCount: 262;
  duplicateAssertionIds: string[];
  missingAssertionIds: string[];
  groups: GOnlyGroup[];
  inventory: GOnlyAssertion[];
};

export type GOnlyOutput = {
  selectedAssertionId: string;
};

export type GOnlySelection = {
  groupId: string;
  assertionIds: string[];
  selectedAssertionId: string | null;
  selectedAssertionText: string | null;
  structurallyValid: boolean;
};

export type GOnlyRunRow = {
  requestKey: string;
  groupId: string;
  groupIndex: number;
  requestHash: string;
  output: GOnlyOutput | null;
  rawOutput: unknown;
  structurallyValid: boolean;
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

export type GOnlyRunResult = {
  status: "completed" | "failed";
  providerCallCount: number;
  expectedProviderCallCount: 21;
  configuration: SemanticGroupingConfig;
  rows: GOnlyRunRow[];
  selections: GOnlySelection[];
};

export type { SemanticGroupingConfig };
