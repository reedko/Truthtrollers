import { articleStanceForScoreTransform } from "../claimPosture.js";

const ROLES = Object.freeze({ thesis: "thesis", pillar: "pillar",
  pillar_support: "pillar_support", opponent_claim: "evidence",
  qualification: "evidence", consistency_hinge: "fallibility_critical" });

export function normalizeClaimLookupText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function mapCf1SelectedClaim(selected, { packageId, bindingId, order, thesisHinge = null }) {
  return {
    claimText: selected.claimText,
    lookupText: normalizeClaimLookupText(selected.claimText),
    link: {
      packageId, bindingId, selectedClaimId: selected.selectedClaimId,
      relationshipType: "task", claimRole: ROLES[selected.articleRole], claimOrder: order,
      scoreTransform: selected.scoreTransform,
      articleStance: articleStanceForScoreTransform(selected.scoreTransform),
      argumentFunction: selected.articleRole, searchEligible: selected.searchEligible ? 1 : 0,
      verdictEligible: selected.verdictEligible ? 1 : 0, confidence: selected.confidence,
      // Queryable hinge dimension (Step 3b); null-by-design for baseline packages.
      cf1GradeTarget: selected.gradeTarget ?? null, cf1ThesisHinge: thesisHinge,
      rationale: JSON.stringify({ packageId, selectedClaimId: selected.selectedClaimId,
        sourceRawAssertionIds: selected.sourceRawAssertionIds, sourceBlockIds: selected.sourceBlockIds,
        selectionRationale: selected.selectionRationale, materiality: selected.materiality,
        origin: selected.origin ?? "model",
        relatedPillarIds: selected.relatedPillarIds }),
    },
  };
}
