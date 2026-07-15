const STATUS_BY_CODE = Object.freeze({
  CF1_AUTH_REQUIRED: 401, CF1_AUTH_FORBIDDEN: 403, CF1_IDEMPOTENCY_CONFLICT: 409,
  CF1_VERIFICATION_FAILED: 422, CF1_INPUT_TOO_LARGE: 413, CF1_FIELD_TOO_LONG: 413,
  CF1_BUDGET_EXCEEDED: 429, CF1_MODEL_UNAVAILABLE: 503, CF1_MODEL_TIMEOUT: 503,
});

export function httpStatusForCf1Error(error) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) return error.status;
  return STATUS_BY_CODE[error?.code] ?? 500;
}

export function cf1ErrorBody(error, runId = null) {
  return { ok: false, ...(runId ? { runId } : {}),
    status: error?.runStatus ?? "failed",
    error: { code: error?.code ?? "CF1_INTERNAL_FAILURE",
      message: error?.message ?? "Claim Foundry failed", retryable: error?.retryable === true,
      issues: error?.issues ?? [] } };
}

export function cf1SuccessBody(result, includePackage = false) {
  const pkg = result.claimPackage;
  return { ok: true, packageId: pkg.packageId, runId: pkg.runId,
    schemaVersion: pkg.schemaVersion, status: pkg.status, packageHash: pkg.packageHash,
    artifactPath: result.artifactPath ?? "", summary: {
      selectedClaimCount: pkg.selectedEvaluationClaims.length,
      targetCount: pkg.phase3Targets.length, evidenceNeedCardCount: pkg.evidenceNeedCards.length,
      valid: pkg.verification.valid,
    }, claimPackage: includePackage ? pkg : null };
}
