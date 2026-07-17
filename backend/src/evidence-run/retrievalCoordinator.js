import { createHash } from "node:crypto";
import { ER1_DISCOVERY_LIMITS } from "./contract.js";

const bounded = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
};

export function normalizeDiscoveryLimits(input = {}) {
  const d = ER1_DISCOVERY_LIMITS;
  return Object.freeze({
    maxTargets: bounded(input.maxTargets, d.maxTargets, 1, d.maxTargets),
    maxProviderQueriesGlobal: bounded(input.maxProviderQueriesGlobal, d.maxProviderQueriesGlobal, 1, d.maxProviderQueriesGlobal),
    maxIdentityResolutionQueries: bounded(input.maxIdentityResolutionQueries,
      d.maxIdentityResolutionQueries, 1, 12),
    maxContextWorkQueries: bounded(input.maxContextWorkQueries, d.maxContextWorkQueries, 0, 12),
    maxTargetEvidenceQueriesGlobal: bounded(input.maxTargetEvidenceQueriesGlobal,
      d.maxTargetEvidenceQueriesGlobal, 1, d.maxProviderQueriesGlobal),
    maxProviderQueriesPerTarget: bounded(input.maxProviderQueriesPerTarget, d.maxProviderQueriesPerTarget, 1, d.maxProviderQueriesPerTarget),
    maxCandidatesPerQuery: bounded(input.maxCandidatesPerQuery, d.maxCandidatesPerQuery, 1, d.maxCandidatesPerQuery),
    maxCandidatesGlobal: bounded(input.maxCandidatesGlobal, d.maxCandidatesGlobal, 1, d.maxCandidatesGlobal),
    maxCandidatesPerTarget: bounded(input.maxCandidatesPerTarget, d.maxCandidatesPerTarget, 1, d.maxCandidatesPerTarget),
    maxSameDomainPerTarget: bounded(input.maxSameDomainPerTarget, d.maxSameDomainPerTarget, 1, d.maxSameDomainPerTarget),
    minNormalizedCandidatesPerTarget: bounded(input.minNormalizedCandidatesPerTarget,
      d.minNormalizedCandidatesPerTarget, 0, 12),
    minNormalizedCandidatesPerTargetLaneFamily: bounded(input.minNormalizedCandidatesPerTargetLaneFamily,
      d.minNormalizedCandidatesPerTargetLaneFamily, 0, 4),
    minContextWorkCandidatesGlobal: bounded(input.minContextWorkCandidatesGlobal,
      d.minContextWorkCandidatesGlobal, 0, 12),
    maxContextWorkCandidatesGlobal: bounded(input.maxContextWorkCandidatesGlobal,
      d.maxContextWorkCandidatesGlobal, 0, 20),
    deadlineMs: bounded(input.deadlineMs, d.deadlineMs, 1_000, d.deadlineMs),
    concurrency: bounded(input.concurrency, d.concurrency, 1, 12),
  });
}

const priority = (lane) => {
  if (lane.queryClass === "identity_resolution") return lane.laneFamily === "exact_identifier" ? 0 : 1;
  if (lane.queryClass === "target_evidence") return 2;
  if (lane.queryClass === "context_work_resolution") return 3;
  return 4;
};
const queryId = (parts) => `er1pq_${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 24)}`;

function fairRequestOrder(requests) {
  const targetRounds = new Map();
  return requests.map((request, index) => {
    const targetRound = request.queryClass === "target_evidence"
      ? targetRounds.get(request.targetId) || 0 : 0;
    if (request.queryClass === "target_evidence") {
      targetRounds.set(request.targetId, targetRound + 1);
    }
    return { request, index, targetRound };
  }).sort((a, b) => a.request.priority - b.request.priority ||
    a.targetRound - b.targetRound || a.index - b.index).map((entry) => entry.request);
}

