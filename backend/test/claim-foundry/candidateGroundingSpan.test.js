import test from "node:test";
import assert from "node:assert/strict";
import { classifyGroundingSpan, tagCandidateGroundingSpans, unitOrdinal,
  isFlaggedGroundingSpan, BORDERLINE_GAP, DISTANT_GAP }
  from "../../src/claim-foundry/candidateGroundingSpan.js";

// Regression fixtures lifted from real completed F03 Call-1 inventories (the
// runs themselves live under the git-ignored artifacts/ tree). These are the
// known cross-document "fusion" welds the split arm's grounding-span host step
// must catch before Call 1B, plus the tight same-passage claims it must NOT
// misflag. See Test order step 1.
const KNOWN_FUSION_WELDS = [
  { sourceUnitIds: ["U0062", "U0156"], note: "censorship narrative welded across the document" },
  { sourceUnitIds: ["U0301", "U0364"], note: "thimerosal weld" },
  { sourceUnitIds: ["U0245", "U0279"], note: "aluminum weld" },
  { sourceUnitIds: ["U0021", "U0182"], note: "public-health-messaging weld" },
  { sourceUnitIds: ["U0055", "U0156"], note: "Vaxxed censorship weld" },
];

const TIGHT_CLAIMS = [
  { sourceUnitIds: ["U0002"], note: "single unit" },
  { sourceUnitIds: ["U0086", "U0087"], note: "adjacent sentences" },
  { sourceUnitIds: ["U0101", "U0105", "U0106"], note: "one passage, small gaps" },
  { sourceUnitIds: ["U0191", "U0200"], note: "SIDS, same section" },
  { sourceUnitIds: ["U0330", "U0344"], note: "CDC data, same section" },
];

test("flags every known F03 fusion weld as distant", () => {
  for (const { sourceUnitIds, note } of KNOWN_FUSION_WELDS) {
    const result = classifyGroundingSpan(sourceUnitIds);
    assert.equal(result.groundingSpan, "distant", `${note} (${sourceUnitIds}) should be distant`);
    assert.ok(result.passageCount > 1, `${note} should resolve to multiple passages`);
  }
});

test("leaves tight same-passage claims clustered", () => {
  for (const { sourceUnitIds, note } of TIGHT_CLAIMS) {
    const result = classifyGroundingSpan(sourceUnitIds);
    assert.equal(result.groundingSpan, "clustered", `${note} (${sourceUnitIds}) should be clustered`);
  }
});

test("borderline is a distinct tag at the 15-19 boundary, not folded either way", () => {
  // Exact-gap fixtures: U0001 + U000N gives maxGap N-1.
  assert.equal(classifyGroundingSpan(["U0001", "U0015"]).groundingSpan, "clustered"); // gap 14
  assert.equal(classifyGroundingSpan(["U0001", "U0016"]).groundingSpan, "borderline"); // gap 15
  assert.equal(classifyGroundingSpan(["U0001", "U0020"]).groundingSpan, "borderline"); // gap 19
  assert.equal(classifyGroundingSpan(["U0001", "U0021"]).groundingSpan, "distant"); // gap 20
});

test("both distant and borderline are flagged for Call 1B; clustered is not", () => {
  assert.equal(isFlaggedGroundingSpan("distant"), true);
  assert.equal(isFlaggedGroundingSpan("borderline"), true);
  assert.equal(isFlaggedGroundingSpan("clustered"), false);
});

test("reports raw span metrics for host selection policy", () => {
  const result = classifyGroundingSpan(["U0062", "U0156"]);
  assert.equal(result.unitSpan, 94);
  assert.equal(result.maxGap, 94);
  assert.equal(result.passageCount, 2);
});

test("single or empty grounding is clustered with zero span", () => {
  assert.deepEqual(classifyGroundingSpan([]).groundingSpan, "clustered");
  assert.equal(classifyGroundingSpan([]).unitSpan, 0);
  assert.equal(classifyGroundingSpan(["U0007"]).unitSpan, 0);
});

test("thresholds are configurable for host policy overrides", () => {
  // Span-16 thimerosal grouping is borderline by default; overrides can move it.
  const midBand = ["U0308", "U0324"]; // gap 16
  assert.equal(classifyGroundingSpan(midBand).groundingSpan, "borderline");
  assert.equal(classifyGroundingSpan(midBand, { distantGap: 12 }).groundingSpan, "distant");
  assert.equal(classifyGroundingSpan(midBand, { borderlineGap: 20 }).groundingSpan, "clustered");
});

test("dedupes and sorts unordered unit ids", () => {
  const result = classifyGroundingSpan(["U0279", "U0245", "U0245"]);
  assert.equal(result.unitSpan, 34);
  assert.equal(result.passageCount, 2);
});

test("unitOrdinal parses positional ids and rejects others", () => {
  assert.equal(unitOrdinal("U0007"), 7);
  assert.equal(unitOrdinal("U0000"), 0);
  assert.equal(unitOrdinal("B003"), null);
  assert.equal(unitOrdinal("garbage"), null);
});

test("tagCandidateGroundingSpans annotates claims without dropping fields", () => {
  const tagged = tagCandidateGroundingSpans([
    { claimText: "a", sourceUnitIds: ["U0062", "U0156"], materiality: "high" },
    { claimText: "b", sourceUnitIds: ["U0086", "U0087"] },
  ]);
  assert.equal(tagged[0].groundingSpan, "distant");
  assert.equal(tagged[0].claimText, "a");
  assert.equal(tagged[0].materiality, "high");
  assert.equal(tagged[0]._groundingSpanMetrics.maxGap, 94);
  assert.equal(tagged[1].groundingSpan, "clustered");
});

test("default gap constants are exported and stable", () => {
  assert.equal(BORDERLINE_GAP, 15);
  assert.equal(DISTANT_GAP, 20);
});
