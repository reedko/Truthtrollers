// Deterministic construction of the Call 2 context: exactly which source units,
// selected claims, critic instructions, and named works reach selected-claim
// enrichment. Shared by the live agent path and the prompt-benchmark packet
// materialization/replay so the two can never drift.
export function buildSelectedEnrichmentContext({ inventory, orientation, critic, sourceUnits }) {
  const allowedIds = new Set(critic.selectedClaims.flatMap((claim) => claim.sourceUnitIds));
  for (const id of [...inventory.theme.sourceUnitIds, ...inventory.thesis.sourceUnitIds,
    ...inventory.pillars.filter((pillar) => pillar.importance !== "supporting")
      .flatMap((pillar) => pillar.sourceUnitIds)]) allowedIds.add(id);
  for (const label of critic.uncoveredPillarLabels) {
    const pillar = inventory.pillars.find((item) => item.label === label);
    for (const id of pillar?.sourceUnitIds ?? []) allowedIds.add(id);
  }
  return {
    orientation,
    selectedClaims: critic.selectedClaims,
    criticReport: critic,
    sourceUnits: sourceUnits.filter((unit) => allowedIds.has(unit.unitId)),
    namedWorkPool: inventory.namedWorks,
  };
}
