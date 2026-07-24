import { Cf1Error } from "./errors.js";

function normalizeUsage(usage = {}) {
  const safeUsage = usage ?? {};
  const inputTokens = Number(safeUsage.input_tokens ?? safeUsage.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(safeUsage.output_tokens ?? safeUsage.completion_tokens ?? 0) || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(safeUsage.total_tokens ?? inputTokens + outputTokens) || 0,
    cachedInputTokens: Number(safeUsage.input_tokens_details?.cached_tokens
      ?? safeUsage.prompt_tokens_details?.cached_tokens ?? 0) || 0,
  };
}

function parseDraft(response) {
  const finishReason = response?.finishReason ?? response?.finish_reason
    ?? response?.rawResponse?.choices?.[0]?.finish_reason;
  if (finishReason === "length") {
    throw new Cf1Error("CF1_MODEL_OUTPUT_TRUNCATED", "Model output hit its token limit", { status: 422 });
  }
  const candidate = response?.output ?? response?.data ?? response;
  let parsed = candidate;
  if (typeof candidate === "string") {
    const trailingWhitespace = candidate.length - candidate.trimEnd().length;
    if (trailingWhitespace > 1_024) {
      throw new Cf1Error("CF1_MODEL_EXCESSIVE_WHITESPACE",
        "Model output ended with excessive whitespace", { status: 422 });
    }
    try {
      parsed = JSON.parse(candidate);
    } catch (cause) {
      throw new Cf1Error("CF1_MALFORMED_MODEL_JSON", "Model response was not valid JSON", { status: 422, cause });
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Cf1Error("CF1_INVALID_MODEL_OUTPUT", "Model response must be a structured object", { status: 422 });
  }
  return parsed;
}

async function invokeWithTimeout(transport, request, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Cf1Error("CF1_INVALID_MODEL_REQUEST", "timeoutMs must be positive", { status: 500 });
  }
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      transport.invoke({ ...request, signal: controller.signal }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Cf1Error("CF1_MODEL_TIMEOUT", "Model request timed out", { status: 503, retryable: true }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function invokeStructured({ transport, usageRecorder = () => {} }, request) {
  if (!transport || typeof transport.invoke !== "function") {
    throw new Cf1Error("CF1_INVALID_MODEL_TRANSPORT", "Model transport must implement invoke", { status: 500 });
  }
  if (!request || typeof request.system !== "string" || typeof request.user !== "string"
    || !request.responseSchema || !request.model || !Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new Cf1Error("CF1_INVALID_MODEL_REQUEST", "Structured model request is incomplete", { status: 500 });
  }
  const maximumAttempts = request.maximumAttempts ?? 2;
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 2) {
    throw new Cf1Error("CF1_INVALID_MODEL_REQUEST", "maximumAttempts must be 1 or 2", { status: 500 });
  }
  let lastError;
  const cumulativeUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 };
  let telemetryWarning = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const response = await invokeWithTimeout(transport, request, request.timeoutMs);
      const usage = normalizeUsage(response?.usage);
      for (const field of Object.keys(cumulativeUsage)) cumulativeUsage[field] += usage[field];
      try {
        usageRecorder({ ...usage, model: response?.model ?? request.model, attempt });
      } catch (error) {
        telemetryWarning = { code: "CF1_USAGE_RECORD_FAILED", message: error.message };
      }
      const output = parseDraft(response);
      return { output, usage: cumulativeUsage, model: response?.model ?? request.model,
        attempts: attempt, rawResponse: response?.rawResponse ?? null, telemetryWarning };
    } catch (error) {
      const failedUsage = normalizeUsage(error?.usage);
      for (const field of Object.keys(cumulativeUsage)) cumulativeUsage[field] += failedUsage[field];
      if (failedUsage.totalTokens > 0) {
        try {
          usageRecorder({ ...failedUsage, model: error?.model ?? request.model, attempt });
        } catch (telemetryError) {
          telemetryWarning = { code: "CF1_USAGE_RECORD_FAILED", message: telemetryError.message };
        }
      }
      lastError = error;
    }
  }
  throw new Cf1Error("CF1_MODEL_UNAVAILABLE",
    `No usable structured model response after ${maximumAttempts} attempt${maximumAttempts === 1 ? "" : "s"}`, {
    status: 503,
    retryable: true,
    cause: lastError,
  });
}

export function createCf1ModelRunner(dependencies) {
  return Object.freeze({
    invokeStructured: (request) => invokeStructured(dependencies, request),
  });
}
