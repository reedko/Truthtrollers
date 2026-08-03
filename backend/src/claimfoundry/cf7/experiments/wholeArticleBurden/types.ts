import type {
  SemanticGroupingConfig,
} from "../semanticGrouping/types.js";

export type WholeArticleBurdenArticle = {
  title: string;
  text: string;
};

export type WholeArticleBurdenOutputRow = {
  assertion: string;
  assertionSource: string;
  whyItMattersToArticleThesis: string;
};

export type WholeArticleBurdenOutput = {
  propositions: WholeArticleBurdenOutputRow[];
};

export type WholeArticleBurdenFrozenInput = {
  fixture: "CF1-F03";
  fixturePath: string;
  fixtureFileSha256: string;
  articleTextSha256: string;
  articleCharacterCount: number;
  article: WholeArticleBurdenArticle;
};

export type WholeArticleBurdenRunResult = {
  status: "completed" | "failed";
  providerCallCount: 1;
  output: WholeArticleBurdenOutput | null;
  rawOutput: unknown;
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
  requestHash: string;
  error: { name: string; message: string } | null;
  configuration: SemanticGroupingConfig;
};

export type { SemanticGroupingConfig };
