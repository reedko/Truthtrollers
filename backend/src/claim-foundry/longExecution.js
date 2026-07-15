import { Cf1Error } from "./errors.js";
import { buildBlockObservationPrompt } from "./prompts/blockObservationPrompt.js";
import { buildSynthesisPrompt } from "./prompts/synthesisPrompt.js";
import { assertBudget, estimateCf1Tokens } from "./tokenBudget.js";

const MAX_BATCHES = 6;

function promptTokens(prompt, tokenEstimator) {
  return tokenEstimator({ system: prompt.system, user: prompt.user, responseSchema: prompt.responseSchema });
}

function promptBlocks(blocks, sourceUnits) {
  const units = new Map((sourceUnits ?? []).map((unit) => [unit.unitId, unit]));
  return blocks.map((block) => ({ ...block, sourceUnits: (block.sourceUnitIds ?? [])
    .map((unitId) => units.get(unitId)).filter(Boolean).map(({ unitId, text }) => ({ unitId, text })) }));
}

export function buildBlockBatches({ article, structuralBlocks, sourceUnits = [], modelContextTokens,
  tokenEstimator = estimateCf1Tokens }) {
  if (!Array.isArray(structuralBlocks) || !structuralBlocks.length) {
    throw new Cf1Error("CF1_INVALID_BLOCKS", "Long execution requires structural blocks", { status: 400 });
  }
  if (!Number.isFinite(modelContextTokens) || modelContextTokens <= 0) {
    throw new Cf1Error("CF1_INVALID_BUDGET", "modelContextTokens must be positive", { status: 400 });
  }
  const batchInputCeiling = Math.floor(modelContextTokens * 0.25);
  const groups = [];
  let current = [];

  for (const block of structuralBlocks) {
    const candidate = [...current, block];
    const batchId = `L${String(groups.length + 1).padStart(2, "0")}`;
    const estimated = promptTokens(buildBlockObservationPrompt({ article, batchId,
      blocks: promptBlocks(candidate, sourceUnits) }), tokenEstimator);
    if (estimated <= batchInputCeiling) {
      current = candidate;
      continue;
    }
    if (!current.length) throw new Cf1Error("CF1_INPUT_TOO_LARGE", `Block ${block.blockId} cannot fit a long-path batch`, { status: 413 });
    groups.push(current);
    if (groups.length >= MAX_BATCHES) throw new Cf1Error("CF1_INPUT_TOO_LARGE", "Article requires more than six observation batches", { status: 413 });
    current = [block];
    const nextId = `L${String(groups.length + 1).padStart(2, "0")}`;
    if (promptTokens(buildBlockObservationPrompt({ article, batchId: nextId,
      blocks: promptBlocks(current, sourceUnits) }), tokenEstimator) > batchInputCeiling) {
      throw new Cf1Error("CF1_INPUT_TOO_LARGE", `Block ${block.blockId} cannot fit a long-path batch`, { status: 413 });
    }
  }
  if (current.length) groups.push(current);
  if (groups.length > MAX_BATCHES) throw new Cf1Error("CF1_INPUT_TOO_LARGE", "Article requires more than six observation batches", { status: 413 });

  return groups.map((blocks, index) => {
    const batchId = `L${String(index + 1).padStart(2, "0")}`;
    return { batchId, blocks, estimatedInputTokens: promptTokens(
      buildBlockObservationPrompt({ article, batchId, blocks: promptBlocks(blocks, sourceUnits) }), tokenEstimator),
      inputTokenCeiling: batchInputCeiling };
  });
}

function assertObservation(observation, batch) {
  const expected = new Set(batch.blocks.map((block) => block.blockId));
  const expectedUnits = new Map(batch.blocks.flatMap((block) => (block.sourceUnitIds ?? [])
    .map((unitId) => [unitId, block.blockId])));
  const unitOrder = new Map([...expectedUnits.keys()].map((unitId, index) => [unitId, index]));
  const annotations = observation?.blockAnnotations;
  if (!Array.isArray(annotations) || annotations.length !== expected.size
    || new Set(annotations.map((item) => item.blockId)).size !== expected.size
    || annotations.some((item) => !expected.has(item.blockId))) {
    throw new Cf1Error("CF1_INVALID_BLOCK_OBSERVATION", `Batch ${batch.batchId} does not annotate every block exactly once`, { status: 422 });
  }
  for (const assertion of observation.candidateAssertions ?? []) {
    const units = assertion.sourceUnitIds ?? [];
    if (!units.length || new Set(units).size !== units.length
      || units.some((unitId) => !expectedUnits.has(unitId))
      || units.some((unitId, index) => index > 0
        && unitOrder.get(unitId) <= unitOrder.get(units[index - 1]))) {
      throw new Cf1Error("CF1_INVALID_BLOCK_OBSERVATION", `Batch ${batch.batchId} contains ungrounded assertion provenance`, { status: 422 });
    }
  }
  const candidateIds = (observation.candidateAssertions ?? []).map((item) => item.candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) throw new Cf1Error("CF1_INVALID_BLOCK_OBSERVATION", `Batch ${batch.batchId} repeats candidate IDs`, { status: 422 });
  for (const item of observation.namedWorksAndIdentifiers ?? []) {
    const block = batch.blocks.find((candidate) => candidate.blockId === item.blockId);
    if (!block || !(item.sourceUnitIds ?? []).length
      || item.sourceUnitIds.some((unitId) => expectedUnits.get(unitId) !== block.blockId)) {
      throw new Cf1Error("CF1_INVALID_BLOCK_OBSERVATION", `Batch ${batch.batchId} contains an ungrounded named work`, { status: 422 });
    }
  }
  for (const link of observation.possibleCrossBlockLinks ?? []) {
    if (!(link.blockIds ?? []).every((id) => expected.has(id))) throw new Cf1Error("CF1_INVALID_BLOCK_OBSERVATION", `Batch ${batch.batchId} contains an out-of-batch link`, { status: 422 });
  }
}

