import test from "node:test";
import assert from "node:assert/strict";
import { buildCf1GateReport, DIMENSIONS, FIXTURES } from "../../src/claim-foundry/comparison/report.js";

function completeRuns() {
  return FIXTURES.flatMap((fixtureId) => ["cf1", "baseline"].flatMap((producer) =>
    Array.from({ length: 3 }, (_, repeat) => ({ fixtureId, producer, repeat,
      scores: Object.fromEntries(DIMENSIONS.map((key) => [key, producer === "cf1" ? 4.5 : 4])),
      validPackage: producer === "cf1", persisted: producer === "cf1", modelCalls: 1,
      deterministicGatesPassed: producer === "cf1", repairUsed: false,
      totalTokens: producer === "cf1" ? 600 : 1000, durationMs: producer === "cf1" ? 800 : 1000 }))));
}

test("comparison report keeps missing human work explicitly not measured", () => {
  const report = buildCf1GateReport({ runs: [] });
  assert.equal(report.gates.humanQuality.status, "not_measured");
  assert.equal(report.gates.reliability.status, "not_measured");
});

test("comparison report evaluates complete paired reviewer results", () => {
  const report = buildCf1GateReport({ runs: completeRuns(), generatedAt: "2026-07-13T00:00:00Z",
    specialChecks: { rebuttalStance: true, contradictionNuance: true } });
  assert.equal(report.gates.humanQuality.status, "pass");
  assert.equal(report.gates.comparativeQuality.status, "pass");
  assert.equal(report.gates.reliability.status, "pass");
  assert.equal(report.gates.typicalEfficiency.status, "pass");
  assert.equal(report.gates.longEfficiency.status, "pass");
  assert.equal(report.gates.invalidPersistedPackages.status, "pass");
});
