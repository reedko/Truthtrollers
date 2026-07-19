// Deterministically preserves separately attributed occurrences of propositions
// already discovered by 1A. It never creates a new proposition: a clone must have
// strong lexical overlap with the existing claim and an explicit source candidate
// in the matching article unit. Final source judgment remains 1B's job.
import { semanticOverlap, semanticWords } from "./semanticGrounding.js";
import { detectSplitSourceCandidates } from "./splitSourceCandidates.js";

const sameIds = (a = [], b = []) => a.length === b.length && a.every((id, i) => id === b[i]);

export function expandSplitAttributedOccurrences({ candidateClaims = [], sourceUnits = [],
  maxPerClaim = 2, maxTotal = 8 } = {}) {
  const expanded = [...candidateClaims]; const additions = [];
  for (let index = 0; index < candidateClaims.length && additions.length < maxTotal; index += 1) {
    const claim = candidateClaims[index];
    const claimWordCount = semanticWords(claim.claimText).size || 1;
    const matches = [];
    for (const unit of sourceUnits) {
      if ((claim.sourceUnitIds ?? []).includes(unit.unitId)) continue;
      const overlap = semanticOverlap(claim.claimText, unit.text);
      const denominator = Math.min(claimWordCount, semanticWords(unit.text).size) || 1;
      if (overlap < 4 || overlap / denominator < 0.55) continue;
      const diagnostic = detectSplitSourceCandidates({
        claimUnits: [{ unitId: unit.unitId, text: unit.text }],
      });
      if (diagnostic.sourceCandidateStatus !== "candidates_found") continue;
      matches.push({ unit, overlap, ratio: overlap / denominator, diagnostic });
    }
    matches.sort((a, b) => b.ratio - a.ratio || b.overlap - a.overlap || a.unit.order - b.unit.order);
    for (const match of matches.slice(0, maxPerClaim)) {
      if (expanded.some((item) => item.claimText === claim.claimText
        && sameIds(item.sourceUnitIds, [match.unit.unitId]))) continue;
      const clone = { ...claim, sourceUnitIds: [match.unit.unitId],
        attributionContextUnitIds: [match.unit.unitId], groundingSpan: "clustered",
        _occurrenceDerived: { fromCandidateIndex: index, matchedUnitId: match.unit.unitId,
          overlap: match.overlap, ratio: Number(match.ratio.toFixed(3)),
          sourceCandidates: match.diagnostic.sourceCandidates } };
      expanded.push(clone);
      additions.push({ fromCandidateIndex: index, claimText: claim.claimText,
        originalSourceUnitIds: claim.sourceUnitIds ?? [], matchedUnitId: match.unit.unitId,
        overlap: match.overlap, ratio: Number(match.ratio.toFixed(3)),
        sourceCandidates: match.diagnostic.sourceCandidates });
      if (additions.length >= maxTotal) break;
    }
  }
  return { candidateClaims: expanded, additions,
    originalCount: candidateClaims.length, expandedCount: expanded.length };
}