function assertSynthesisCoverage(agentDraft, structuralBlocks) {
  const expected = new Set(structuralBlocks.map((block) => block.blockId));
  const annotations = agentDraft?.semanticBlockAnnotations;
  if (!Array.isArray(annotations) || annotations.length !== expected.size
    || new Set(annotations.map((item) => item.blockId)).size !== expected.size
    || annotations.some((item) => !expected.has(item.blockId))) {
    throw new Cf1Error("CF1_INCOMPLETE_LONG_SYNTHESIS", "Long synthesis must annotate every article block exactly once", { status: 422 });
  }
}

async function invokeLongStage({ prompt, stage, modelRunner, model, temperature, timeoutMs,
  budgetLimits, usage, clockMs, startedAtMs, tokenEstimator }) {
  const reservedTokens = promptTokens(prompt, tokenEstimator) + budgetLimits.maxOutputTokensPerCall;
  const projected = { ...usage,
    semanticCalls: usage.semanticCalls + 1,
    batchCalls: usage.batchCalls + (stage === "batch" ? 1 : 0),
    synthesisCalls: usage.synthesisCalls + (stage === "synthesis" ? 1 : 0),
    totalTokens: usage.totalTokens + reservedTokens,
    lastOutputTokens: budgetLimits.maxOutputTokensPerCall,
    elapsedMs: Math.max(0, clockMs() - startedAtMs) };
  assertBudget({ path: "long", usage: projected, limits: budgetLimits });
  const response = await modelRunner.invokeStructured({ ...prompt, model, temperature, timeoutMs,
    maxOutputTokens: budgetLimits.maxOutputTokensPerCall,
    usageContext: { component: "claim_foundry", path: "long", stage } });
  const actual = { ...projected,
    totalTokens: usage.totalTokens + (response.usage?.totalTokens ?? 0),
    lastOutputTokens: response.usage?.outputTokens ?? 0,
    elapsedMs: Math.max(0, clockMs() - startedAtMs),
    transportAttempts: usage.transportAttempts + (response.attempts ?? 1) };
  assertBudget({ path: "long", usage: actual, limits: budgetLimits });
  return { response, usage: actual };
}

export async function runLongCf1Analysis({ article, structuralBlocks, executionDecision,
  sourceUnits,
  modelRunner, model, temperature = 0, timeoutMs, budgetLimits, modelContextTokens,
  tokenEstimator = estimateCf1Tokens, clockMs = () => Date.now() }) {
  if (executionDecision?.path !== "long") throw new Cf1Error("CF1_WRONG_EXECUTION_PATH", "Long execution requires a long path decision", { status: 400 });
  if (!modelRunner || typeof modelRunner.invokeStructured !== "function") throw new Cf1Error("CF1_INVALID_MODEL_RUNNER", "A structured model runner is required", { status: 500 });
  const batches = buildBlockBatches({ article, structuralBlocks, sourceUnits, modelContextTokens, tokenEstimator });
  const startedAtMs = clockMs();
  let usage = { semanticCalls: 0, primaryCalls: 0, batchCalls: 0, synthesisCalls: 0,
    repairCalls: 0, totalTokens: 0, lastOutputTokens: 0, elapsedMs: 0, transportAttempts: 0 };
  const observations = [];
  const rawResponses = [];

  for (const batch of batches) {
    const prompt = buildBlockObservationPrompt({ article, batchId: batch.batchId,
      blocks: promptBlocks(batch.blocks, sourceUnits) });
    const invoked = await invokeLongStage({ prompt, stage: "batch", modelRunner, model,
      temperature, timeoutMs, budgetLimits, usage, clockMs, startedAtMs, tokenEstimator });
    usage = invoked.usage;
    assertObservation(invoked.response.output, batch);
    observations.push({ batchId: batch.batchId, blockIds: batch.blocks.map((block) => block.blockId), ...invoked.response.output });
    rawResponses.push(invoked.response.rawResponse);
  }

  const synthesisPrompt = buildSynthesisPrompt({ article, observations });
  if (promptTokens(synthesisPrompt, tokenEstimator) + budgetLimits.maxOutputTokensPerCall > modelContextTokens) {
    throw new Cf1Error("CF1_INPUT_TOO_LARGE", "Compact observations cannot fit the synthesis context", { status: 413 });
  }
  const synthesized = await invokeLongStage({ prompt: synthesisPrompt, stage: "synthesis",
    modelRunner, model, temperature, timeoutMs, budgetLimits, usage, clockMs, startedAtMs, tokenEstimator });
  assertSynthesisCoverage(synthesized.response.output, structuralBlocks);
  return { agentDraft: synthesized.response.output, usage: synthesized.usage, observations,
    batches: batches.map(({ batchId, blocks, estimatedInputTokens, inputTokenCeiling }) => ({
      batchId, blockIds: blocks.map((block) => block.blockId), estimatedInputTokens, inputTokenCeiling })),
    model: synthesized.response.model, rawResponses: [...rawResponses, synthesized.response.rawResponse] };
}
