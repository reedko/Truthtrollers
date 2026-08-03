export type Cf7RequestAccounting = {
  requestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number | null;
};

export const EMPTY_CF7_REQUEST_ACCOUNTING: Readonly<Cf7RequestAccounting> =
  Object.freeze({
    requestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    estimatedCostUsd: null,
  });
