// Observation-only comparison between the deterministic attribution-surface
// census and Call 1A's raw discovery inventory. No model call, no recovery,
// and no mutation of candidates. A match is intentionally conservative: the
// census unit must occur in a 1A candidate's grounded source units.
const diagnosticCandidateId = (index) => `1A-${String(index + 1).padStart(3, "0")}`;

export function buildSplitCensusDiagnostic({ censusItems = [], candidateClaims = [] } = {}) {
  const items = censusItems.map((item) => {
    const matchIndex = candidateClaims.findIndex((claim) =>
      (claim.sourceUnitIds ?? []).some((id) => item.sourceUnitIds?.includes(id)));
    const matched = matchIndex >= 0;
    const candidate = matched ? candidateClaims[matchIndex] : null;
    return {
      censusId: item.censusId,
      sourceUnitIds: item.sourceUnitIds ?? [],
      trigger: item.kind ?? "unknown",
      signals: item.signals ?? [],
      snippet: item.text ?? "",
      assessment: matched ? "apparently_covered_by_call1a" : "no_obvious_call1a_match",
      match: candidate ? {
        candidateId: diagnosticCandidateId(matchIndex),
        claimText: candidate.claimText,
        reason: "shares a grounded source unit with the Call 1A candidate",
      } : null,
    };
  });
  const byTrigger = {};
  for (const item of items) byTrigger[item.trigger] = (byTrigger[item.trigger] ?? 0) + 1;
  const apparentMatchCount = items.filter((item) => item.match).length;
  return {
    status: "available",
    packets: censusItems,
    items,
    summary: {
      totalPackets: items.length,
      byTrigger,
      apparentMatchCount,
      noObviousMatchCount: items.length - apparentMatchCount,
      notEvaluatedCount: 0,
    },
  };
}

export function unavailableSplitCensusDiagnostic(error) {
  return {
    status: "unavailable",
    error: String(error?.message ?? error ?? "census diagnostic unavailable"),
    packets: [], items: [],
    summary: { totalPackets: 0, byTrigger: {}, apparentMatchCount: 0,
      noObviousMatchCount: 0, notEvaluatedCount: 0 },
  };
}
