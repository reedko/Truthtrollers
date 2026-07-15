import { Cf1Error } from "./errors.js";

export const CF1_PATH_LIMITS = Object.freeze({
  normal: Object.freeze({ maximumBlocks: 80, maximumSemanticCalls: 2 }),
  long: Object.freeze({ maximumBatchCalls: 6, maximumSemanticCalls: 8 }),
  agent: Object.freeze({ maximumSemanticCalls: 2 }),
  primaryContextFraction: 0.60,
});

function finitePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Cf1Error("CF1_INVALID_BUDGET", `${name} must be a positive number`, { status: 400 });
  }
  return value;
}

function serializableText(payload) {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export function estimateCf1Tokens(payload, { charsPerToken = 3 } = {}) {
  finitePositive(charsPerToken, "charsPerToken");
  const text = serializableText(payload);
  if (typeof text !== "string") throw new Cf1Error("CF1_TOKEN_ESTIMATE_FAILED", "Payload is not serializable", { status: 400 });
  return Math.ceil(Buffer.byteLength(text, "utf8") / charsPerToken);
}

export function chooseExecutionPath({
  article,
  structuralBlocks,
  modelContextTokens,
  promptOverheadTokens = 0,
  tokenEstimator = estimateCf1Tokens,
}) {
  finitePositive(modelContextTokens, "modelContextTokens");
  if (!Number.isFinite(promptOverheadTokens) || promptOverheadTokens < 0) {
    throw new Cf1Error("CF1_INVALID_BUDGET", "promptOverheadTokens must be nonnegative", { status: 400 });
  }
  const articleTokens = tokenEstimator(article.text);
  const estimatedPrimaryTokens = articleTokens + promptOverheadTokens;
  const primaryTokenCeiling = Math.floor(modelContextTokens * CF1_PATH_LIMITS.primaryContextFraction);
  const tooManyBlocks = structuralBlocks.length > CF1_PATH_LIMITS.normal.maximumBlocks;
  return {
    path: estimatedPrimaryTokens > primaryTokenCeiling || tooManyBlocks ? "long" : "normal",
    articleTokens,
    estimatedPrimaryTokens,
    primaryTokenCeiling,
    blockCount: structuralBlocks.length,
    reasons: [
      ...(estimatedPrimaryTokens > primaryTokenCeiling ? ["primary_context_threshold"] : []),
      ...(tooManyBlocks ? ["block_count_threshold"] : []),
    ],
  };
}

export function assertBudget({ path, usage, limits }) {
  if (!CF1_PATH_LIMITS[path]) throw new Cf1Error("CF1_INVALID_BUDGET", `Unknown execution path: ${path}`, { status: 400 });
  for (const field of ["maxTotalTokens", "maxOutputTokensPerCall", "maxDurationMs"]) finitePositive(limits?.[field], field);
  const requestedCallCeiling = limits?.maxSemanticCalls ?? CF1_PATH_LIMITS[path].maximumSemanticCalls;
  finitePositive(requestedCallCeiling, "maxSemanticCalls");
  const callCeiling = Math.min(requestedCallCeiling, CF1_PATH_LIMITS[path].maximumSemanticCalls);
  const checks = [
    [usage.semanticCalls, callCeiling, "semantic call ceiling"],
    [usage.primaryCalls, path === "normal" ? 1 : 0, "primary call ceiling"],
    [usage.agentCalls, path === "agent" ? 2 : 0, "agent stage call ceiling"],
    [usage.batchCalls, path === "long" ? CF1_PATH_LIMITS.long.maximumBatchCalls : 0, "batch call ceiling"],
    [usage.synthesisCalls, path === "long" ? 1 : 0, "synthesis call ceiling"],
    [usage.repairCalls, 1, "repair call ceiling"],
    [usage.totalTokens, limits?.maxTotalTokens, "total token ceiling"],
    [usage.lastOutputTokens, limits?.maxOutputTokensPerCall, "per-call output token ceiling"],
    [usage.elapsedMs, limits?.maxDurationMs, "wall-clock ceiling"],
  ];
  for (const [actual = 0, maximum, label] of checks) {
    if (maximum !== undefined && (!Number.isFinite(maximum) || maximum < 0)) {
      throw new Cf1Error("CF1_INVALID_BUDGET", `${label} must be a nonnegative number`, { status: 400 });
    }
    if (!Number.isFinite(actual) || actual < 0) throw new Cf1Error("CF1_INVALID_USAGE", `${label} usage is invalid`, { status: 500 });
    if (maximum !== undefined && actual > maximum) {
      throw new Cf1Error("CF1_BUDGET_EXCEEDED", `CF1 exceeded its ${label}`, {
        status: 429,
        retryable: false,
        issues: [{ code: "CF1_BUDGET_EXCEEDED", path: "/usage", message: `${actual} > ${maximum}`, relatedIds: [] }],
      });
    }
  }
  return true;
}
