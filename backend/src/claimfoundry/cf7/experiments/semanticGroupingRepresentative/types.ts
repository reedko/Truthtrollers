import type {
  SemanticGroupingAssertion,
  SemanticGroupingConfig,
  SemanticGroupingValidation,
} from "../semanticGrouping/types.js";

export type Gde2PromptId = "G" | "D" | "E";
export type Gde2VariantId = "A" | "B" | "C";
export type Gde2ExperimentId = `${Gde2PromptId}-${Gde2VariantId}`;

export type Gde2SelectedGroup = {
  groupId: string;
  assertionIds: string[];
  representativeAssertionId: string;
};

export type Gde2SynthesizedGroup = {
  groupId: string;
  assertionIds: string[];
  representativeAssertion: string;
};

export type Gde2HybridGroup =
  | {
    groupId: string;
    assertionIds: string[];
    representativeType: "selected";
    representativeAssertionId: string;
  }
  | {
    groupId: string;
    assertionIds: string[];
    representativeType: "synthesized";
    representativeAssertion: string;
  };

export type Gde2Output =
  | { groups: Gde2SelectedGroup[] }
  | { groups: Gde2SynthesizedGroup[] }
  | { groups: Gde2HybridGroup[] };

export type Gde2Validation = SemanticGroupingValidation & {
  invalidRepresentativeGroupIds: string[];
  selectedRepresentativeOutsideGroup: Array<{
    groupId: string;
    representativeAssertionId: string;
  }>;
};

export type Gde2RunRow = {
  experimentId: Gde2ExperimentId;
  promptId: Gde2PromptId;
  variantId: Gde2VariantId;
  originalPromptText: string;
  representativeAddition: string;
  combinedPromptHash: string;
  schemaHash: string;
  requestHash: string;
  output: Gde2Output | null;
  rawOutput: unknown;
  validation: Gde2Validation;
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

export type Gde2RunResult = {
  status: "completed" | "failed";
  providerCallCount: number;
  promptCount: 9;
  assertionCount: number;
  assertionInventoryHash: string;
  commonRulesHash: string;
  configuration: SemanticGroupingConfig;
  rows: Gde2RunRow[];
};

export type { SemanticGroupingAssertion, SemanticGroupingConfig };
