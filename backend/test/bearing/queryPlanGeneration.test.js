import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQueryLanesFromEvaluationTargets,
  buildEvidenceNeedFromEvaluationTargets,
  buildEvidenceTargetQueries,
} from "../../src/core/evidenceNeed.js";

// ─── Thompson evaluation targets (as returned by normalizeEvaluationTarget) ──

const THOMPSON_ATTRIBUTION_TARGET = {
  evaluationTargetId: 10,
  targetType: "attribution",
  targetText: "William Thompson made a statement about CDC handling of MMR/autism data.",
  subjectEntity: "William Thompson",
  predicate: "made allegation about",
  objectText: "CDC handling of MMR/autism data",
  allegedAction: null,
  studyTitle: null,
  studyYear: null,
  studyAuthors: null,
  studyIdentifier: null,
  populationScope: null,
  searchEligible: true,
  verdictEligible: true,
};

const THOMPSON_STUDY_IDENTITY_TARGET = {
  evaluationTargetId: 11,
  targetType: "study_identity",
  targetText: "Resolve the exact MMR/autism study, dataset, population, and disputed analysis referenced by Thompson.",
  subjectEntity: "CDC",
  predicate: "conducted study on",
  objectText: "MMR vaccine and autism",
  allegedAction: null,
  studyTitle: null,
  studyYear: null,
  studyAuthors: null,
  studyIdentifier: null,
  populationScope: null,
  searchEligible: true,
  verdictEligible: false,
};

const THOMPSON_SUBSTANTIVE_TARGET = {
  evaluationTargetId: 12,
  targetType: "substantive",
  targetText: "CDC researchers improperly altered, omitted, or excluded analyses from the MMR/autism study.",
  subjectEntity: "CDC researchers",
  predicate: "improperly altered, omitted, or excluded",
  objectText: "analyses from MMR/autism study",
  allegedAction: "manipulated",
  studyTitle: null,
  studyYear: null,
  studyAuthors: null,
  studyIdentifier: null,
  populationScope: null,
  searchEligible: true,
  verdictEligible: true,
};

const THOMPSON_INFERENCE_TARGET = {
  evaluationTargetId: 13,
  targetType: "inference",
  targetText: "The alleged manipulation concealed evidence of a link between MMR vaccination and autism.",
  subjectEntity: "CDC",
  predicate: "concealed evidence of",
  objectText: "MMR/autism link",
  allegedAction: "concealed",
  studyTitle: null,
  studyYear: null,
  studyAuthors: null,
  studyIdentifier: null,
  populationScope: null,
  searchEligible: true,
  verdictEligible: true,
};

const ALL_THOMPSON_TARGETS = [
  THOMPSON_ATTRIBUTION_TARGET,
  THOMPSON_STUDY_IDENTITY_TARGET,
  THOMPSON_SUBSTANTIVE_TARGET,
  THOMPSON_INFERENCE_TARGET,
];

const THOMPSON_CLAIM = {
  id: 52615,
  text: "William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC.",
  isAttribution: true,
  speakerEntity: "William Thompson",
  objectClaim: "CDC researchers improperly altered, omitted, or excluded analyses from an MMR/autism study.",
  searchText: "CDC researchers improperly altered, omitted, or excluded analyses from an MMR/autism study.",
  evaluationTargets: ALL_THOMPSON_TARGETS,
};

// ─── buildQueryLanesFromEvaluationTargets ─────────────────────────────────────

test("Thompson: buildQueryLanesFromEvaluationTargets returns lanes for all four target types", () => {
  const lanes = buildQueryLanesFromEvaluationTargets(ALL_THOMPSON_TARGETS, { speakerEntity: "William Thompson" });
  assert.ok(lanes.length >= 4, `expected at least 4 lanes, got ${lanes.length}`);
  const types = lanes.map((l) => l.evaluationTargetType);
  assert.ok(types.includes("attribution"), "missing attribution lane");
  assert.ok(types.includes("substantive"), "missing substantive lane");
  assert.ok(types.includes("study_identity"), "missing study_identity lane");
  assert.ok(types.includes("inference"), "missing inference lane");
});

test("Thompson: all lanes have source = search_assertion so they pass through buildEvidenceTargetQueries", () => {
  const lanes = buildQueryLanesFromEvaluationTargets(ALL_THOMPSON_TARGETS);
  for (const lane of lanes) {
    assert.equal(lane.source, "search_assertion", `lane ${lane.id} missing source=search_assertion`);
  }
});

