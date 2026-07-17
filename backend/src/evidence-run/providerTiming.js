export function buildProviderTiming(execution, gatewayDiagnostics = []) {
  const requestDeferred = execution.outcomes.filter((x) => x.status === "deferred_budget").length;
  let requestAttempted;
  let requestSucceeded;
  let requestFailed;
  if (gatewayDiagnostics.length) {
    requestAttempted = gatewayDiagnostics.length;
    requestSucceeded = gatewayDiagnostics.filter((item) =>
      (item.providers || []).some((call) => !call.error && !call.skipped)).length;
    requestFailed = requestAttempted - requestSucceeded;
  } else {
    requestAttempted = execution.outcomes.filter((x) => x.status !== "deferred_budget").length;
    requestFailed = execution.outcomes.filter((x) => x.status === "provider_error").length;
    requestSucceeded = requestAttempted - requestFailed;
  }
  const byProvider = new Map();
  for (const diagnostic of gatewayDiagnostics) for (const call of diagnostic.providers || []) {
    const row = byProvider.get(call.provider) || {
      provider: call.provider, attempted: 0, succeeded: 0, failed: 0, skipped: 0,
      elapsedMsTotal: 0, elapsedMsMax: 0, rawCandidates: 0, errors: [],
    };
    row.attempted += call.skipped ? 0 : 1;
    row.skipped += call.skipped ? 1 : 0;
    row.failed += call.error ? 1 : 0;
    row.succeeded += !call.error && !call.skipped ? 1 : 0;
    row.elapsedMsTotal += Number(call.elapsedMs) || 0;
    row.elapsedMsMax = Math.max(row.elapsedMsMax, Number(call.elapsedMs) || 0);
    row.rawCandidates += Number(call.rawResultCount) || 0;
    if (call.error) row.errors.push(String(call.error).slice(0, 500));
    byProvider.set(call.provider, row);
  }
  const providers = [...byProvider.values()].map((row) => ({
    ...row,
    elapsedMsAverage: row.attempted ? Math.round(row.elapsedMsTotal / row.attempted) : 0,
    errors: [...new Set(row.errors)],
  }));
  const providerCalls = providers.reduce((acc, row) => ({
    attempted: acc.attempted + row.attempted,
    succeeded: acc.succeeded + row.succeeded,
    failed: acc.failed + row.failed,
    skipped: acc.skipped + row.skipped,
  }), { attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
  return {
    schemaVersion: "er1.providerTiming.v1",
    requestQueries: {
      attempted: requestAttempted,
      succeeded: requestSucceeded,
      failed: requestFailed,
      deferred: requestDeferred,
    },
    providerCalls,
    providers,
    gatewayDiagnosticCount: gatewayDiagnostics.length,
  };
}
