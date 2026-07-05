import assert from "node:assert/strict";
import test from "node:test";

import {
  boundCandidateUnion,
  deriveVerifiedDocumentRole,
  orderForLlmBearing,
  resolveSurvivalBounds,
} from "../../src/core/candidateSurvival.js";

// §8 executable acceptance test for claim 54064
// ("data linking the MMR vaccine to autism had been manipulated by the CDC.").
//
// If raw provider search finds these documents, none of them may be dropped
// before bearing (stage "pool" / "pre_bearing") unless an explicit reason is
// logged. This test replays a representative raw-result fixture through the
// candidate-survival gates and asserts survival.

const rawProviderResults = [
  {
    url: "https://archive.cdc.gov/www_cdc_gov/vaccinesafety/concerns/autism/cdc2004pediatrics.html",
    title: "CDC Statement: 2004 MMR and Autism Study | Vaccine Safety | CDC",
    snippet: "CDC statement regarding the 2004 DeStefano MMR and autism study.",
    score: 0.5,
    provider: "tavily",
    purposeLane: "official_response",
    evidenceTargetType: "substantive",
  },
  {
    url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
    title: "Age at first measles-mumps-rubella vaccination in children with autism",
    snippet: "DeStefano 2004 Pediatrics.",
    bearingText: "Case-control study of age at first MMR vaccination among children with autism in metropolitan Atlanta.",
    bearingTextSource: "pubmed_abstract",
    academicApiContent: { apiBacked: true, identifiers: { pmid: "14754936" } },
    score: 0.3,
    provider: "pubmed",
    purposeLane: "study_identity",
    evidenceTargetType: "original_study",
  },
  {
    url: "https://example.org/thompson-statement",
    title: "Statement of William W. Thompson, Ph.D., Regarding the 2004 Article",
    snippet: "William Thompson statement issued through his lawyer regarding the 2004 study.",
    score: 0.45,
    provider: "brave",
    purposeLane: "attribution_record",
    identityRole: "attribution_document",
    evidenceTargetType: "attribution",
  },
  {
    url: "https://doi.org/10.1016/j.taap.2013.12.017",
    title: "Hooker reanalysis of MMR vaccination and autism data",
    snippet: "Reanalysis / retraction discussion of the DeStefano cohort.",
    academicApiContent: { apiBacked: true, identifiers: { doi: "10.1016/j.taap.2013.12.017" } },
    score: 0.35,
    provider: "openalex",
    purposeLane: "independent_reanalysis",
    identityRole: "reanalysis",
    evidenceTargetType: "systematic_review",
  },
  {
    url: "https://www.cdc.gov/media/releases/2014/response-mmr-autism.html",
    title: "CDC / coauthor response on MMR autism data analysis",
    snippet: "Official response addressing allegations about the 2004 analysis.",
    score: 0.4,
    provider: "tavily",
    purposeLane: "official_response",
    evidenceTargetType: "official_statement",
  },
  {
    url: "https://edition.cnn.com/2014/08/27/health/irpt-cdc-autism-vaccine-study",
    title: "Journal questions validity of autism and vaccine study | CNN",
    snippet: "News coverage of the reanalysis controversy.",
    score: 0.45,
    provider: "brave",
    purposeLane: "source_context",
    evidenceTargetType: "other",
  },
  // The GlobeNewswire press release that previously poisoned resolution.
  {
    url: "https://www.globenewswire.com/news-release/2016/05/03/836249/0/en/CDC-Whistleblower-to-Extend-MMR-Vaccine-Fraud.html",
    title: "CDC Whistleblower to Extend MMR Vaccine Fraud",
    snippet: "Press release.",
    score: 0.55,
    provider: "brave",
    purposeLane: "alleged_conduct",
    identityRole: "original_study", // deliberately mislabeled by discovery
    evidenceTargetType: "original_study",
  },
];

const MUST_SURVIVE = [
  "https://archive.cdc.gov/www_cdc_gov/vaccinesafety/concerns/autism/cdc2004pediatrics.html",
  "https://pubmed.ncbi.nlm.nih.gov/14754936/",
  "https://example.org/thompson-statement",
  "https://doi.org/10.1016/j.taap.2013.12.017",
  "https://www.cdc.gov/media/releases/2014/response-mmr-autism.html",
];

test("54064: key MMR/CDC documents survive the coarse pre-bearing pool union", () => {
  const bounds = resolveSurvivalBounds({});
  const { kept, dropped } = boundCandidateUnion({ candidates: rawProviderResults, bounds });
  const keptUrls = new Set(kept.map((c) => c.url));
  const droppedUrls = new Set(dropped.map((d) => d.candidate.url));

  for (const url of MUST_SURVIVE) {
    assert.ok(keptUrls.has(url), `expected ${url} to survive the pool union`);
    assert.ok(!droppedUrls.has(url), `expected ${url} not to be dropped at the pool stage`);
  }
});

test("54064: the GlobeNewswire press release is classified as advocacy/press release, never an original study", () => {
  const pr = rawProviderResults.find((c) => c.url.includes("globenewswire"));
  const role = deriveVerifiedDocumentRole(pr);
  assert.equal(role.role, "advocacy_or_press_release_candidate");
  assert.equal(role.verified, false);
});

test("54064: key documents enter the LLM bearing batch under the default cap", () => {
  // With the default LLM cap (12) the whole 54064 fixture fits, so every key
  // document reaches the LLM bearing classifier.
  const bounds = resolveSurvivalBounds({});
  const withDet = rawProviderResults.map((c) => ({
    ...c,
    deterministicBearingScore: deriveVerifiedDocumentRole(c)?.verified ? 0.6 : 0.2,
  }));
  const { ordered, llmBatchSize } = orderForLlmBearing({ candidates: withDet, bounds });
  const batch = ordered.slice(0, llmBatchSize).map((c) => c.url);
  for (const url of MUST_SURVIVE) {
    assert.ok(batch.includes(url), `expected ${url} in the LLM bearing batch`);
  }
});

test("54064: verified documents are reserved ahead of high-provider-score noise under a tight cap", () => {
  // A tiny cap must still reserve verified documents; the unverified primary
  // statement survives the pool (see the pool test) but need not enter a tiny
  // LLM batch. High provider score alone never buys a slot.
  const bounds = resolveSurvivalBounds({ maxLlmBearingCandidatesPerClaim: 2, maxVerifiedDocumentCandidates: 2 });
  const withDet = rawProviderResults.map((c) => ({
    ...c,
    deterministicBearingScore: deriveVerifiedDocumentRole(c)?.verified ? 0.6 : 0.2,
  }));
  const { ordered, llmBatchSize } = orderForLlmBearing({ candidates: withDet, bounds });
  const batch = ordered.slice(0, llmBatchSize);
  assert.equal(llmBatchSize, 2);
  assert.ok(batch.every((c) => deriveVerifiedDocumentRole(c)?.verified), "tight batch should be all verified docs");
  // The high-provider-score press release (0.55) is not in the batch.
  assert.ok(!batch.some((c) => c.url.includes("globenewswire")));
});
