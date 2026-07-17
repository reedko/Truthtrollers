import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCf1PackageFile } from "../../src/evidence-run/packageLoader.js";
import { buildTargetPortfolio } from "../../src/evidence-run/targetPortfolio.js";
import { buildIdentityRegistry } from "../../src/evidence-run/identityRegistry.js";
import { buildQueryLanePlan } from "../../src/evidence-run/queryPlanner.js";
import { buildProviderQueries } from "../../src/evidence-run/retrievalCoordinator.js";
import { buildQueryQualityReview } from "../../src/evidence-run/queryQuality.js";
import { runQueryPlanningReview } from "../../src/evidence-run/runQueryPlanningReview.js";
import { classifyContextWork, contextWorkQuery } from "../../src/evidence-run/queryCompiler.js";
import { ER1_CF1_FIXTURES } from "./fixtures/manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packagePath = path.join(root, ER1_CF1_FIXTURES[0].relativePath);
const options = { profile: "standard",
  retrievalStrategy: { mode: "role_diverse_falsifiability" } };

async function plan() {
  const { packageValue } = await loadCf1PackageFile(packagePath);
  const portfolio = buildTargetPortfolio(packageValue);
  const identityRegistry = buildIdentityRegistry(packageValue);
  const lanePlan = buildQueryLanePlan({ packageValue, portfolio, identityRegistry, options });
  return { packageValue, portfolio, identityRegistry, lanePlan };
}

test("target queries compile CF1 meaning without executing CF1 seeds verbatim", async () => {
  const { lanePlan } = await plan();
  const lanes = lanePlan.lanes.filter((x) => x.queryClass === "target_evidence");
  assert.ok(lanes.every((x) => x.source === "er1_structured_query_compiler"));
  assert.ok(lanes.every((x) => x.legacyQueryHints.every((hint) => hint.query !== x.query)));
  assert.ok(lanes.every((x) => x.fieldsUsed.includes("bearingCriteria.mustMatch")));
});

test("discovery lanes are evidence roles, never assigned source stances", async () => {
  const { lanePlan } = await plan();
  const lanes = lanePlan.lanes.filter((x) => x.queryClass === "target_evidence");
  const prohibited = new Set(["support", "refute", "qualify"]);
  assert.ok(lanes.every((x) => x.evidenceRole && !prohibited.has(x.evidenceRole)));
  assert.ok(lanes.every((x) => !("bearingGoal" in x) && !("stance" in x)));
});

test("falsifiability fields select role-diverse lanes without becoming stance labels", async () => {
  const { lanePlan } = await plan();
  for (const targetId of new Set(lanePlan.lanes.map((x) => x.targetId).filter(Boolean))) {
    const lanes = lanePlan.lanes.filter((x) => x.targetId === targetId);
    assert.deepEqual(new Set(lanes.map((x) => x.falsifiabilityBasis)),
      new Set(["wouldSupportIf", "wouldRefuteIf", "wouldQualifyIf"]));
    assert.ok(new Set(lanes.map((x) => x.evidenceRole)).size >= 2, targetId);
  }
});

test("queries avoid stance hunting and do not mix logical opposites", async () => {
  const { packageValue, portfolio, lanePlan } = await plan();
  const review = buildQueryQualityReview({ lanePlan,
    providerQueries: buildProviderQueries(lanePlan, portfolio), packageValue });
  assert.deepEqual(review.literalStanceHuntingQueries, []);
  assert.deepEqual(review.logicalOppositeMixes, []);
  assert.deepEqual(review.providerQueryLaneTypesUsingStanceLabels, []);
});

test("generic context is deferred while a specific opponent work gets provenance routing", async () => {
  const { lanePlan } = await plan();
  const deferred = new Map(lanePlan.deferredContextWorks.map((x) => [x.workLabel, x.classification]));
  assert.equal(deferred.get("Several epidemiologic studies"), "generic_context_phrase");
  const entry = { workLabel: "Example disputed study", workType: "study_or_case_series",
    workAuthors: ["Example Author"], publicationYear: "1998", publicationVenue: "Journal",
    identifiers: { doi: [], pmid: [], canonicalUrls: [] } };
  const decision = classifyContextWork(entry);
  assert.equal(contextWorkQuery(entry, decision.classification).laneFamily,
    "opponent_or_claim_provenance");
});