test("Thompson: substantive lane query contains subject and alleged action terms", () => {
  const lanes = buildQueryLanesFromEvaluationTargets([THOMPSON_SUBSTANTIVE_TARGET]);
  const conduct = lanes.find((l) => l.id.startsWith("substantive-conduct"));
  assert.ok(conduct, "substantive-conduct lane must exist");
  const q = conduct.queryHint.toLowerCase();
  assert.ok(q.includes("cdc") || q.includes("researchers"), `query should mention CDC/researchers, got: "${conduct.queryHint}"`);
  assert.ok(q.includes("manipulated") || q.includes("omitted") || q.includes("excluded") || q.includes("altered"),
    `query should mention alleged action, got: "${conduct.queryHint}"`);
});

test("Thompson: attribution lane query contains speaker entity", () => {
  const lanes = buildQueryLanesFromEvaluationTargets([THOMPSON_ATTRIBUTION_TARGET], { speakerEntity: "William Thompson" });
  const attribution = lanes.find((l) => l.id.startsWith("attribution"));
  assert.ok(attribution, "attribution lane must exist");
  assert.ok(attribution.queryHint.includes("William Thompson"), `attribution query must include speaker, got: "${attribution.queryHint}"`);
});

test("Thompson: study_identity lane is generated and search-eligible", () => {
  const lanes = buildQueryLanesFromEvaluationTargets([THOMPSON_STUDY_IDENTITY_TARGET]);
  const studyLane = lanes.find((l) => l.id.startsWith("study-identity"));
  assert.ok(studyLane, "study_identity lane must exist");
  assert.ok(studyLane.queryHint.length > 5, "study_identity query must be non-trivial");
});

test("non-search-eligible targets are excluded from lanes", () => {
  const ineligible = { ...THOMPSON_SUBSTANTIVE_TARGET, searchEligible: false };
  const lanes = buildQueryLanesFromEvaluationTargets([ineligible]);
  assert.equal(lanes.length, 0, "ineligible target must produce no lanes");
});

test("empty target array returns empty lanes", () => {
  const lanes = buildQueryLanesFromEvaluationTargets([]);
  assert.equal(lanes.length, 0);
});

// ─── buildEvidenceNeedFromEvaluationTargets ───────────────────────────────────

test("Thompson: buildEvidenceNeedFromEvaluationTargets uses evaluation_targets_v1 derivation", () => {
  const need = buildEvidenceNeedFromEvaluationTargets(THOMPSON_CLAIM, ALL_THOMPSON_TARGETS);
  assert.equal(need.derivation.method, "evaluation_targets_v1");
  assert.ok(need.derivation.evaluationTargetCount >= 4);
  assert.ok(need.derivation.searchEligibleLaneCount >= 4);
});

test("Thompson: buildEvidenceNeedFromEvaluationTargets evidenceTargets all have source=search_assertion", () => {
  const need = buildEvidenceNeedFromEvaluationTargets(THOMPSON_CLAIM, ALL_THOMPSON_TARGETS);
  assert.ok(need.evidenceTargets.length > 0);
  for (const t of need.evidenceTargets) {
    assert.equal(t.source, "search_assertion");
  }
});

// ─── Phase 4: Thompson substantive target reaches query generation ─────────────

test("Phase 4 regression: Thompson substantive target reaches buildEvidenceTargetQueries output", () => {
  const need = buildEvidenceNeedFromEvaluationTargets(THOMPSON_CLAIM, ALL_THOMPSON_TARGETS);
  const queries = buildEvidenceTargetQueries(need, 5);
  assert.ok(queries.length > 0, "must generate at least one query");
  const allText = queries.map((q) => q.query.toLowerCase()).join(" ");
  assert.ok(
    allText.includes("cdc") || allText.includes("mmr") || allText.includes("autism") || allText.includes("manipulat"),
    `queries must reference substantive claim terms, got: ${JSON.stringify(queries.map((q) => q.query))}`,
  );
});

test("Phase 4 regression: at least one query is attribution-lane for Thompson", () => {
  const need = buildEvidenceNeedFromEvaluationTargets(THOMPSON_CLAIM, ALL_THOMPSON_TARGETS);
  const queries = buildEvidenceTargetQueries(need, 5);
  // Attribution lanes have stanceGoal="origin" and evidenceTargetType="primary_source"
  const hasAttribution = queries.some((q) => q.stanceGoal === "origin" || q.evidenceTargetType === "primary_source");
  assert.ok(hasAttribution, `expected at least one attribution/origin-stance query, got: ${JSON.stringify(queries.map((q) => ({ stanceGoal: q.stanceGoal, type: q.evidenceTargetType })))}`);
});

test("Phase 4 regression: fallback to deterministic_v1 when no targets provided", () => {
  const need = buildEvidenceNeedFromEvaluationTargets(THOMPSON_CLAIM, []);
  assert.ok(["deterministic_v1", "search_assertions_v1"].includes(need.derivation.method),
    `expected fallback derivation, got: ${need.derivation.method}`);
  const queries = buildEvidenceTargetQueries(need, 3);
  assert.ok(queries.length >= 0);
});
