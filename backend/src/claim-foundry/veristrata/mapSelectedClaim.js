const ROLES = Object.freeze({ thesis: "thesis", pillar: "pillar",
  pillar_support: "pillar_support", opponent_claim: "evidence",
  qualification: "evidence", consistency_hinge: "fallibility_critical" });
const STANCES = Object.freeze({ normal: "endorses", invert: "opposes", none: "reports" });

export function normalizeClaimLookupText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function mapCf1SelectedClaim(selected, { packageId, bindingId, order }) {
  return {
    claimText: selected.claimText,
    lookupText: normalizeClaimLookupText(selected.claimText),
    link: {
      packageId, bindingId, selectedClaimId: selected.selectedClaimId,
      relationshipType: "task", claimRole: ROLES[selected.articleRole], claimOrder: order,
      scoreTransform: selected.scoreTransform, articleStance: STANCES[selected.scoreTransform],
      argumentFunction: selected.articleRole, searchEligible: selected.searchEligible ? 1 : 0,
      verdictEligible: selected.verdictEligible ? 1 : 0, confidence: selected.confidence,
      rationale: JSON.stringify({ packageId, selectedClaimId: selected.selectedClaimId,
        sourceRawAssertionIds: selected.sourceRawAssertionIds, sourceBlockIds: selected.sourceBlockIds,
        selectionRationale: selected.selectionRationale, materiality: selected.materiality,
        relatedPillarIds: selected.relatedPillarIds }),
    },
  };
}
