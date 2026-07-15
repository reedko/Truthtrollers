import { Cf1Error } from "./errors.js";
import { assertBudget } from "./tokenBudget.js";
import { beginAgentStep, completeAgentStep, createCf1AgentState,
  failAgentStep, recordAgentStep } from "./agentTypes.js";
import { runHostSemanticCritic } from "./hostSemanticCritic.js";
import { buildSemanticInventoryPrompt } from "./prompts/semanticInventoryPrompt.js";
import { buildSelectedEnrichmentPrompt } from "./prompts/selectedEnrichmentPrompt.js";
import { expandTwoCallAgentOutput } from "./twoCallAgentOutput.js";
import { verifySemanticInventory, verifySelectedEnrichment } from "./twoCallAgentVerification.js";

function initialUsage() {
  return { semanticCalls: 0, agentCalls: 0, primaryCalls: 0, batchCalls: 0,
    synthesisCalls: 0, repairCalls: 0, totalTokens: 0, lastOutputTokens: 0,
    elapsedMs: 0, transportAttempts: 0 };
}

function ensureRunner(modelRunner) {
  if (!modelRunner || typeof modelRunner.invokeStructured !== "function") {
    throw new Cf1Error("CF1_INVALID_MODEL_RUNNER", "A structured model runner is required", { status: 500 });
  }
}

async function invokeStage({ state, stage, prompt, modelRunner, model, temperature,
  timeoutMs, budgetLimits, usage, clock, clockMs }) {
  const step = beginAgentStep(state, stage, clock);
  const started = clockMs();
  try {
    const projected = { ...usage, semanticCalls: usage.semanticCalls + 1,
      agentCalls: usage.agentCalls + 1,
      lastOutputTokens: budgetLimits.maxOutputTokensPerCall };
    assertBudget({ path: "agent", usage: projected, limits: budgetLimits });
    const response = await modelRunner.invokeStructured({
      ...prompt, model, temperature, timeoutMs,
      maximumAttempts: 1,
      maxOutputTokens: budgetLimits.maxOutputTokensPerCall,
      usageContext: { component: "claim_foundry", path: "agent", stage },
    });
    const nextUsage = { ...projected,
      totalTokens: usage.totalTokens + response.usage.totalTokens,
      lastOutputTokens: response.usage.outputTokens,
      elapsedMs: usage.elapsedMs + Math.max(0, clockMs() - started),
      transportAttempts: usage.transportAttempts + response.attempts };
    assertBudget({ path: "agent", usage: nextUsage, limits: budgetLimits });
    completeAgentStep(step, clock, { usage: response.usage, outputKeys: Object.keys(response.output) });
    return { output: response.output, usage: nextUsage };
  } catch (error) {
    failAgentStep(step, clock, error);
    throw error;
  }
}

/** @returns {Promise<import('./agentTypes.js').CF1AgentRunResult>} */
export async function runCf1Agent({ runId, article, structuralBlocks, sourceUnits,
  modelRunner, model, temperature = 0, timeoutMs, budgetLimits,
  clock = () => new Date(), clockMs = () => Date.now() }) {
  ensureRunner(modelRunner);
  const state = createCf1AgentState(runId);
  const context = { article, structuralBlocks, sourceUnits };
  let usage = initialUsage();
  const stage = async (name, prompt) => {
    const result = await invokeStage({ state, stage: name, prompt, modelRunner, model,
      temperature, timeoutMs, budgetLimits, usage, clock, clockMs });
    usage = result.usage;
    return result.output;
  };

  try {
    const fullArticle = article.text.length >= 5_000;
    const inventoryRaw = await stage("semantic_inventory", buildSemanticInventoryPrompt(context));
    const inventory = verifySemanticInventory(inventoryRaw, { sourceUnits, article,
      minimumCandidates: fullArticle ? 16 : 1 });
    state.semanticInventoryOutput = structuredClone(inventory);
    state.orientation = { theme: inventory.theme.text, thesis: inventory.thesis.text,
      pillars: structuredClone(inventory.pillars) };
    recordAgentStep(state, "orientation_materialized", clock, { source: "semantic_inventory" });
    state.initialWorkProduct = { initialCandidates: structuredClone(inventory.candidateClaims) };
    recordAgentStep(state, "initial_claims_materialized", clock,
      { source: "semantic_inventory", claimCount: inventory.candidateClaims.length });
    const critic = runHostSemanticCritic(inventory, { sourceUnits, structuralBlocks,
      targetMinimum: fullArticle ? 8 : 1, targetMaximum: fullArticle ? 10 : 10 });
    state.criticReport = structuredClone(critic);
    recordAgentStep(state, "host_semantic_critic", clock,
      { selectedClaimCount: critic.selectedClaims.length, findingCount: critic.findings.length });
    state.revisionPlan = { objective: "Enrich only the host-selected portfolio.",
      actions: structuredClone(critic.candidateDecisions) };
    const allowedIds = new Set(critic.selectedClaims.flatMap((claim) => claim.sourceUnitIds));
    for (const id of [...inventory.theme.sourceUnitIds, ...inventory.thesis.sourceUnitIds,
      ...inventory.pillars.filter((pillar) => pillar.importance !== "supporting")
        .flatMap((pillar) => pillar.sourceUnitIds)]) allowedIds.add(id);
    for (const label of critic.uncoveredPillarLabels) {
      const pillar = inventory.pillars.find((item) => item.label === label);
      for (const id of pillar?.sourceUnitIds ?? []) allowedIds.add(id);
    }
    const enrichmentRaw = await stage("selected_claim_enrichment", buildSelectedEnrichmentPrompt({
      orientation: state.orientation, selectedClaims: critic.selectedClaims,
      criticReport: critic, sourceUnits: sourceUnits.filter((unit) => allowedIds.has(unit.unitId)),
      namedWorkPool: inventory.namedWorks,
    }));
    state.selectedEnrichmentOutput = structuredClone(enrichmentRaw);
    const oldShape = verifySelectedEnrichment(enrichmentRaw,
      { selectedClaims: critic.selectedClaims, inventory, sourceUnits, criticReport: critic, article });
    state.revisedWorkProduct = expandTwoCallAgentOutput(oldShape, { structuralBlocks, article });
    recordAgentStep(state, "revision_and_selection_materialized", clock,
      { source: "selected_claim_enrichment", selectedClaimCount: oldShape.selectedClaims.length,
        changeCount: critic.candidateDecisions.filter((item) => item.decision === "drop").length });
    state.targetWorkProduct = {
      phase3Targets: structuredClone(state.revisedWorkProduct.phase3Targets),
      evidenceNeedCards: structuredClone(state.revisedWorkProduct.evidenceNeedCards),
    };
    const agentDraft = state.revisedWorkProduct;
    state.usage = structuredClone(usage);
    state.status = "completed";
    return { state, agentDraft, usage };
  } catch (error) {
    state.status = "failed";
    throw Object.assign(error, { agentState: state });
  }
}
