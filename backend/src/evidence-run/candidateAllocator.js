import { candidateDomain } from "./sourceIdentity.js";

const unique = (values) => [...new Set((values || []).filter(Boolean))];
const byScore = (a, b) => b.retrievalPromiseScore - a.retrievalPromiseScore || a.rank - b.rank;
const routeFamilies = (candidate, targetId = null) => unique(candidate.routeProvenance
  .filter((route) => !targetId || route.targetId === targetId)
  .map((route) => route.laneFamily));
const isContext = (candidate) => candidate.routeProvenance
  .some((route) => route.queryClass === "context_work_resolution");
const isIdentity = (candidate) => candidate.routeProvenance
  .some((route) => route.queryClass === "identity_resolution");

export function allocateCandidatesFairly(candidates, limits) {
  const ordered = [...candidates].sort(byScore);
  const eligible = ordered.filter((x) => x.preFetchStatus !== "rejected_pre_fetch" &&
    x.preFetchStatus !== "unresolved_identity");
  const selected = [];
  const selectedIds = new Set();
  const targetCounts = new Map();
  const domainCounts = new Map();
  let contextCount = 0;

  function canAdd(candidate) {
    if (selectedIds.has(candidate.candidateId) || selected.length >= limits.maxCandidatesGlobal) return false;
    if (isContext(candidate) && !candidate.targetIds.length &&
      contextCount >= limits.maxContextWorkCandidatesGlobal) return false;
    const domain = candidateDomain(candidate);
    return candidate.targetIds.every((targetId) =>
      (targetCounts.get(targetId) || 0) < limits.maxCandidatesPerTarget &&
      (!domain || (domainCounts.get(`${targetId}:${domain}`) || 0) < limits.maxSameDomainPerTarget));
  }

  function add(candidate, reason) {
    if (!canAdd(candidate)) return false;
    selected.push(candidate); selectedIds.add(candidate.candidateId);
    if (isContext(candidate)) contextCount += 1;
    const domain = candidateDomain(candidate);
    for (const targetId of candidate.targetIds) {
      targetCounts.set(targetId, (targetCounts.get(targetId) || 0) + 1);
      if (domain) domainCounts.set(`${targetId}:${domain}`,
        (domainCounts.get(`${targetId}:${domain}`) || 0) + 1);
    }
    allocationAudit.push({ candidateId: candidate.candidateId, reason });
    return true;
  }

  const allocationAudit = [];
  for (const candidate of eligible.filter(isIdentity).slice(0, 2)) add(candidate, "identity_reserve");

  const context = eligible.filter(isContext);
  for (const candidate of context) {
    if (contextCount >= limits.minContextWorkCandidatesGlobal) break;
    add(candidate, "context_reserve");
  }

  const targetIds = unique(eligible.flatMap((x) => x.targetIds)).sort();
  const targetFamilies = new Map();
  for (const targetId of targetIds) {
    targetFamilies.set(targetId, unique(eligible.filter((x) => x.targetIds.includes(targetId))
      .flatMap((x) => routeFamilies(x, targetId))).sort());
  }
  for (let slot = 0; slot < limits.minNormalizedCandidatesPerTargetLaneFamily; slot += 1) {
    for (const targetId of targetIds) for (const family of targetFamilies.get(targetId)) {
      const already = selected.filter((x) => x.targetIds.includes(targetId) &&
        routeFamilies(x, targetId).includes(family)).length;
      if (already > slot) continue;
      const candidate = eligible.find((x) => x.targetIds.includes(targetId) &&
        routeFamilies(x, targetId).includes(family) && canAdd(x));
      if (candidate) add(candidate, `target_lane_reserve:${targetId}:${family}`);
    }
  }

  for (let slot = 0; slot < limits.minNormalizedCandidatesPerTarget; slot += 1) {
    for (const targetId of targetIds) {
      if ((targetCounts.get(targetId) || 0) > slot) continue;
      const candidate = eligible.find((x) => x.targetIds.includes(targetId) && canAdd(x));
      if (candidate) add(candidate, `target_reserve:${targetId}`);
    }
  }

  for (const candidate of eligible) add(candidate, "score_fill");
  const capReached = selected.length >= limits.maxCandidatesGlobal;
  const weak = ordered.filter((x) => !eligible.includes(x));
  const unselectedEligible = eligible.filter((x) => !selectedIds.has(x.candidateId));
  return {
    candidates: selected.sort(byScore),
    audit: allocationAudit,
    diagnostics: {
      schemaVersion: "er1.candidateAllocation.v1", inputDedupedCount: candidates.length,
      eligibleCount: eligible.length, allocatedCount: selected.length,
      discardedByWeakPreFetchFit: weak.length,
      discardedByGlobalCap: capReached ? unselectedEligible.length : 0,
      discardedByAllocationLimits: capReached ? 0 : unselectedEligible.length,
      globalCap: limits.maxCandidatesGlobal, globalCapApplied: capReached,
      globalCapAppliedAfterFairAllocation: true, contextCandidateCount: context.length,
      allocatedContextCount: selected.filter(isContext).length,
      targetCounts: Object.fromEntries(targetIds.map((id) => [id, targetCounts.get(id) || 0])),
      targetsWithCandidatesButZeroAllocated: targetIds.filter((id) => !targetCounts.get(id)),
      routeProvenancePreserved: selected.every((x) => x.routeProvenance.length > 0),
    },
    discarded: [...weak, ...unselectedEligible].map((x) => ({ candidateId: x.candidateId,
      status: x.preFetchStatus, reasons: x.retrievalPromiseReasons })),
  };
}
