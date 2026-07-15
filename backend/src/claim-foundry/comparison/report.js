const FIXTURES = Object.freeze(Array.from({ length: 8 }, (_, index) => `CF1-F0${index + 1}`));
const DIMENSIONS = Object.freeze(["claimUsefulness", "themePillarCoverage", "claimWording", "targetQuality"]);

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function status(pass, measured = true) {
  return measured ? (pass ? "pass" : "fail") : "not_measured";
}

function producerRuns(runs, producer) {
  return runs.filter((run) => run.producer === producer);
}

function fixtureMedians(runs, producer) {
  return Object.fromEntries(FIXTURES.map((fixtureId) => [fixtureId,
    Object.fromEntries(DIMENSIONS.map((dimension) => [dimension,
      median(producerRuns(runs, producer).filter((run) => run.fixtureId === fixtureId)
        .map((run) => run.scores?.[dimension]))]))]));
}

function aggregate(medians) {
  return median(Object.values(medians).flatMap((entry) => Object.values(entry)));
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
}

export function buildCf1GateReport(input) {
  const runs = Array.isArray(input?.runs) ? input.runs : [];
  const cf1 = fixtureMedians(runs, "cf1");
  const baseline = fixtureMedians(runs, "baseline");
  const cf1Aggregate = aggregate(cf1);
  const baselineAggregate = aggregate(baseline);
  const completeHuman = Object.values(cf1).every((entry) => Object.values(entry).every(Number.isFinite))
    && Object.values(baseline).every((entry) => Object.values(entry).every(Number.isFinite));
  const fixturePasses = Object.values(cf1).filter((entry) => {
    const values = Object.values(entry);
    return values.every((value) => value >= 3) && values.reduce((a, b) => a + b, 0) / values.length >= 4;
  }).length;
  const validCf1 = producerRuns(runs, "cf1").filter((run) => run.validPackage === true).length;
  const cf1Runs = producerRuns(runs, "cf1");
  const invalidPersisted = cf1Runs.filter((run) => run.persisted === true && run.validPackage !== true).length;
  const typical = cf1Runs.filter((run) => run.fixtureId !== "CF1-F03");
  const typicalCallsPass = typical.length > 0 && typical.every((run) => Number(run.modelCalls) <= 2);
  const reliabilityMeasured = cf1Runs.length === 24;
  const comparisonChecks = completeHuman && DIMENSIONS.every((dimension) =>
    FIXTURES.filter((fixtureId) => cf1[fixtureId][dimension] >= baseline[fixtureId][dimension]).length >= 6)
    && DIMENSIONS.every((dimension) => FIXTURES.every((fixtureId) =>
      cf1[fixtureId][dimension] >= baseline[fixtureId][dimension] - 0.5))
    && input.specialChecks?.rebuttalStance === true && input.specialChecks?.contradictionNuance === true;
  const typicalBaseline = producerRuns(runs, "baseline").filter((run) => run.fixtureId !== "CF1-F03");
  const typicalEfficiencyMeasured = typical.length === 21 && typicalBaseline.length === 21
    && [...typical, ...typicalBaseline].every((run) => Number.isFinite(run.totalTokens) && Number.isFinite(run.durationMs));
  const repairRate = typical.length ? typical.filter((run) => run.repairUsed === true).length / typical.length : null;
  const typicalEfficiencyPass = typicalEfficiencyMeasured && typicalCallsPass && repairRate <= 0.1
    && median(typical.map((run) => run.totalTokens)) <= 0.7 * median(typicalBaseline.map((run) => run.totalTokens))
    && median(typical.map((run) => run.durationMs)) <= median(typicalBaseline.map((run) => run.durationMs))
    && percentile(typical.map((run) => run.durationMs), 0.95)
      <= 1.2 * percentile(typicalBaseline.map((run) => run.durationMs), 0.95);
  const longCf1 = cf1Runs.filter((run) => run.fixtureId === "CF1-F03");
  const longBaseline = producerRuns(runs, "baseline").filter((run) => run.fixtureId === "CF1-F03");
  const longMeasured = longCf1.length === 3 && longBaseline.length === 3
    && [...longCf1, ...longBaseline].every((run) => Number.isFinite(run.totalTokens) && Number.isFinite(run.durationMs));
  const longPass = longMeasured && longCf1.every((run) => Number(run.modelCalls) <= 8)
    && median(longCf1.map((run) => run.totalTokens)) <= median(longBaseline.map((run) => run.totalTokens))
    && median(longCf1.map((run) => run.durationMs)) <= 1.2 * median(longBaseline.map((run) => run.durationMs));
  const deterministicMeasured = cf1Runs.length > 0
    && cf1Runs.every((run) => typeof run.deterministicGatesPassed === "boolean");
  return {
    schemaVersion: "cf1.comparisonGateReport.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    fixtureMedians: { cf1, baseline }, aggregates: { cf1: cf1Aggregate, baseline: baselineAggregate },
    gates: {
      humanQuality: { status: status(completeHuman && fixturePasses >= 7 && cf1Aggregate >= 4, completeHuman), fixturePasses },
      comparativeQuality: { status: status(comparisonChecks && cf1Aggregate - baselineAggregate >= 0.4,
        completeHuman && input.specialChecks != null), delta: completeHuman ? cf1Aggregate - baselineAggregate : null },
      deterministicPackage: { status: status(deterministicMeasured
        && cf1Runs.every((run) => run.deterministicGatesPassed), deterministicMeasured) },
      typicalCallCeiling: { status: status(typicalCallsPass, typical.length > 0) },
      typicalEfficiency: { status: status(typicalEfficiencyPass, typicalEfficiencyMeasured), repairRate },
      longEfficiency: { status: status(longPass, longMeasured) },
      reliability: { status: status(reliabilityMeasured && validCf1 / 24 >= 0.95, reliabilityMeasured), validPackages: validCf1 },
      invalidPersistedPackages: { status: status(invalidPersisted === 0, cf1Runs.length > 0), count: invalidPersisted },
    },
  };
}

export { DIMENSIONS, FIXTURES };
