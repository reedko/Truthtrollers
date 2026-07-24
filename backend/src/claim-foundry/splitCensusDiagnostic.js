// Observation-only comparison between the deterministic passage census and Call
// 1A's raw discovery inventory. This module never calls a model, manufactures a
// claim, mutates the candidate set, or throws into the extraction critical path.
import { semanticOverlap, semanticWords } from "./semanticGrounding.js";

const diagnosticCandidateId = (index) => `1A-${String(index + 1).padStart(3, "0")}`;

function matchScore(item, claim) {
  const sharesUnit = (claim.sourceUnitIds ?? []).some((id) => item.sourceUnitIds?.includes(id));
  if (!sharesUnit) return null;
  const overlap = semanticOverlap(item.text, claim.claimText);
  const smaller = Math.min(semanticWords(item.text).size, semanticWords(claim.claimText).size);
  const ratio = smaller ? overlap / smaller : 0;
  // Shared grounding alone is insufficient: a source unit can contain several
  // different propositions. Require actual lexical-semantic correspondence.
  if (overlap < Math.min(3, Math.max(2, smaller)) || ratio < 0.45) return null;
  return { overlap, ratio };
}

export function buildSplitCensusDiagnostic({ censusItems = [], candidateClaims = [],
  structuralBlocks = [] } = {}) {
  const items = censusItems.map((item) => {
    const recoveryEligible = item.recoveryEligible !== false;
    const matches = candidateClaims.map((claim, index) => ({ claim, index,
      score: matchScore(item, claim) })).filter((entry) => entry.score)
      .sort((a, b) => b.score.ratio - a.score.ratio || b.score.overlap - a.score.overlap);
    const best = matches[0] ?? null;
    const assessment = best ? "apparently_covered_by_call1a"
      : recoveryEligible ? "no_obvious_call1a_match"
        : "probably_not_a_standalone_claim";
    return {
      censusId: item.censusId,
      semanticChunkId: item.semanticChunkId ?? null,
      sourceUnitIds: item.sourceUnitIds ?? [],
      contextUnitIds: item.contextUnitIds ?? [],
      trigger: item.kind ?? "unknown",
      signals: item.signals ?? [],
      snippet: item.text ?? "",
      contextText: item.contextText ?? "",
      recoveryEligible,
      assessment,
      match: best ? {
        candidateId: diagnosticCandidateId(best.index),
        claimText: best.claim.claimText,
        reason: `shared grounding with semantic overlap ${best.score.overlap} (${best.score.ratio.toFixed(2)} of the smaller text)`,
      } : null,
    };
  });
  const byTrigger = {};
  for (const item of items) byTrigger[item.trigger] = (byTrigger[item.trigger] ?? 0) + 1;
  const apparentMatchCount = items.filter((item) => item.match).length;
  const noObviousMatchCount = items.filter((item) =>
    item.assessment === "no_obvious_call1a_match").length;
  const probablyNotStandaloneCount = items.filter((item) =>
    item.assessment === "probably_not_a_standalone_claim").length;
  const chunksWithPackets = new Set(items.map((item) => item.semanticChunkId).filter(Boolean));
  return {
    status: "available",
    packets: censusItems,
    items,
    summary: {
      totalPackets: items.length,
      recoveryEligiblePackets: items.filter((item) => item.recoveryEligible).length,
      semanticChunksScanned: structuralBlocks.length || chunksWithPackets.size,
      semanticChunksWithPackets: chunksWithPackets.size,
      semanticChunksWithoutPackets: Math.max(0,
        (structuralBlocks.length || chunksWithPackets.size) - chunksWithPackets.size),
      byTrigger,
      apparentMatchCount,
      noObviousMatchCount,
      probablyNotStandaloneCount,
      notEvaluatedCount: 0,
    },
  };
}

export function unavailableSplitCensusDiagnostic(error) {
  return {
    status: "unavailable",
    error: String(error?.message ?? error ?? "census diagnostic unavailable"),
    packets: [], items: [],
    summary: { totalPackets: 0, recoveryEligiblePackets: 0,
      semanticChunksScanned: 0, semanticChunksWithPackets: 0,
      semanticChunksWithoutPackets: 0, byTrigger: {}, apparentMatchCount: 0,
      noObviousMatchCount: 0, probablyNotStandaloneCount: 0,
      notEvaluatedCount: 0 },
  };
}
