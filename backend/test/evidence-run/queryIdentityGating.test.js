import test from "node:test";
import assert from "node:assert/strict";
import { compileTargetLanes } from "../../src/evidence-run/queryCompiler.js";
import { buildQueryQualityReview } from "../../src/evidence-run/queryQuality.js";

// The evaluated article: author "Alex Rivera", year 2004 → surname/year the compiler
// must NOT inject into a substantive target's evidence lanes.
const ARTICLE = { title: "City Bridge Procurement Audit of 2004", authors: [{ name: "Alex Rivera" }],
  publishedAt: "2004-02-01T00:00:00Z" };
const TASK = { articleRole: "pillar", articleUse: "endorsed" };

function target(gradeTarget, assertionSource = "the article") {
  return { targetId: "T001", targetText: "Procurement began nine months late", sourceUnitIds: [],
    evidenceNeedCard: { gradeTarget, assertionSource,
      bearingCriteria: { mustMatch: ["procurement timing"], shouldMatch: [], rejectIfOnly: [] },
      falsifiability: { wouldSupportIf: "the audit dates procurement nine months late",
        verificationQuestion: "did procurement begin nine months late" },
      evidenceRolesNeeded: ["target-primary", "primary-record"], scope: "the audited procurement",
      queryLaneSeeds: [], warnings: [] } };
}

const anyLaneHasArticleIdentity = (lanes) =>
  lanes.some((lane) => /\brivera\b/i.test(lane.query) || /\b2004\b/.test(lane.query));

test("substantive target: the evaluated article's surname/year is NOT injected", () => {
  const lanes = compileTargetLanes({ task: TASK, target: target("substance"), article: ARTICLE });
  assert.equal(anyLaneHasArticleIdentity(lanes), false);
  // The proposition/must-match signal is preserved — the gate removes identity, not the query.
  assert.ok(lanes.some((lane) => /procurement/i.test(lane.query)));
});

test("attribution + article-asserter: identity IS allowed (no over-correction)", () => {
  const lanes = compileTargetLanes({ task: TASK, target: target("attribution", "the article"), article: ARTICLE });
  assert.equal(anyLaneHasArticleIdentity(lanes), true);
});

test("attribution but a non-article asserter: still suppressed", () => {
  const lanes = compileTargetLanes({ task: TASK, target: target("attribution", "Harriet Vance"), article: ARTICLE });
  assert.equal(anyLaneHasArticleIdentity(lanes), false);
});

test("baseline package (no gradeTarget): prior behavior unchanged (identity injected)", () => {
  const lanes = compileTargetLanes({ task: TASK, target: target(null), article: ARTICLE });
  assert.equal(anyLaneHasArticleIdentity(lanes), true);
});

// --- query-quality audit extension: surname+year leak detection --------------------

const lane = (query, queryClass = "target_evidence") => ({ laneId: `L-${query.slice(0, 6)}`,
  query, queryClass, laneType: "evidence", laneFamily: "primary_result", evidenceRole: "primary_result" });

function review(lanes) {
  return buildQueryQualityReview({
    lanePlan: { lanes, deferredContextWorks: [] },
    providerQueries: { selectedCounts: {} }, packageValue: { packageId: "p1", article: ARTICLE } });
}

test("audit flags surname+year leakage that the DOI/full-title check missed", () => {
  const r = review([lane("Rivera 2004 procurement timing study results")]);
  assert.deepEqual(r.queriesContainingArticleSurnameYearOutsideIdentityLanes, ["L-Rivera"]);
  assert.ok(r.warningsBeforeProviderExecution.includes("article_surname_year_outside_identity_lane"));
});

test("audit does not flag a bare year or a bare surname alone, nor identity lanes", () => {
  const r = review([
    lane("procurement in 2004 general context"), // year only
    lane("Rivera municipal reporting"), // surname only
    lane("Rivera 2004 canonical record", "identity_resolution"), // identity lane excluded
  ]);
  assert.deepEqual(r.queriesContainingArticleSurnameYearOutsideIdentityLanes, []);
  assert.equal(r.warningsBeforeProviderExecution.includes("article_surname_year_outside_identity_lane"), false);
});
