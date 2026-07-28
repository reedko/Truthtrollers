export type NormalizedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type NormalizedTraceMetadata = {
  runId: string;
  traceId: string;
  lastResponseId: string | null;
  model: string;
  modelTurns: number;
  toolCalls: number;
  usage: NormalizedUsage;
  durationMs: number;
  terminationReason: "completed" | "budget_exceeded" | "failed";
};

export type ToolEvent = {
  name: string;
  validatedArguments: unknown;
  output: unknown;
  durationMs: number;
};
