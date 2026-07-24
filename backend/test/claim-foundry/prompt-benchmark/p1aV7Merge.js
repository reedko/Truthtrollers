const normalizedText = (value) => String(value ?? "").toLowerCase()
  .normalize("NFKC").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();

const orderedUnique = (values) => [...new Set(values.filter(Boolean))];

export function mergeP1aV7Assertions(chunkAssertions = []) {
  const groups = new Map();
  for (const assertion of chunkAssertions) {
    const key = normalizedText(assertion.assertionText);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(assertion);
  }
  const mergedAssertions = [];
  const duplicateGroups = [];
  for (const assertions of groups.values()) {
    const representative = assertions[0];
    const merged = {
      ...representative,
      candidateId: `P1aV7-M${String(mergedAssertions.length + 1).padStart(3, "0")}`,
      sourceCandidateIds: assertions.map((item) => item.candidateId),
      sourceChunkIds: orderedUnique(assertions.map((item) => item.chunkId)),
      sourceUnitIds: orderedUnique(assertions.flatMap((item) => item.sourceUnitIds ?? [])),
      relatedPillarLabels: orderedUnique(assertions.flatMap((item) =>
        item.relatedPillarLabels ?? [])),
    };
    mergedAssertions.push(merged);
    if (assertions.length > 1) duplicateGroups.push({
      normalization: "case_punctuation_whitespace",
      retainedCandidateId: merged.candidateId,
      sourceCandidateIds: merged.sourceCandidateIds,
      sourceChunkIds: merged.sourceChunkIds,
      assertionText: merged.assertionText,
    });
  }
  return { mergedAssertions, duplicateGroups,
    summary: { rawCount: chunkAssertions.length, mergedCount: mergedAssertions.length,
      collapsedExactDuplicates: chunkAssertions.length - mergedAssertions.length } };
}

export function orientationConsistencyDiagnostic({ orientation, assertions = [] } = {}) {
  const pillarCounts = Object.fromEntries((orientation?.pillars ?? [])
    .map((pillar) => [pillar.label, 0]));
  const unlinkedAssertions = [];
  for (const assertion of assertions) {
    const labels = assertion.relatedPillarLabels ?? [];
    if (!labels.length) unlinkedAssertions.push({ candidateId: assertion.candidateId,
      assertionText: assertion.assertionText, sourceUnitIds: assertion.sourceUnitIds });
    for (const label of labels) if (Object.hasOwn(pillarCounts, label)) pillarCounts[label] += 1;
  }
  return {
    pillarCounts,
    uncoveredPillars: Object.entries(pillarCounts).filter(([, count]) => count === 0)
      .map(([label]) => label),
    unlinkedCount: unlinkedAssertions.length,
    unlinkedAssertions,
    note: "Deterministic diagnostic only; it does not revise orientation or assertions.",
  };
}

export function articleRegionCounts(assertions = [], sourceUnits = []) {
  const order = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const assertion of assertions) {
    const first = Math.min(...(assertion.sourceUnitIds ?? []).map((id) =>
      order.get(id) ?? Number.MAX_SAFE_INTEGER));
    const region = Number.isFinite(first) && sourceUnits.length
      ? Math.min(3, Math.floor((first / sourceUnits.length) * 4)) : 0;
    counts[region] += 1;
  }
  return counts;
}
