// Benchmark-only semantic selector. Article-region coverage is diagnostic only:
// selection covers post-extraction pillars, then reserves room for strong assertions
// that O-post did not force into a pillar. No fixture/topic vocabulary is used.
import { analyzeBalancedCandidateV1 }
  from "./balancedCandidateSelectorV1.js";

const importanceRank = { load_bearing: 0, major: 1, supporting: 2 };

export function selectPillarBalancedCandidatesV1({ candidateClaims = [], sourceUnits = [],
  pillars = [], assignments = [], maximum = 16, unlinkedReserve = 2,
  minimumScore = 6 } = {}) {
  const order = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const sourceUnitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const validLabels = new Set(pillars.map((pillar) => pillar.label));
  const assignmentById = new Map(assignments.map((item) => [item.candidateId,
    (item.relatedPillarLabels ?? []).filter((label) => validLabels.has(label))]));
  const items = candidateClaims.filter((claim) => claim.sourceUnitIds?.length)
    .map((claim, index) => {
      const first = Math.min(...claim.sourceUnitIds.map((id) =>
        order.get(id) ?? Number.MAX_SAFE_INTEGER));
      const region = sourceUnits.length && Number.isFinite(first)
        ? Math.min(3, Math.floor((first / sourceUnits.length) * 4)) : 0;
      const relatedPillarLabels = assignmentById.get(claim.candidateId) ?? [];
      return { claim: { ...claim, relatedPillarLabels }, index, first, region,
        relatedPillarLabels,
        ...analyzeBalancedCandidateV1(claim, sourceUnits, sourceUnitsById, first) };
    });
  const eligible = items.filter((item) => item.score >= minimumScore
    && !item.signals.includes("presentation_or_intent_claim")
    && !item.signals.includes("audience_characterization"));
  const quality = (a, b) => b.score - a.score || a.index - b.index;
  const orderedPillars = [...pillars].sort((a, b) =>
    (importanceRank[a.importance] ?? 3) - (importanceRank[b.importance] ?? 3));
  const selected = [];
  const selectedIndexes = new Set();
  const add = (item, reason) => {
    if (!item || selectedIndexes.has(item.index) || selected.length >= maximum) return false;
    selected.push({ ...item, reason });
    selectedIndexes.add(item.index);
    return true;
  };
  const forPillar = (label) => eligible.filter((item) =>
    item.relatedPillarLabels.includes(label)).sort(quality);

  // Establish coverage before depth.
  for (const pillar of orderedPillars.filter((item) => item.importance !== "supporting")) {
    add(forPillar(pillar.label)[0], `pillar_coverage:${pillar.label}`);
  }
  for (const pillar of orderedPillars.filter((item) => item.importance === "supporting")) {
    add(forPillar(pillar.label)[0], `pillar_coverage:${pillar.label}`);
  }

  // Empty assignment is a valid O-post judgment, not a discard instruction.
  const unlinked = eligible.filter((item) => !item.relatedPillarLabels.length).sort(quality);
  for (const item of unlinked.slice(0, Math.max(0, unlinkedReserve))) {
    add(item, "unlinked_reserve");
  }

  const linkedBudget = Math.max(1, maximum - Math.min(unlinkedReserve, unlinked.length));
  const activePillars = orderedPillars.filter((pillar) => forPillar(pillar.label).length);
  const perPillarCeiling = activePillars.length
    ? Math.max(1, Math.ceil(linkedBudget / activePillars.length)) : 0;
  let changed = true;
  while (changed && selected.length < maximum) {
    changed = false;
    for (const pillar of activePillars) {
      const currentCount = selected.filter((item) =>
        item.relatedPillarLabels.includes(pillar.label)).length;
      if (currentCount >= perPillarCeiling) continue;
      const next = forPillar(pillar.label).find((item) => !selectedIndexes.has(item.index));
      if (add(next, `pillar_round_robin:${pillar.label}`)) changed = true;
      if (selected.length >= maximum) break;
    }
  }
  for (const item of eligible.filter((item) => item.relatedPillarLabels.length).sort(quality)) {
    add(item, "linked_global_quality");
  }
  for (const item of unlinked) add(item, "unlinked_quality_fill");

  const pillarCounts = Object.fromEntries(pillars.map((pillar) => [pillar.label,
    selected.filter((item) => item.relatedPillarLabels.includes(pillar.label)).length]));
  const selectedRegionCounts = Object.fromEntries([0, 1, 2, 3].map((region) => [region,
    selected.filter((item) => item.region === region).length]));
  return {
    selectedClaims: selected.map((item) => item.claim),
    selected: selected.map(({ claim, ...item }) => ({ ...item,
      candidateId: claim.candidateId, claimText: claim.claimText,
      sourceUnitIds: claim.sourceUnitIds })),
    deferred: items.filter((item) => !selectedIndexes.has(item.index)).map((item) => ({
      candidateId: item.claim.candidateId, claimText: item.claim.claimText,
      reason: item.score < minimumScore ? "below_quality_floor"
        : item.signals.includes("presentation_or_intent_claim")
          || item.signals.includes("audience_characterization")
          ? "nonclaim_exclusion" : "pillar_balanced_budget",
    })),
    diagnostics: { candidateCount: items.length, eligibleCount: eligible.length,
      selectedCount: selected.length, minimumScore, unlinkedReserve,
      unlinkedEligibleCount: unlinked.length,
      unlinkedSelectedCount: selected.filter((item) =>
        !item.relatedPillarLabels.length).length,
      perPillarCeiling, pillarCounts, selectedRegionCounts,
      note: "Article regions are reported but do not impose selection quotas." },
  };
}
