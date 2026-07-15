/**
 * Runtime contracts are documented here and created through the factories below.
 * They remain plain JSON so traces can be persisted and inspected without adapters.
 *
 * @typedef {Object} CF1AgentStepTrace
 * @property {string} stage
 * @property {"running"|"completed"|"failed"} status
 * @property {string} startedAt
 * @property {string|null} completedAt
 * @property {number} sequence
 * @property {boolean} modelCall
 *
 * @typedef {Object} CF1CriticReport
 * @property {Array<Object>} findings
 * @property {Object} portfolioAssessment
 * @property {string} summary
 *
 * @typedef {Object} CF1RevisionPlan
 * @property {Array<Object>} actions
 * @property {Array<string>} criticFindingIds
 * @property {string} objective
 *
 * @typedef {Object} CF1AgentState
 * @property {string} runId
 * @property {string} status
 * @property {Array<CF1AgentStepTrace>} stepTrace
 * @property {Object|null} orientation
 * @property {Object|null} initialWorkProduct
 * @property {CF1CriticReport|null} criticReport
 * @property {CF1RevisionPlan|null} revisionPlan
 * @property {Object|null} revisedWorkProduct
 * @property {Object|null} targetWorkProduct
 * @property {Object|null} oneCallOutput
 * @property {Object|null} semanticInventoryOutput
 * @property {Object|null} selectedEnrichmentOutput
 * @property {Object|null} usage
 *
 * @typedef {Object} CF1AgentRunResult
 * @property {CF1AgentState} state
 * @property {Object} agentDraft
 * @property {Object} usage
 */

export function createCf1AgentState(runId) {
  return {
    runId,
    status: "running",
    stepTrace: [],
    orientation: null,
    initialWorkProduct: null,
    criticReport: null,
    revisionPlan: null,
    revisedWorkProduct: null,
    targetWorkProduct: null,
    oneCallOutput: null,
    semanticInventoryOutput: null,
    selectedEnrichmentOutput: null,
    usage: null,
  };
}

export function beginAgentStep(state, stage, now, { modelCall = true } = {}) {
  const step = {
    stage,
    status: "running",
    startedAt: now().toISOString(),
    completedAt: null,
    sequence: state.stepTrace.length + 1,
    modelCall,
  };
  state.stepTrace.push(step);
  return step;
}

export function recordAgentStep(state, stage, now, details = {}) {
  const step = beginAgentStep(state, stage, now, { modelCall: false });
  completeAgentStep(step, now, details);
  return step;
}

export function completeAgentStep(step, now, details = {}) {
  Object.assign(step, details, { status: "completed", completedAt: now().toISOString() });
}

export function failAgentStep(step, now, error) {
  Object.assign(step, {
    status: "failed",
    completedAt: now().toISOString(),
    error: { code: error?.code ?? "CF1_AGENT_STAGE_FAILED", message: error?.message ?? "Agent stage failed" },
  });
}

export function buildRevisionPlan(criticReport) {
  const findings = criticReport?.findings ?? [];
  return {
    objective: "Revise the claim inventory and selected portfolio in response to every critic finding.",
    criticFindingIds: findings.map((finding) => finding.findingId),
    actions: findings.map((finding) => ({
      findingId: finding.findingId,
      action: finding.recommendedAction,
      affectedClaimIds: finding.affectedClaimIds,
      sourceBlockIds: finding.sourceBlockIds,
    })),
  };
}
