// CF5 minimal vertical slice — deterministic validation. Hard checks only, per
// CF5_ARCHITECTURE_MIGRATION_PLAN_2026-07-26_v3.md §4/§6: nothing here evaluates
// truth, materiality, stance correctness, provenance correctness, semantic atomicity,
// thesis bearing, causal validity, or semantic (differently-worded) duplication.
// Those belong in the defect catalog, not brittle deterministic rules.

const ARTICLE_TREATMENTS = new Set(["adopted", "challenged", "reported"]);

function normalizeClaimText(text) {
  return String(text ?? "").toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter(Boolean).join(" ");
}

// Exact normalized duplicates are dropped deterministically (host action, no repair
// call needed — there is nothing for a model to "fix"). Everything else that fails is
// a hard structural failure eligible for the one allowed repair pass.
export function validateClaims(rawClaims, knownUnitIds) {
  const findings = [];
  const seenClaimIds = new Map();
  const seenNormalized = new Set();
  const claims = [];
  const hardFailureClaimIds = new Set();

  for (const claim of rawClaims) {
    const errors = [];

    if (!claim || typeof claim !== "object") {
      findings.push({ code: "CF5_MALFORMED_CLAIM", claim });
      continue;
    }

    const claimId = typeof claim.claimId === "string" ? claim.claimId : null;
    if (!claimId) {
      findings.push({ code: "CF5_MISSING_CLAIM_ID" });
      continue;
    }

    if (seenClaimIds.has(claimId)) {
      errors.push({ code: "CF5_DUPLICATE_CLAIM_ID", claimId });
    }

    const normalized = normalizeClaimText(claim.claim);
    const isExactDuplicateText = normalized && seenNormalized.has(normalized);
    if (isExactDuplicateText) {
      findings.push({ code: "CF5_EXACT_DUPLICATE_CLAIM", claimId });
      continue;
    }

    if (typeof claim.claim !== "string" || claim.claim.trim().length === 0) {
      errors.push({ code: "CF5_EMPTY_CLAIM", claimId });
    }

    if (!Array.isArray(claim.grounding) || claim.grounding.length === 0) {
      errors.push({ code: "CF5_EMPTY_GROUNDING", claimId });
    } else {
      for (const unitId of claim.grounding) {
        if (!knownUnitIds.has(unitId)) {
          errors.push({ code: "CF5_UNKNOWN_UNIT_ID", claimId, unitId });
        }
      }
    }

    if (!ARTICLE_TREATMENTS.has(claim.articleTreatment)) {
      errors.push({ code: "CF5_INVALID_ARTICLE_TREATMENT", claimId, value: claim.articleTreatment });
    }

    if (claim.provenance !== null
        && (typeof claim.provenance !== "string" || claim.provenance.trim().length === 0)) {
      errors.push({ code: "CF5_INVALID_PROVENANCE", claimId, value: claim.provenance });
    }

    if (errors.length) {
      findings.push(...errors);
      hardFailureClaimIds.add(claimId);
    }

    seenClaimIds.set(claimId, true);
    if (normalized) seenNormalized.add(normalized);
    claims.push(claim);
  }

  if (claims.length < 8) {
    findings.push({ code: "CF5_THIN_CLAIM_SET", count: claims.length });
  } else if (claims.length > 15) {
    findings.push({ code: "CF5_OVERSIZED_CLAIM_SET", count: claims.length });
  }

  return { claims, findings, hardFailureClaimIds };
}

// Merges a repair pass's output back in: only claims whose IDs were flagged for hard
// failure are replaced; everything else is left untouched.
export function applyRepair(claims, repairedClaims, hardFailureClaimIds) {
  const repairedById = new Map(repairedClaims.map((claim) => [claim.claimId, claim]));
  return claims.map((claim) => (
    hardFailureClaimIds.has(claim.claimId) && repairedById.has(claim.claimId)
      ? repairedById.get(claim.claimId)
      : claim
  ));
}
