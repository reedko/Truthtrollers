import assert from "node:assert/strict";
import test from "node:test";

import {
  DROP_STAGES,
  boundCandidateUnion,
  deriveVerifiedDocumentRole,
  mergeCanonicalOccurrence,
  orderForLlmBearing,
  resolveSurvivalBounds,
} from "../../src/core/candidateSurvival.js";

test("verified document role is derived from the document's own properties, not query purpose", () => {
  // A press release returned by an "original study" query is NOT an original study.
  const pressRelease = {
    url: "https://www.globenewswire.com/news-release/2016/05/03/836249/0/en/CDC-Whistleblower-to-Extend-MMR-Vaccine-Fraud.html",
    title: "CDC Whistleblower to Extend MMR Vaccine Fraud",
    evidenceTargetType: "original_study", // query asked for a study
    identityRole: "original_study",        // discovery mislabeled it
  };
  const role = deriveVerifiedDocumentRole(pressRelease);
  assert.equal(role.role, "advocacy_or_press_release_candidate");
  assert.equal(role.verified, false);

  const pubmed = {
    url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
    title: "Age at first measles-mumps-rubella vaccination in children with autism",
  };
  const pubmedRole = deriveVerifiedDocumentRole(pubmed);
  assert.equal(pubmedRole.role, "original_study_candidate");
  assert.equal(pubmedRole.verified, true);

  const officialPage = { url: "https://archive.cdc.gov/www_cdc_gov/vaccinesafety/concerns/autism/cdc2004pediatrics.html", title: "CDC Statement: 2004 MMR and Autism Study" };
  assert.equal(deriveVerifiedDocumentRole(officialPage).verified, true);
});

test("dedupe keeps the richest bearing text and unions all provenance", () => {
  const weak = {
    url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
    title: "Study",
    snippet: "short",
    score: 0.9,
    provider: "brave",
    query: "q1",
    purposeLane: "study_identity",
    targetProvenance: [{ query: "q1", provider: "brave" }],
  };
  const rich = {
    url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
    title: "Study",
    snippet: "short",
    bearingText: "A much longer API-backed abstract describing MMR vaccination timing and autism outcomes in the cohort.",
    bearingTextSource: "pubmed_abstract",
    academicApiContent: { apiBacked: true },
    score: 0.4,
    provider: "pubmed",
    query: "q2",
    purposeLane: "original_document",
    targetProvenance: [{ query: "q2", provider: "pubmed" }],
  };
  const merged = mergeCanonicalOccurrence(weak, rich);
  assert.match(merged.bearingText, /API-backed abstract/);
  assert.equal(merged.bearingTextSource, "pubmed_abstract");
  // All provenance retained regardless of provider score.
  const queries = merged.targetProvenance.map((p) => p.query).sort();
  assert.deepEqual(queries, ["q1", "q2"]);
});

test("bounded union preserves input order and never cuts by provider score under caps", () => {
  const candidates = [
    { url: "https://a", purposeLane: "alleged_conduct", score: 0.2, snippet: "aaaa" },
    { url: "https://b", purposeLane: "alleged_conduct", score: 0.9, snippet: "bb" },
    { url: "https://c", purposeLane: "official_response", score: 0.5, snippet: "cccc" },
  ];
  const { kept, dropped } = boundCandidateUnion({ candidates, bounds: resolveSurvivalBounds({}) });
  assert.equal(dropped.length, 0);
  assert.deepEqual(kept.map((c) => c.url), ["https://a", "https://b", "https://c"]);
});

test("bounded union caps a lane but keeps verified documents and logs drops with reasons", () => {
  const bounds = resolveSurvivalBounds({ maxCandidatesPerPurposeLane: 1 });
  const candidates = [
    { url: "https://weak", purposeLane: "alleged_conduct", score: 0.9, snippet: "x" },
    { url: "https://rich", purposeLane: "alleged_conduct", score: 0.1, snippet: "a much longer snippet that carries more bearing text than the first" },
    { url: "https://pubmed.ncbi.nlm.nih.gov/14754936/", purposeLane: "alleged_conduct", title: "study" }, // verified, bypasses cap
  ];
  const { kept, dropped } = boundCandidateUnion({ candidates, bounds });
  const keptUrls = kept.map((c) => c.url);
  // Verified doc always survives.
  assert.ok(keptUrls.includes("https://pubmed.ncbi.nlm.nih.gov/14754936/"));
  // Lane capped at 1 non-verified: the richer of the two non-verified survives.
  assert.ok(keptUrls.includes("https://rich"));
  assert.ok(!keptUrls.includes("https://weak"));
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].reason, /max_candidates_per_purpose_lane/);
});

test("LLM ordering prioritizes verified docs and deterministic bearing, not provider score", () => {
  const bounds = resolveSurvivalBounds({ maxLlmBearingCandidatesPerClaim: 2, maxVerifiedDocumentCandidates: 1 });
  const candidates = [
    { url: "https://noise-high-provider", score: 0.99, deterministicBearingScore: 0.1, snippet: "x" },
    { url: "https://high-bearing", score: 0.2, deterministicBearingScore: 0.8, snippet: "y" },
    { url: "https://pubmed.ncbi.nlm.nih.gov/14754936/", score: 0.05, deterministicBearingScore: 0.05, title: "verified but thin" },
  ];
  const { ordered, excludedFromLlm, llmBatchSize } = orderForLlmBearing({ candidates, bounds });
  // Verified doc is reserved into the batch even with a thin snippet / low scores.
  assert.equal(ordered[0].url, "https://pubmed.ncbi.nlm.nih.gov/14754936/");
  // Next comes the high deterministic-bearing candidate, not the high provider score.
  assert.equal(ordered[1].url, "https://high-bearing");
  assert.equal(llmBatchSize, 2);
  // The high-provider-score / low-bearing noise is excluded from the LLM batch.
  assert.deepEqual(excludedFromLlm.map((c) => c.url), ["https://noise-high-provider"]);
});

test("DROP_STAGES exposes the fixed canonical stage enum for audits", () => {
  assert.equal(DROP_STAGES.RAW_RESULT, "raw_result");
  assert.equal(DROP_STAGES.CANONICAL_MERGE, "canonical_merge");
  assert.equal(DROP_STAGES.PRE_BEARING_POOL, "pre_bearing_pool");
  assert.equal(DROP_STAGES.DETERMINISTIC_BEARING_GATE, "deterministic_bearing_gate");
  assert.equal(DROP_STAGES.LLM_BEARING_BATCH, "llm_bearing_batch");
  assert.equal(DROP_STAGES.LLM_BEARING_RESULT, "llm_bearing_result");
  assert.equal(DROP_STAGES.GATING, "gating");
  assert.equal(DROP_STAGES.ADAPTIVE_SCRAPE, "adaptive_scrape");
  assert.equal(DROP_STAGES.PACKET_SELECTION, "packet_selection");
});
