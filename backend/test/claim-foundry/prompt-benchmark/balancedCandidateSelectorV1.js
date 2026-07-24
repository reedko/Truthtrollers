// Benchmark-only materiality-free selector. It balances model-proposed pillars
// and four article regions, then ranks with generic evidence-testability signals.
// It contains no fixture/topic vocabulary and is not wired into the live path.
import { detectSplitAtomicRepairSignals }
  from "../../../src/claim-foundry/splitAtomicRepair.js";
import { semanticOverlap, semanticWords }
  from "../../../src/claim-foundry/semanticGrounding.js";

export function analyzeBalancedCandidateV1(claim, sourceUnits, sourceUnitsById, first) {
  const sourceText = (claim.sourceUnitIds ?? []).map((id) => sourceUnitsById.get(id)?.text)
    .filter(Boolean).join(" ");
  const localText = sourceUnits.slice(Math.max(0, first - 3),
    Math.min(sourceUnits.length, first + 4)).map((unit) => unit.text).join(" ");
  const signals = detectSplitAtomicRepairSignals({ claim, sourceUnitsById }).signals;
  const words = semanticWords(claim.claimText).size || 1;
  const exactRatio = semanticOverlap(claim.claimText, sourceText) / words;
  const localRatio = semanticOverlap(claim.claimText, localText) / words;
  const text = `${claim.claimText} ${sourceText}`;
  const numericOrComparison = /\b\d[\d,.]*(?:%|\b)|\b(?:percent|times|more|less|higher|lower|increase|decrease|rate|ratio|compared|versus)\b/i.test(text);
  const evidenceAnchor = /\b(?:study|analysis|report|review|trial|survey|database|dataset|data|record|document|law|act|statute|regulation|package insert|meta-analysis|classified|announced)\b/i.test(text);
  const concretePredicate = /\b(?:found|showed|reported|measured|increased|decreased|removed|contains?|caused|linked|tested|funded|classified|banned|required|ordered|released|manipulated)\b/i.test(claim.claimText);
  const genericAllegation = /\b(?:accused of|concerns?|narrative|awareness|comes at a time|attempts? to|aims? to|intends? to)\b/i.test(claim.claimText);
  let score = Math.min(4, Math.round(Math.max(exactRatio, localRatio) * 4));
  if (numericOrComparison) score += 3;
  if (evidenceAnchor) score += 3;
  if (concretePredicate) score += 2;
  if (genericAllegation) score -= 3;
  if (signals.includes("possible_multiple_assertions")) score -= 3;
  if (signals.includes("presentation_or_intent_claim")) score -= 8;
  if (signals.includes("audience_characterization")) score -= 6;
  if (signals.includes("weak_claim_to_grounding_overlap") && localRatio < 0.4) score -= 5;
  if (signals.includes("grounded_only_in_short_label") && localRatio < 0.4) score -= 4;
  return { score, exactRatio, localRatio, signals };
}

export function selectBalancedCandidatesV1({ candidateClaims = [], sourceUnits = [],
  maximum = 16, minimumScore = Number.NEGATIVE_INFINITY,
  fillBelowMinimum = true } = {}) {
  const order = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const sourceUnitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const items = candidateClaims.filter((claim) => claim.sourceUnitIds?.length)
    .map((claim, index) => {
      const first = Math.min(...claim.sourceUnitIds.map((id) =>
        order.get(id) ?? Number.MAX_SAFE_INTEGER));
      const region = sourceUnits.length && Number.isFinite(first)
        ? Math.min(3, Math.floor((first / sourceUnits.length) * 4)) : 0;
      return { claim, index, first, region,
        ...analyzeBalancedCandidateV1(claim, sourceUnits, sourceUnitsById, first) };
    });
  const structurallyEligible = items.filter((item) =>
    !item.signals.includes("presentation_or_intent_claim")
    && !item.signals.includes("audience_characterization"));
  const eligible = structurallyEligible.filter((item) => item.score >= minimumScore);
  const quality = (a, b) => b.score - a.score || a.first - b.first || a.index - b.index;
  const selected = []; const selectedIndexes = new Set();
  const add = (item, reason) => {
    if (!item || selectedIndexes.has(item.index) || selected.length >= maximum) return false;
    selected.push({ ...item, reason }); selectedIndexes.add(item.index); return true;
  };
  const pillars = [...new Set(eligible.flatMap((item) =>
    item.claim.relatedPillarLabels ?? []))];
  for (const pillar of pillars) add(eligible.filter((item) =>
    item.claim.relatedPillarLabels?.includes(pillar)).sort(quality)[0], "pillar_best");
  const quota = Math.max(1, Math.floor(maximum / 4));
  for (let region = 0; region < 4; region += 1) {
    let count = selected.filter((item) => item.region === region).length;
    for (const item of eligible.filter((entry) => entry.region === region).sort(quality)) {
      if (count >= quota || selected.length >= maximum) break;
      if (add(item, "region_quota")) count += 1;
    }
  }
  for (const item of [...eligible].sort(quality)) add(item, "global_quality");
  if (fillBelowMinimum) {
    for (const item of [...items].sort(quality)) add(item, "fallback_only");
  }
  return { selectedClaims: selected.map((item) => item.claim),
    selected: selected.map(({ claim, ...item }) => ({ ...item, claimText: claim.claimText,
      sourceUnitIds: claim.sourceUnitIds, relatedPillarLabels: claim.relatedPillarLabels })),
    deferred: items.filter((item) => !selectedIndexes.has(item.index)).map((item) =>
      ({ index: item.index, claimText: item.claim.claimText,
        reason: item.signals.includes("presentation_or_intent_claim")
          || item.signals.includes("audience_characterization")
          ? "nonclaim_exclusion" : item.score < minimumScore
            ? "below_quality_floor" : "balanced_budget" })),
    diagnostics: { candidateCount: items.length, selectedCount: selected.length,
      minimumScore: Number.isFinite(minimumScore) ? minimumScore : null,
      belowQualityFloorCount: structurallyEligible.filter((item) =>
        item.score < minimumScore).length,
      regionCounts: Object.fromEntries([0, 1, 2, 3].map((region) =>
        [region, selected.filter((item) => item.region === region).length])),
      averageScore: selected.reduce((sum, item) => sum + item.score, 0)
        / Math.max(1, selected.length) } };
}
