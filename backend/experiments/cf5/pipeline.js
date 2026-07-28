// CF5 minimal vertical slice — shared validation/repair orchestration. Used by both the
// live runner (run-cf5.mjs, repair calls the model) and the offline replay path
// (replay.mjs, repair reads a saved response) so both take the exact same code path and
// are provably deterministic given the same raw model output.
import { validateClaims, applyRepair } from "./validation.js";

// `repair({ failedClaims, errors })` must return { repairedClaims, rawResponse, usage,
// model }. Called at most once, only when validateClaims finds a hard failure.
export async function runGenerationPipeline({ rawClaims, knownUnitIds, repair }) {
  const firstPass = validateClaims(rawClaims, knownUnitIds);
  let finalClaims = firstPass.claims;
  let finalFindings = firstPass.findings;
  let repairResult = null;

  if (firstPass.hardFailureClaimIds.size > 0) {
    const failedClaims = firstPass.claims.filter((c) => firstPass.hardFailureClaimIds.has(c.claimId));
    const errors = firstPass.findings.filter((f) => firstPass.hardFailureClaimIds.has(f.claimId));
    const repaired = await repair({ failedClaims, errors });
    const merged = applyRepair(firstPass.claims, repaired.repairedClaims, firstPass.hardFailureClaimIds);
    const secondPass = validateClaims(merged, knownUnitIds);
    finalClaims = secondPass.claims;
    finalFindings = [
      ...firstPass.findings,
      ...secondPass.findings.filter((f) => firstPass.hardFailureClaimIds.has(f.claimId)),
    ];
    repairResult = {
      attemptedClaimIds: [...firstPass.hardFailureClaimIds],
      stillFailingClaimIds: [...secondPass.hardFailureClaimIds],
      rawResponse: repaired.rawResponse,
      usage: repaired.usage,
      model: repaired.model,
    };
  }

  return {
    firstPassFindings: firstPass.findings,
    hardFailureClaimIds: firstPass.hardFailureClaimIds,
    finalClaims,
    finalFindings,
    repairResult,
  };
}