test("DSM-IV and IDEA context work receive soft target routing without becoming target evidence", async () => {
  const { lanePlan } = await plan();
  for (const label of ["DSM-IV", "Individuals with Disabilities Education Act"]) {
    const lane = lanePlan.lanes.find((x) => x.queryClass === "context_work_resolution" &&
      x.query.includes(label));
    assert.ok(lane, label);
    assert.ok(lane.relatedTargetIds.includes("T003"), label);
    assert.ok(lane.appliesToTaskIds.length, label);
    assert.equal(lane.queryClass, "context_work_resolution");
  }
});

test("DOI and full article title remain restricted to identity lanes", async () => {
  const { packageValue, lanePlan } = await plan();
  const title = packageValue.article.title.toLowerCase();
  for (const lane of lanePlan.lanes.filter((x) => x.queryClass !== "identity_resolution")) {
    assert.equal(/\b10\.\d{4,9}\//i.test(lane.query), false, lane.query);
    assert.equal(lane.query.toLowerCase().includes(title), false, lane.query);
  }
});

test("provider requests preserve roles but contain no stance or bearing fields", async () => {
  const { portfolio, lanePlan } = await plan();
  const queries = buildProviderQueries(lanePlan, portfolio, { maxProviderQueriesGlobal: 40,
    maxIdentityResolutionQueries: 6, maxContextWorkQueries: 2,
    maxTargetEvidenceQueriesGlobal: 24, maxProviderQueriesPerTarget: 3 });
  assert.ok(queries.selected.every((x) => Array.isArray(x.requestedEvidenceRoles)));
  const text = JSON.stringify(queries);
  assert.equal(text.includes('"stance"'), false);
  assert.equal(text.includes('"bearingScore"'), false);
  assert.equal(text.includes('"requestedGoals"'), false);
});

test("target query budgets cover every target before granting additional lanes", () => {
  const tasks = Array.from({ length: 9 }, (_, index) => ({
    taskId: `task-${index + 1}`, targets: [{ targetId: `T${index + 1}` }],
  }));
  const lanes = tasks.flatMap((task) => task.targets.flatMap((target) =>
    ["primary_result", "reanalysis_or_correction", "subgroup_or_scope"].map((laneFamily) => ({
      laneId: `${target.targetId}-${laneFamily}`, taskId: task.taskId,
      selectedClaimId: `S${target.targetId.slice(1)}`, targetId: target.targetId,
      query: `${target.targetId} ${laneFamily}`, queryClass: "target_evidence",
      laneType: laneFamily, laneFamily, evidenceRole: laneFamily,
    }))));
  const queries = buildProviderQueries({ lanes }, { tasks }, {
    maxTargets: 9, maxProviderQueriesGlobal: 24,
    maxTargetEvidenceQueriesGlobal: 24, maxProviderQueriesPerTarget: 3,
  });
  assert.deepEqual(new Set(queries.selected.map((query) => query.targetId)),
    new Set(tasks.map((task) => task.targets[0].targetId)));
});

test("normal discovery budget allows up to five queries for every selected claim", () => {
  const tasks = Array.from({ length: 10 }, (_, index) => ({
    taskId: `task-${index + 1}`, targets: [{ targetId: `T${index + 1}` }],
  }));
  const lanes = tasks.flatMap((task) => task.targets.flatMap((target) =>
    Array.from({ length: 5 }, (_, index) => ({
      laneId: `${target.targetId}-${index}`, taskId: task.taskId,
      selectedClaimId: `S${target.targetId.slice(1)}`, targetId: target.targetId,
      query: `${target.targetId} query ${index}`, queryClass: "target_evidence",
      laneType: `role_${index}`, laneFamily: `role_${index}`, evidenceRole: `role_${index}`,
    }))));
  const queries = buildProviderQueries({ lanes }, { tasks }, {
    maxTargets: 10, maxProviderQueriesGlobal: 55,
    maxTargetEvidenceQueriesGlobal: 50, maxProviderQueriesPerTarget: 5,
  });
  assert.equal(queries.selected.length, 50);
  assert.ok(tasks.every((task) => queries.selected.filter((query) =>
    query.taskId === task.taskId).length === 5));
});

test("offline 2A.2 review emits safety and terminology diagnostics", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "er1-2a2-"));
  const result = await runQueryPlanningReview({ packagePath, outputDir, options });
  assert.equal(result.qualityReview.artifactFieldAudit.stanceFieldPresent, false);
  assert.equal(result.qualityReview.artifactFieldAudit.bearingScoreFieldPresent, false);
  assert.deepEqual(result.qualityReview.prohibitedOperations, {
    sourceBodyFetches: 0, scrapes: 0, pdfExtractions: 0, modelCalls: 0,
    databaseReads: 0, databaseWrites: 0, migrations: 0, projections: 0,
  });
});
