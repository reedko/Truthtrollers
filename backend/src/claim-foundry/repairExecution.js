import { Cf1Error } from "./errors.js";
import { applyCf1Repair } from "./applyRepair.js";
import { buildRepairRequest } from "./repairContract.js";
import { buildRepairPrompt } from "./prompts/repairPrompt.js";
import { assertBudget, estimateCf1Tokens } from "./tokenBudget.js";
import { verifyCf1Package } from "./verifyPackage.js";

export async function runCf1Repair({
  packageDraft,
  verification,
  modelRunner,
  usageSoFar,
  budgetLimits,
  model,
  temperature = 0,
  timeoutMs,
  clockMs = () => Date.now(),
  verificationClock = () => new Date(),
}) {
  if (!modelRunner || typeof modelRunner.invokeStructured !== "function") {
    throw new Cf1Error("CF1_INVALID_MODEL_RUNNER", "A structured model runner is required", { status: 500 });
  }
  const repairRequest = buildRepairRequest(packageDraft, verification);
  const executionPath = (usageSoFar.agentCalls ?? 0) > 0 ? "agent"
    : (usageSoFar.batchCalls ?? 0) > 0 || (usageSoFar.synthesisCalls ?? 0) > 0
      ? "long" : "normal";
  const startedAtMs = clockMs();
  const prompt = buildRepairPrompt(repairRequest);
  const reservedTokens = estimateCf1Tokens({
    system: prompt.system,
    user: prompt.user,
    responseSchema: prompt.responseSchema,
  }) + budgetLimits.maxOutputTokensPerCall;
  const projectedUsage = { ...usageSoFar, semanticCalls: (usageSoFar.semanticCalls ?? 0) + 1,
    repairCalls: (usageSoFar.repairCalls ?? 0) + 1,
    totalTokens: (usageSoFar.totalTokens ?? 0) + reservedTokens,
    lastOutputTokens: budgetLimits.maxOutputTokensPerCall };
  assertBudget({ path: executionPath, usage: projectedUsage, limits: budgetLimits });

  const response = await modelRunner.invokeStructured({
    ...prompt, model, temperature, timeoutMs,
    maxOutputTokens: budgetLimits.maxOutputTokensPerCall,
    usageContext: { component: "claim_foundry", path: executionPath, stage: "repair" },
  });
  const usage = { ...projectedUsage,
    totalTokens: (usageSoFar.totalTokens ?? 0) + response.usage.totalTokens,
    lastOutputTokens: response.usage.outputTokens,
    elapsedMs: (usageSoFar.elapsedMs ?? 0) + Math.max(0, clockMs() - startedAtMs),
    transportAttempts: (usageSoFar.transportAttempts ?? 0) + response.attempts };
  assertBudget({ path: executionPath, usage, limits: budgetLimits });

  const repairedDraft = applyCf1Repair(packageDraft, response.output, repairRequest.allowedPaths);
  const repairedVerification = verifyCf1Package(repairedDraft, {
    clock: verificationClock,
    repairAttempted: true,
  });
  return {
    packageDraft: repairedDraft,
    verification: repairedVerification,
    usage,
    terminal: !repairedVerification.valid,
    cannotRepair: [...response.output.cannotRepair],
    telemetryWarning: response.telemetryWarning,
  };
}