export function buildProviderQueries(lanePlan, portfolio, inputLimits = {}) {
  const limits = normalizeDiscoveryLimits(inputLimits);
  const allowedTasks = new Set(portfolio.tasks.slice(0, limits.maxTargets).map((task) => task.taskId));
  const grouped = new Map();
  const ordered = [...lanePlan.lanes].sort((a, b) => priority(a) - priority(b));
  for (const lane of ordered) {
    if (lane.taskId && !allowedTasks.has(lane.taskId)) continue;
    const key = [lane.queryClass, lane.taskId || "shared", lane.targetId || "identity",
      lane.query.toLowerCase()].join("|");
    const existing = grouped.get(key);
    if (existing) {
      existing.queryLaneIds.push(lane.laneId);
      if (lane.evidenceRole && !existing.requestedEvidenceRoles.includes(lane.evidenceRole)) {
        existing.requestedEvidenceRoles.push(lane.evidenceRole);
      }
      continue;
    }
    const identityPriority = lane.queryClass === "identity_resolution";
    grouped.set(key, {
      providerQueryId: queryId([key]), query: lane.query, laneType: lane.laneType,
      laneFamily: lane.laneFamily, queryClass: lane.queryClass,
      taskId: lane.taskId, selectedClaimId: lane.selectedClaimId, targetId: lane.targetId,
      identityBundleId: lane.identityBundleId || null,
      relatedTargetIds: lane.relatedTargetIds || [], contextRole: lane.contextRole || null,
      queryLaneIds: [lane.laneId], requestedEvidenceRoles: lane.evidenceRole ? [lane.evidenceRole] : [],
      identityPriority, maxCandidates: limits.maxCandidatesPerQuery,
      onlyProviders: lane.laneFamily === "exact_identifier"
        ? ["pubmed", "crossref", "openalex", "semantic_scholar"] : [],
      priority: priority(lane), status: "planned",
    });
  }
  const perTarget = new Map();
  const classCounts = { identity_resolution: 0, context_work_resolution: 0, target_evidence: 0 };
  const selected = [];
  const deferred = [];
  for (const request of fairRequestOrder([...grouped.values()])) {
    const targetKey = request.targetId || "shared_identity";
    const used = perTarget.get(targetKey) || 0;
    const targetLimit = request.targetId ? limits.maxProviderQueriesPerTarget : limits.maxProviderQueriesGlobal;
    const classLimit = request.queryClass === "identity_resolution" ? limits.maxIdentityResolutionQueries
      : request.queryClass === "context_work_resolution" ? limits.maxContextWorkQueries
        : limits.maxTargetEvidenceQueriesGlobal;
    const classUsed = classCounts[request.queryClass] || 0;
    if (selected.length >= limits.maxProviderQueriesGlobal || used >= targetLimit || classUsed >= classLimit) {
      const deferredReason = classUsed >= classLimit ? `${request.queryClass}_budget`
        : used >= targetLimit ? "per_target_budget" : "global_budget";
      deferred.push({ ...request, status: "deferred_budget", deferredReason });
      continue;
    }
    selected.push(request);
    perTarget.set(targetKey, used + 1);
    classCounts[request.queryClass] = classUsed + 1;
  }
  return { schemaVersion: "er1.providerQueries.v1", limits, selected, deferred,
    selectedCount: selected.length, deferredCount: deferred.length,
    selectedCounts: {
      identityResolutionQueries: classCounts.identity_resolution,
      contextWorkResolutionQueries: classCounts.context_work_resolution,
      targetEvidenceQueries: classCounts.target_evidence,
    } };
}

async function workers(items, concurrency, work) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await work(items[index], index);
    }
  }));
  return results;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("candidate discovery deadline reached");
        error.code = "ER1_DISCOVERY_DEADLINE";
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function executeProviderQueries({ queryPlan, adapter, startedAt = Date.now() }) {
  const events = [];
  let sequence = 0;
  const outcomes = await workers(queryPlan.selected, queryPlan.limits.concurrency, async (request) => {
    const began = Date.now();
    events.push({ sequence: ++sequence, type: "provider_query_started", at: new Date().toISOString(),
      providerQueryId: request.providerQueryId });
    const remainingMs = queryPlan.limits.deadlineMs - (began - startedAt);
    if (remainingMs <= 0) {
      return { request, status: "deferred_budget", elapsedMs: 0, results: [], error: "deadline_reached" };
    }
    try {
      const received = await withTimeout(adapter.search(request), remainingMs);
      const results = received.slice(0, request.maxCandidates);
      events.push({ sequence: ++sequence, type: "provider_query_completed", at: new Date().toISOString(),
        providerQueryId: request.providerQueryId, resultCount: results.length });
      return { request, status: "completed", elapsedMs: Date.now() - began, results,
        discardedByPerQueryCap: Math.max(0, received.length - results.length) };
    } catch (error) {
      const deadline = error?.code === "ER1_DISCOVERY_DEADLINE";
      events.push({ sequence: ++sequence, type: "provider_query_failed", at: new Date().toISOString(),
        providerQueryId: request.providerQueryId });
      return { request, status: deadline ? "deferred_budget" : "provider_error",
        elapsedMs: Date.now() - began, results: [],
        error: deadline ? "deadline_reached" : String(error?.message || error).slice(0, 500) };
    }
  });
  return { outcomes, events, elapsedMs: Date.now() - startedAt,
    providerQueryCount: outcomes.filter((x) => x.status !== "deferred_budget").length };
}
