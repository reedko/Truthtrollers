const rank = { high: 3, medium: 2, low: 1 };
const key = (claim) => `${String(claim.claimText).toLowerCase().replace(/\W+/g, " ").trim()}|${(claim.sourceUnitIds ?? []).join(",")}|${(claim.attributionContextUnitIds ?? []).join(",")}`;

export function selectSplitCandidates({ candidateClaims = [], sourceUnits = [], budget }) {
  const order = new Map(sourceUnits.map((u, index) => [u.unitId, index]));
  const max = budget.call1bCandidateMaximum;
  const seen = new Set(); const pool = [];
  const deferred = [];
  for (let index = 0; index < candidateClaims.length; index += 1) {
    const claim = candidateClaims[index]; const k = key(claim);
    if (!claim.sourceUnitIds?.length) { deferred.push({ index, claimText: claim.claimText, reason: "ungrounded" }); continue; }
    if (seen.has(k)) { deferred.push({ index, claimText: claim.claimText, reason: "same_text_same_span_duplicate" }); continue; }
    seen.add(k);
    const first = Math.min(...claim.sourceUnitIds.map((id) => order.get(id) ?? Number.MAX_SAFE_INTEGER));
    pool.push({ claim, index, first, region: sourceUnits.length ? Math.min(2, Math.floor((first / sourceUnits.length) * 3)) : 0 });
  }
  const sorted = [...pool].sort((a, b) => (rank[b.claim.materiality] ?? 0) - (rank[a.claim.materiality] ?? 0) || a.first - b.first || a.index - b.index);
  const selected = []; const reasons = new Map(); const pillars = new Set(); const regions = new Set();
  for (const item of sorted) {
    if (selected.length >= max) break;
    const newPillar = (item.claim.relatedPillarLabels ?? []).some((p) => !pillars.has(p));
    const newRegion = !regions.has(item.region);
    if (newPillar || newRegion) { selected.push(item); reasons.set(item.index, newPillar ? "pillar_coverage" : "source_region_coverage"); (item.claim.relatedPillarLabels ?? []).forEach((p) => pillars.add(p)); regions.add(item.region); }
  }
  for (const item of sorted) if (selected.length < max && !selected.includes(item)) { selected.push(item); reasons.set(item.index, "materiality_then_source_order"); (item.claim.relatedPillarLabels ?? []).forEach((p) => pillars.add(p)); regions.add(item.region); }
  const selectedIndexes = new Set(selected.map((x) => x.index));
  for (const item of pool) if (!selectedIndexes.has(item.index)) deferred.push({ index: item.index, claimText: item.claim.claimText, reason: "call1b_budget" });
  const coverage = { sourceRegionsRepresented: [...regions].sort(), sourceRegionCount: regions.size, candidateCount: candidateClaims.length, selectedCount: selected.length,
    complete: regions.size >= Math.min(3, new Set(pool.map((x) => x.region)).size) };
  return { selectedClaims: selected.sort((a, b) => a.index - b.index).map((x) => x.claim), selected: selected.map((x) => ({ index: x.index, claimText: x.claim.claimText, reason: reasons.get(x.index), region: x.region })), deferred, coverage };
}
