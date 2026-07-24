import test from "node:test";
import assert from "node:assert/strict";
import { selectBalancedCandidatesV1 }
  from "./prompt-benchmark/balancedCandidateSelectorV1.js";
import { selectBalancedCandidatesV2 }
  from "./prompt-benchmark/balancedCandidateSelectorV2.js";
import { selectPillarBalancedCandidatesV1 }
  from "./prompt-benchmark/pillarBalancedCandidateSelectorV1.js";

const units = Array.from({ length: 12 }, (_, index) => ({ unitId: `U${index}`,
  order: index, text: index === 10 ? "A 2024 study found a measured increase of 25 percent."
    : `Factual passage ${index}.` }));
const claim = (text, unit, materiality = "high") => ({ claimText: text,
  sourceUnitIds: [unit], materiality, relatedPillarLabels: ["Axis"] });

test("balanced selector ignores materiality, excludes presentation, and reaches late regions", () => {
  const candidates = [
    claim("The presentation attempts to reassure readers.", "U0", "high"),
    claim("A factual passage exists.", "U1", "high"),
    claim("A later factual passage exists.", "U5", "low"),
    claim("A 2024 study found a measured increase of 25 percent.", "U10", "low"),
  ];
  const result = selectBalancedCandidatesV1({ candidateClaims: candidates,
    sourceUnits: units, maximum: 3 });
  assert.ok(!result.selectedClaims.some((item) => item.claimText.includes("presentation")));
  assert.ok(result.selectedClaims.some((item) => item.sourceUnitIds.includes("U10")));
  assert.equal(result.selectedClaims.length, 3);
});

test("balanced selector V2 never fills a regional quota below its generic quality floor", () => {
  const claims = [
    claim("A study found a measured increase of 20 percent.", "U1"),
    claim("The event was shocking.", "U3"),
    claim("Records showed a measured decrease of 10 percent.", "U8"),
  ];
  const result = selectBalancedCandidatesV2({ candidateClaims: claims,
    sourceUnits: units, maximum: 3 });
  assert.equal(result.selectedClaims.some((item) => item.claimText === "The event was shocking."),
    false);
  assert.equal(result.deferred.find((item) => item.claimText === "The event was shocking.")?.reason,
    "below_quality_floor");
});

test("pillar selector covers pillars and preserves a quality-gated unlinked reserve", () => {
  const pillarUnits = units.map((unit) => unit.unitId === "U1"
    ? { ...unit, text: "A study found a measured increase of 20 percent." } : unit);
  const claims = [
    { ...claim("A study found a measured increase of 20 percent.", "U1"), candidateId: "C1" },
    { ...claim("Records showed a measured decrease of 10 percent.", "U8"), candidateId: "C2" },
    { ...claim("A 2024 report measured a rate of 25 percent.", "U10"), candidateId: "C3" },
  ];
  const result = selectPillarBalancedCandidatesV1({ candidateClaims: claims,
    sourceUnits: pillarUnits, maximum: 3, unlinkedReserve: 1,
    pillars: [{ label: "Axis A", importance: "load_bearing" },
      { label: "Axis B", importance: "major" }],
    assignments: [{ candidateId: "C1", relatedPillarLabels: ["Axis A"] },
      { candidateId: "C2", relatedPillarLabels: ["Axis B"] },
      { candidateId: "C3", relatedPillarLabels: [] }] });
  assert.deepEqual(result.diagnostics.pillarCounts, { "Axis A": 1, "Axis B": 1 });
  assert.equal(result.diagnostics.unlinkedSelectedCount, 1);
  assert.deepEqual(result.diagnostics.selectedRegionCounts, { 0: 1, 1: 0, 2: 1, 3: 1 });
});
