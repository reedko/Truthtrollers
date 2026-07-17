import { ER1_PIPELINE_VERSION, ER1_STATE_SCHEMA_VERSION } from "./contract.js";

export function buildOfflineState({ runId, packageValue, portfolio, identityRegistry, lanePlan, options }) {
  const timestamp = new Date().toISOString();
  const steps = [
    ["load_package", [packageValue.packageId]],
    ["build_target_portfolio", portfolio.tasks.map((task) => task.taskId)],
    ["normalize_identity_registry", identityRegistry.entries.map((x) => x.identityBundleId)],
    ["plan_query_lanes", lanePlan.lanes.map((lane) => lane.laneId)],
  ].map(([stage, outputRefs], index) => ({
    stepId: `STEP-${String(index + 1).padStart(2, "0")}`,
    stage, status: "completed", startedAt: timestamp, endedAt: timestamp,
    inputRefs: index ? stepsInput(index, packageValue.packageId) : [], outputRefs,
  }));
  return {
    schemaVersion: ER1_STATE_SCHEMA_VERSION,
    pipelineVersion: ER1_PIPELINE_VERSION,
    runId,
    packageIdentity: {
      packageId: packageValue.packageId, schemaVersion: packageValue.schemaVersion,
      packageHash: packageValue.packageHash,
    },
    status: "planning",
    budgets: {
      deadlineMs: options.deadlineMs || 100_000,
      maxFetches: options.maxFetches || 20,
      maxFollowUpWaves: options.allowFollowUpWave === false ? 0 : 1,
    },
    usage: { elapsedMs: 0, providerCalls: 0, fetches: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0 },
    tasks: portfolio.tasks.map((task) => ({
      taskId: task.taskId, selectedClaimId: task.selectedClaimId,
      targetIds: task.targetIds, claimText: task.claimText, status: task.status,
    })),
    identityRegistry: identityRegistry.entries,
    candidates: [], sources: [], assertions: [], criticFindings: [], events: [], steps,
    startedAt: timestamp, updatedAt: timestamp, completedAt: null, error: null,
  };
}

function stepsInput(index, packageId) {
  return index === 1 ? [packageId] : [`STEP-${String(index).padStart(2, "0")}`];
}
