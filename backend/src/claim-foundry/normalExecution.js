import { Cf1Error } from "./errors.js";
import { buildPrimaryPrompt } from "./prompts/primaryPrompt.js";
import { assertBudget, estimateCf1Tokens } from "./tokenBudget.js";

export async function runNormalCf1Analysis({
  article,
  structuralBlocks,
  sourceUnits,
  executionDecision,
  modelRunner,
  model,
  temperature = 0,
  timeoutMs,
  budgetLimits,
  clockMs = () => Date.now(),
}) {
  if (executionDecision?.path !== "normal") {
    throw new Cf1Error("CF1_WRONG_EXECUTION_PATH", "Normal execution requires a normal path decision", { status: 400 });
  }
  if (!modelRunner || typeof modelRunner.invokeStructured !== "function") {
    throw new Cf1Error("CF1_INVALID_MODEL_RUNNER", "A structured model runner is required", { status: 500 });
  }
  const startedAtMs = clockMs();
  const prompt = buildPrimaryPrompt({ article, structuralBlocks, sourceUnits });
  const reservedTokens = estimateCf1Tokens({
    system: prompt.system,
    user: prompt.user,
    responseSchema: prompt.responseSchema,
  }) + budgetLimits.maxOutputTokensPerCall;
  const beforeUsage = { semanticCalls: 1, primaryCalls: 1, batchCalls: 0, synthesisCalls: 0,
    repairCalls: 0, totalTokens: reservedTokens,
    lastOutputTokens: budgetLimits.maxOutputTokensPerCall, elapsedMs: 0 };
  assertBudget({ path: "normal", usage: beforeUsage, limits: budgetLimits });

  const response = await modelRunner.invokeStructured({
    ...prompt,
    model,
    temperature,
    timeoutMs,
    maxOutputTokens: budgetLimits.maxOutputTokensPerCall,
    usageContext: { component: "claim_foundry", path: "normal", stage: "primary" },
  });
  const elapsedMs = Math.max(0, clockMs() - startedAtMs);
  const usage = { ...beforeUsage, totalTokens: response.usage.totalTokens,
    lastOutputTokens: response.usage.outputTokens, elapsedMs, transportAttempts: response.attempts };
  assertBudget({ path: "normal", usage, limits: budgetLimits });

  return {
    agentDraft: response.output,
    usage,
    model: response.model,
    rawResponse: response.rawResponse,
    telemetryWarning: response.telemetryWarning,
  };
}
