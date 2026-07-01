import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

function emptyCapture(metadata = {}) {
  return {
    metadata: { ...metadata },
    startedAtMs: Date.now(),
    completedAtMs: null,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    models: {},
  };
}

export function withOpenAiUsageCapture(metadata, fn) {
  return storage.run(emptyCapture(metadata), fn);
}

export function recordOpenAiUsage(usage = {}, model = "unknown") {
  const capture = storage.getStore();
  if (!capture || !usage) return;

  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? (inputTokens + outputTokens)) || 0;
  const cachedInputTokens = Number(
    usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0,
  ) || 0;

  capture.calls += 1;
  capture.inputTokens += inputTokens;
  capture.outputTokens += outputTokens;
  capture.totalTokens += totalTokens;
  capture.cachedInputTokens += cachedInputTokens;

  const modelKey = String(model || "unknown");
  const modelUsage = capture.models[modelKey] || {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  modelUsage.calls += 1;
  modelUsage.inputTokens += inputTokens;
  modelUsage.outputTokens += outputTokens;
  modelUsage.totalTokens += totalTokens;
  capture.models[modelKey] = modelUsage;
}

export function getOpenAiUsageCapture() {
  const capture = storage.getStore();
  if (!capture) return null;
  return {
    ...capture,
    metadata: { ...capture.metadata },
    models: Object.fromEntries(
      Object.entries(capture.models).map(([model, usage]) => [model, { ...usage }]),
    ),
  };
}

export function finishOpenAiUsageCapture(metadata = {}) {
  const capture = storage.getStore();
  if (!capture) return null;
  capture.metadata = { ...capture.metadata, ...metadata };
  capture.completedAtMs = Date.now();
  return getOpenAiUsageCapture();
}
