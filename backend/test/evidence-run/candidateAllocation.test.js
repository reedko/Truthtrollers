import test from "node:test";
import assert from "node:assert/strict";
import { allocateCandidatesFairly } from "../../src/evidence-run/candidateAllocator.js";
import { dedupeCandidates } from "../../src/evidence-run/candidateTriage.js";

function candidate(id, targetId, family, score = 0.3, queryClass = "target_evidence") {
  return { candidateId: `er1cand_${id}`, targetIds: targetId ? [targetId] : [],
    identityTaskIds: [], queryLaneIds: [`lane-${id}`], sourceRoleHints: [],
    routeProvenance: [{ provider: "mock", query: id, rank: 1, targetId,
      queryClass, laneFamily: family, contextForTargetIds: queryClass === "context_work_resolution"
        ? ["T008"] : [], providerQueryId: `query-${id}`, queryLaneIds: [`lane-${id}`] }],
    retrievalPromiseScore: score, retrievalPromiseReasons: ["requested_source_role"],
    preFetchStatus: "candidate", rank: 1, normalizedUrl: `https://example.test/${id}`,
    canonicalUrl: null, url: `https://example.test/${id}`, title: id, snippet: "useful snippet",
    identifiers: { doi: [], pmid: [], pmcid: [] }, diagnostics: [], dedupeKey: `url:${id}` };
}

const limits = { maxCandidatesGlobal: 20, maxCandidatesPerTarget: 10,
  maxSameDomainPerTarget: 10, minNormalizedCandidatesPerTarget: 3,
  minNormalizedCandidatesPerTargetLaneFamily: 1,
  minContextWorkCandidatesGlobal: 2, maxContextWorkCandidatesGlobal: 4 };

test("fair allocation prevents late targets and context work from execution-order starvation", () => {
  const rows = [];
  for (const target of ["T001", "T007", "T008"]) for (let i = 0; i < 6; i += 1) {
    rows.push(candidate(`${target}-${i}`, target, i % 2 ? "primary_result" : "subgroup_or_scope",
      target === "T001" ? 0.4 : 0.25));
  }
  rows.push(candidate("DSM-1", null, "context_work_resolution", 0.2, "context_work_resolution"));
  rows.push(candidate("IDEA-1", null, "official_or_legal_context", 0.2, "context_work_resolution"));
  const result = allocateCandidatesFairly(rows, limits);
  assert.equal(result.candidates.length, 20);
  for (const target of ["T001", "T007", "T008"]) {
    assert.ok(result.candidates.filter((x) => x.targetIds.includes(target)).length >= 3, target);
  }
  assert.equal(result.candidates.filter((x) => x.routeProvenance
    .some((r) => r.queryClass === "context_work_resolution")).length, 2);
  assert.equal(result.diagnostics.globalCapAppliedAfterFairAllocation, true);
  assert.deepEqual(result.diagnostics.targetsWithCandidatesButZeroAllocated, []);
});

test("dedupe preserves target, lane family, query class, and context route provenance", () => {
  const first = candidate("one", "T001", "primary_result");
  const second = { ...candidate("two", "T008", "reanalysis_or_correction"),
    normalizedUrl: first.normalizedUrl, url: first.url, dedupeKey: first.dedupeKey };
  const context = { ...candidate("three", null, "context_work_resolution", 0.2,
    "context_work_resolution"), normalizedUrl: first.normalizedUrl, url: first.url,
    dedupeKey: first.dedupeKey };
  const result = dedupeCandidates([first, second, context], "er1run_test");
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(new Set(result.candidates[0].targetIds), new Set(["T001", "T008"]));
  assert.equal(result.candidates[0].routeProvenance.length, 3);
  assert.deepEqual(new Set(result.candidates[0].routeProvenance.map((x) => x.laneFamily)),
    new Set(["primary_result", "reanalysis_or_correction", "context_work_resolution"]));
  assert.ok(result.candidates[0].routeProvenance.some((x) =>
    x.queryClass === "context_work_resolution" && x.contextForTargetIds.includes("T008")));
});

test("allocation never emits stance or bearingScore", () => {
  const result = allocateCandidatesFairly([candidate("safe", "T008", "primary_result")], limits);
  const text = JSON.stringify(result);
  assert.equal(text.includes('"stance"'), false);
  assert.equal(text.includes('"bearingScore"'), false);
});
