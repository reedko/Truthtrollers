import test from "node:test";
import assert from "node:assert/strict";
import { selectCandidatePortfolio, isEvaluatedArticleCopy, primaryIdentityFromRegistry }
  from "../../src/evidence-run/candidatePortfolioSelector.js";

// Neutral fixture — a municipal-transparency article, NOT F01/vaccine. "Works on F01"
// must never be mistaken for "works," so nothing here names a debugging fixture.
const EVAL_DOI = "10.5555/ledger.2025.004";
function candidate(id, { target = null, family = "primary_result", queryClass = "target_evidence",
  score = 0.3, title = id, url = `https://${id}.example/work`, doi = [], pmid = [], body } = {}) {
  return { candidateId: `er1cand_${id}`, title, url, normalizedUrl: url, targetIds: target ? [target] : [],
    retrievalPromiseScore: score, preFetchStatus: score >= 0.45 ? "promising" : "candidate",
    identifiers: { doi, pmid, pmcid: [] }, sourceRoleHints: [], rank: 1,
    routeProvenance: [{ laneFamily: family, queryClass, targetId: target,
      contextForTargetIds: queryClass === "context_work_resolution" ? [target || "T003"] : [] }],
    fetchedBody: body };
}

// The evaluated article is a city-audit report with its own DOI; some candidates are
// copies/syndications of it (the clones the runtime cap must catch, generically).
const PRIMARY_IDENTITY = { doi: [EVAL_DOI], pmid: [], canonicalUrls: [], titleTokens: [] };

function fixture(body = "ignored") {
  return [
    candidate("eval-copy-a", { target: "T001", score: 0.88, doi: [EVAL_DOI],
      title: "City Bridge Procurement Audit 2025", url: "https://records.example/audit", body }),
    candidate("eval-copy-b", { target: "T002", score: 0.82, doi: [EVAL_DOI],
      title: "City Bridge Procurement Audit 2025 (mirror)", url: "https://mirror.example/audit.pdf" }),
    candidate("eval-copy-c", { target: "T003", score: 0.8, doi: [EVAL_DOI],
      title: "City Bridge Procurement Audit 2025 (reprint)", url: "https://reprint.example/audit" }),
    candidate("indep-review", { target: "T004", family: "reanalysis_or_correction", score: 0.34,
      title: "Independent procurement timeline review" }),
    candidate("method", { target: "T005", family: "methodology_or_limitation", score: 0.31,
      title: "Audit methodology and sampling" }),
    candidate("subgroup", { target: "T006", family: "subgroup_or_scope", score: 0.29,
      title: "Milestone-level delay breakdown" }),
    candidate("late7", { target: "T007", family: "reanalysis_or_correction", score: 0.25 }),
    candidate("late8", { target: "T008", family: "primary_result", score: 0.24 }),
    candidate("statute", { target: "T003", family: "context_work_resolution",
      queryClass: "context_work_resolution", score: 0.12, title: "Municipal procurement statute" }),
    candidate("agency", { target: "T006", family: "official_or_legal_context", score: 0.27,
      url: "https://city.example/procurement", title: "City procurement office record" }),
    candidate("high-generic", { target: "T001", score: 0.44, title: "Unrelated high-score item" }),
  ];
}

const opts = (over = {}) => ({ primaryIdentity: PRIMARY_IDENTITY, ...over });

test("runtime clone detection is generic (identifier / URL / title), no hardcoded fixture", () => {
  assert.equal(isEvaluatedArticleCopy(
    { identifiers: { doi: [EVAL_DOI] }, title: "x", url: "y" }, PRIMARY_IDENTITY), true);
  assert.equal(isEvaluatedArticleCopy(
    { identifiers: {}, title: "unrelated", url: "https://other.example" }, PRIMARY_IDENTITY), false);
  // Degrades to zero with no identity — never guesses a clone.
  assert.equal(isEvaluatedArticleCopy({ identifiers: { doi: [EVAL_DOI] } }, null), false);
});

test("portfolio is a bounded allocator: caps, coverage, provenance — but NO source roles", () => {
  const plan = selectCandidatePortfolio(fixture(), opts());
  assert.equal(plan.schemaVersion, "er1.candidatePortfolioPlan.v2");
  assert.ok(plan.portfolioSelectedCount <= 12);
  assert.ok(plan.coverage.targetIds.includes("T007"));
  assert.ok(plan.coverage.targetIds.includes("T008"));
  assert.ok(plan.coverage.laneFamilies.length >= 4);
  // Runtime clone cap works off the evaluated article's DOI — no PRIMARY_DOI constant.
  assert.ok(plan.counts.evaluatedArticleCopies <= 2);
  assert.ok(plan.candidates.some((x) => x.contextCandidate && x.preFetchStatus !== "promising"));
  // No source-type classification anywhere in the output.
  const text = JSON.stringify(plan);
  assert.equal(text.includes("sourceRoleLabels"), false);
  assert.equal(text.includes("sourceRoles"), false);
  assert.equal(text.includes("advocacy"), false);
  assert.equal(text.includes("bearingScore"), false);
  assert.equal(text.includes("stance"), false);
  assert.equal(text.includes("fetchedBody"), false);
  assert.deepEqual(plan.prohibitedOperations, { sourceBodyFetches: 0, scrapes: 0,
    pdfExtractions: 0, modelCalls: 0, databaseReads: 0, databaseWrites: 0,
    migrations: 0, projections: 0 });
});

test("the evaluated article's own copies are capped, not allowed to dominate", () => {
  const plan = selectCandidatePortfolio(fixture(), opts({ maxAcquisitionCandidatesGlobal: 6 }));
  assert.ok(plan.counts.evaluatedArticleCopies <= 2);
  assert.ok(plan.candidates.some((x) => x.primaryArticleCopy
    && x.selectionReasons.includes("bounded_primary_work_copy")));
});

test("fetched body text cannot influence portfolio selection", () => {
  const first = selectCandidatePortfolio(fixture("body saying select me"), opts());
  const second = selectCandidatePortfolio(fixture("completely different acquired content"), opts());
  assert.deepEqual(first, second);
});

test("works with no primary identity at all (degrades, still allocates)", () => {
  const plan = selectCandidatePortfolio(fixture(), { });
  assert.equal(plan.counts.evaluatedArticleCopies, 0);
  assert.ok(plan.portfolioSelectedCount > 0);
  assert.ok(plan.coverage.targetIds.length >= 4);
});

test("portfolio covers every target with candidates before selecting extras", () => {
  const candidates = Array.from({ length: 9 }, (_, index) =>
    candidate(`target-${index + 1}`, { target: `T00${index + 1}`, score: 0.3 - index / 100 }));
  candidates.push(candidate("extra-high", { target: "T001", score: 0.9 }));
  const plan = selectCandidatePortfolio(candidates, opts({
    maxAcquisitionCandidatesGlobal: 9, minTargetsCoveredIfAvailable: 9 }));
  assert.deepEqual(plan.coverage.targetIds,
    Array.from({ length: 9 }, (_, index) => `T00${index + 1}`));
  assert.deepEqual(plan.coverage.unresolvedTargetIds, []);
});
