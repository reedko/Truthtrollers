import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAnchoredQueryPack,
  buildDeterministicAnchoredQueries,
  validateAnchoredQuery,
} from "../../src/core/anchoredQueryPack.js";

const context = {
  evaluationTargetId: 72,
  evaluationTargetType: "substantive",
  objectClaimText: "Data linking the MMR vaccine to autism had been manipulated by the CDC.",
  targetText: "CDC researchers improperly omitted analyses from the MMR/autism study.",
  speakerEntities: ["William Thompson"],
  organizations: ["CDC"],
  dates: ["2004"],
  populations: ["metropolitan Atlanta"],
  allegedActions: ["omitted analyses"],
  requiredAnchors: ["William Thompson", "CDC", "MMR", "autism", "2004"],
  resolvedWorks: [{
    title: "Age at first measles-mumps-rubella vaccination in children with autism",
    authors: "DeStefano, William W Thompson",
    year: 2004,
    identifier: "PMID 14754936; DOI 10.1542/peds.113.2.259",
    population: "metropolitan Atlanta",
  }],
  studyResolutionRequired: false,
};

test("R4 rejects bare names and generic mechanical suffixes", () => {
  assert.deepEqual(validateAnchoredQuery("William Thompson", context, "substantive").valid, false);
  assert.deepEqual(
    validateAnchoredQuery("William Thompson primary source corroboration", context, "substantive").valid,
    false,
  );
});

test("R4 deterministic fallbacks fill distinct purpose lanes and retain identity across the pack", () => {
  const queries = buildDeterministicAnchoredQueries(context, { claimId: 52881 });
  assert.equal(queries.length, 3);
  // Each query pursues a DISTINCT purpose lane (evidentiary job), not a stance.
  const lanes = queries.map((query) => query.purposeLane);
  assert.equal(new Set(lanes).size, queries.length);
  assert.ok(queries.every((query) => !["support", "refute", "nuance"].includes(query.purposeLane)));
  for (const query of queries) {
    assert.equal(validateAnchoredQuery(query.query, context, "substantive").valid, true, query.query);
    assert.match(query.query, /MMR|autism|measles-mumps-rubella/i);
  }
  // Identity anchors are retained across the pack as a whole (not forced into
  // every lane — that is the narrative-anchor bias we removed).
  const combined = queries.map((query) => query.query).join(" ");
  assert.match(combined, /CDC/);
  assert.match(combined, /2004|PMID 14754936/);
});

test("R4 anchored pack drops bad generated queries and preserves numeric target routing", () => {
  const claim = { id: 52881, retrievalContexts: [context], retrievalContext: context };
  const pack = buildAnchoredQueryPack({
    claim,
    existingQueries: [
      { query: "William Thompson", intent: "support", evidenceTargetId: 72, evidenceTargetType: "substantive" },
      { query: "William Thompson CDC 2004 MMR autism omitted analyses", intent: "support", evidenceTargetId: 72, evidenceTargetType: "substantive" },
    ],
    limit: 9,
  });
  assert.ok(pack.rejected.some((item) => item.query === "William Thompson"));
  assert.ok(pack.queries.length >= 3);
  assert.ok(pack.queries.every((query) => query.evidenceTargetId === 72));
  assert.ok(pack.queries.every((query) => !/^William Thompson$/i.test(query.query)));
});

test("eligible thesis receives a deterministic fallback when validation rejects every query", () => {
  const thesisContext = {
    evaluationTargetId: 133,
    evaluationTargetType: "substantive",
    targetText: "Public health vaccine claims are based on false narratives and lack credible evidence.",
    objectClaimText: "Public health vaccine claims are based on false narratives and lack credible evidence.",
    requiredAnchors: [],
    resolvedWorks: [],
    studyResolutionRequired: true,
  };
  const pack = buildAnchoredQueryPack({
    claim: { id: 53541, text: thesisContext.targetText, retrievalContexts: [thesisContext] },
    existingQueries: [{
      query: "the",
      intent: "nuance",
      evidenceTargetId: 133,
      evidenceTargetType: "substantive",
    }],
  });
  assert.equal(pack.queries.length, 1);
  assert.equal(pack.queries[0].deterministicFallback, true);
  assert.equal(pack.queries[0].evidenceTargetId, 133);
  assert.match(pack.queries[0].query, /public health vaccine claims/i);
});
