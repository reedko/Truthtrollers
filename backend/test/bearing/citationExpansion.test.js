import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCitationDerivedCandidates,
  extractPdfTextWithFallback,
  isRejectableEvidenceUrl,
  resolvedWorkCandidatesForClaim,
} from "../../src/core/citationExpansion.js";
import { EvidenceEngine } from "../../src/core/evidenceEngine.js";
import { normalizeBearingGatingConfig } from "../../src/core/bearingConfig.js";
import { classifyClaimSubjectStudyCandidate } from "../../src/core/identityBearing.js";

test("bibliography DOI, PMID, and PMCID identifiers do not become evidence candidates", () => {
  const candidates = extractCitationDerivedCandidates({
    text: "See PMID: 14754936, doi:10.1542/peds.113.2.259 and PMCID PMC123456.",
    sourceCandidate: {
      url: "https://abc.example/report",
      title: "ABC report",
      query: "Thompson CDC study",
      evidenceTargetId: 72,
      evidenceTargetType: "substantive",
    },
  });
  assert.deepEqual(candidates, []);
});

test("citation proximity cannot manufacture wildcard identity bearing", () => {
  const citation = {
    url: "https://doi.org/10.1542/peds.113.2.259",
    citationDerived: true,
    citationContext: "MMR vaccine autism CDC data study",
    evidenceTargetId: 123,
  };
  const classified = classifyClaimSubjectStudyCandidate({
    evaluationTargets: [
      { evaluationTargetId: 123, targetType: "attribution", targetText: "William Thompson made an allegation." },
      { evaluationTargetId: 124, targetType: "substantive", targetText: "Data linking the MMR vaccine to autism was manipulated by the CDC." },
    ],
  }, citation);

  assert.equal(classified.protectedDocumentIdentity, undefined);
  assert.equal(classified.evidenceTargetId, 123);
});

test("bibliography depth does not reactivate citation discovery", () => {
  const decoys = Array.from({ length: 8 }, (_, index) =>
    `Unrelated reference doi:10.1000/decoy-${index + 1}`
  ).join(". ");
  const candidates = extractCitationDerivedCandidates({
    text: `${decoys}. MMR vaccination and autism study doi:10.1542/peds.113.2.259`,
    sourceCandidate: { url: "https://example.test/bibliography" },
  });
  assert.deepEqual(candidates, []);
});

test("citation candidates returned by a fetcher are ignored", async () => {
  const fetched = [];
  const first = "https://example.test/generic-report";
  const study = "https://doi.org/10.1542/peds.113.2.259";
  const engine = new EvidenceEngine({
    fetcher: {
      async getText(candidate) {
        fetched.push(candidate.url);
        return {
          isProcessed: true,
          cleanText: "Direct evidence text with enough content for evaluation. ".repeat(4),
          citationCount: candidate.url === first ? 1 : 0,
          citationCandidates: candidate.url === first ? [{
            id: `citation:${study}`,
            url: study,
            title: "DOI 10.1542/peds.113.2.259",
            citationDerived: true,
            citationContext: "Age at first measles-mumps-rubella vaccination in children with autism and school-matched control subjects.",
            evidenceTargetId: 123,
            evidenceTargetType: "attribution",
          }] : [],
        };
      },
    },
    extractQuotesAndScoreQuality: async ({ url }) => ({
      quotes: [{
        quote: `Direct evidence from ${url}`,
        stance: "support",
        bearing_score: 0.9,
        bearing_type: "direct",
        claim_component_addressed: "whole_claim",
        bearing_reason: "Direct.",
      }],
      qualityScores: null,
    }),
  });
  const claim = {
    id: 53259,
    text: "William Thompson said CDC data were manipulated.",
    evaluationTargets: [
      { evaluationTargetId: 123, targetType: "attribution", verdictEligible: true, targetText: "William Thompson made the allegation." },
      { evaluationTargetId: 124, targetType: "substantive", verdictEligible: true, targetText: "Data linking the MMR vaccine to autism was manipulated by the CDC." },
    ],
  };
  const config = normalizeBearingGatingConfig({
    enableBearingGating: true,
    minDeliveredSourcesPerContent: 1,
    maxSourceAttemptsPerContent: 1,
    minBearingLinksPerClaim: 1,
    maxSourcesComparedPerClaim: 1,
    maxIdentitySlotsPerClaim: 2,
    minHighBearingClaimsPerTarget: 1,
  }, {});

  await engine._runAdaptiveExtractionRoundRobin([{ plan: {
    claim,
    rankedCandidates: [{ id: "generic", url: first, evidenceTargetId: 123, evidenceTargetType: "attribution" }],
  } }], { bearingConfig: config, maxSourcesToScrapePerTarget: 1, maxEvidencePerDoc: 2 });

  assert.deepEqual(fetched, [first]);
});

test("R6 turns an R3 resolved work into a primary-source candidate", () => {
  const candidates = resolvedWorkCandidatesForClaim({
    retrievalContexts: [{
      evaluationTargetId: 72,
      evaluationTargetType: "substantive",
      resolvedWorks: [{
        title: "Age at first measles-mumps-rubella vaccination in children with autism",
        identifier: "PMID 14754936; DOI 10.1542/peds.113.2.259",
        year: 2004,
      }],
    }],
  });
  assert.equal(candidates[0].url, "https://pubmed.ncbi.nlm.nih.gov/14754936/");
  assert.equal(candidates[0].evidenceTargetId, 72);
  assert.equal(candidates[0].bearingType, "origin");
});

test("R6 resolved-work dedupe preserves every target assignment", () => {
  const work = { title: "Study", identifier: "PMID 14754936", year: 2004 };
  const [candidate] = resolvedWorkCandidatesForClaim({
    retrievalContexts: [
      { evaluationTargetId: 71, evaluationTargetType: "attribution", resolvedWorks: [work] },
      { evaluationTargetId: 72, evaluationTargetType: "substantive", resolvedWorks: [work] },
    ],
  });
  assert.deepEqual(candidate.targetProvenance.map((item) => item.evidenceTargetId), [71, 72]);
});

test("verified original, official page, and reanalysis become protected target-scoped candidates", () => {
  const candidates = resolvedWorkCandidatesForClaim({
    retrievalContexts: [{
      evaluationTargetId: 72,
      evaluationTargetType: "substantive",
      resolvedWorks: [
        { title: "Original", identifier: "PMID 14754936", identityRole: "original_study", verifiedDocumentIdentity: true, identityScore: 1, identityTargetId: 73, evaluationTargetId: 72, evaluationTargetType: "substantive" },
        { title: "CDC page", url: "https://archive.cdc.gov/study", identityRole: "official_study_page", verifiedDocumentIdentity: true, identityScore: 0.8, identityTargetId: 73, evaluationTargetId: 72, evaluationTargetType: "substantive" },
        { title: "Hooker", url: "https://doi.org/10.1186/2047-9158-3-16", identityRole: "reanalysis", verifiedDocumentIdentity: true, identityScore: 0.7, identityTargetId: 73, evaluationTargetId: 72, evaluationTargetType: "substantive" },
      ],
    }],
  });
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((candidate) => candidate.protectedDocumentIdentity));
  assert.ok(candidates.every((candidate) => candidate.identityTargetId === 73));
  assert.ok(candidates.every((candidate) => candidate.evidenceTargetId === 72));
  assert.deepEqual(candidates.map((candidate) => candidate.identityRole).sort(), ["official_study_page", "original_study", "reanalysis"]);
});

test("R6 PDF fallback runs before an empty high-value PDF is rejected", async () => {
  const result = await extractPdfTextWithFallback(Buffer.from("pdf"), {
    primaryParser: async () => ({ text: "", numpages: 2 }),
    fallbackParser: async () => ({ text: "Recovered primary-source statement ".repeat(5), numpages: 2 }),
  });
  assert.equal(result.method, "pdf_parse_direct");
  assert.ok(result.text.length >= 100);
  assert.deepEqual(result.attempts.map((attempt) => attempt.method), ["pdf_parse_default", "pdf_parse_direct"]);
});

test("a discovered citation is not followed even when the claim still needs links", async () => {
  const fetched = [];
  const first = "https://abc.example/report";
  const primary = "https://pubmed.ncbi.nlm.nih.gov/14754936/";
  const engine = new EvidenceEngine({
    fetcher: {
      async getText(candidate) {
        fetched.push(candidate.url);
        return {
          isProcessed: true,
          cleanText: "Source text with enough content for direct target evaluation. ".repeat(3),
          citationCount: candidate.url === first ? 1 : 0,
          citationCandidates: candidate.url === first ? [{
            id: "citation:14754936",
            url: primary,
            title: "PMID 14754936",
            evidenceTargetId: 72,
            evidenceTargetType: "substantive",
            citationDerived: true,
          }] : [],
        };
      },
    },
    extractQuotesAndScoreQuality: async ({ url }) => ({
      quotes: [{
        quote: `Direct evidence from ${url}`,
        stance: "support",
        bearing_score: 0.9,
        bearing_type: "direct",
        claim_component_addressed: "whole_claim",
        bearing_reason: "Direct.",
      }],
      qualityScores: null,
    }),
  });
  const claim = {
    id: 52881,
    text: "CDC omitted analyses.",
    evaluationTargets: [{ evaluationTargetId: 72, targetType: "substantive", verdictEligible: true }],
  };
  const config = normalizeBearingGatingConfig({
    enableBearingGating: true,
    minDeliveredSourcesPerContent: 1,
    maxSourceAttemptsPerContent: 2,
    // Two links required, so after the first source the claim still needs one
    // more and the appended citation is reached through the normal need gate.
    minBearingLinksPerClaim: 2,
    maxSourcesComparedPerClaim: 2,
    minHighBearingClaimsPerTarget: 1,
  }, {});
  const run = await engine._runAdaptiveExtractionRoundRobin([{ plan: {
    claim,
    rankedCandidates: [{ id: "abc", url: first, evidenceTargetId: 72, evidenceTargetType: "substantive" }],
  } }], { bearingConfig: config, maxSourcesToScrapePerTarget: 2, maxEvidencePerDoc: 2 });

  assert.deepEqual(fetched, [first]);
  assert.equal(run.attemptedUrls.size, 1);
});

test("citation candidates neither queue-jump nor append after ranked candidates", async () => {
  const fetched = [];
  const first = "https://abc.example/report";
  const rankedB = "https://bcd.example/second-ranked";
  const primary = "https://pubmed.ncbi.nlm.nih.gov/14754936/";
  const engine = new EvidenceEngine({
    fetcher: {
      async getText(candidate) {
        fetched.push(candidate.url);
        return {
          isProcessed: true,
          cleanText: "Source text with enough content for direct target evaluation. ".repeat(3),
          citationCount: candidate.url === first ? 1 : 0,
          citationCandidates: candidate.url === first ? [{
            id: "citation:14754936",
            url: primary,
            title: "PMID 14754936",
            evidenceTargetId: 72,
            evidenceTargetType: "substantive",
            citationDerived: true,
          }] : [],
        };
      },
    },
    extractQuotesAndScoreQuality: async ({ url }) => ({
      quotes: [{
        quote: `Direct evidence from ${url}`,
        stance: "support",
        bearing_score: 0.9,
        bearing_type: "direct",
        claim_component_addressed: "whole_claim",
        bearing_reason: "Direct.",
      }],
      qualityScores: null,
    }),
  });
  const claim = {
    id: 53117,
    text: "CDC omitted analyses.",
    evaluationTargets: [{ evaluationTargetId: 72, targetType: "substantive", verdictEligible: true }],
  };
  const config = normalizeBearingGatingConfig({
    enableBearingGating: true,
    minDeliveredSourcesPerContent: 1,
    maxSourceAttemptsPerContent: 5,
    // Keep the claim "needing links" long enough to drain the whole pool so we
    // can observe ordering; the pool is only three sources.
    minBearingLinksPerClaim: 5,
    maxSourcesComparedPerClaim: 5,
    minHighBearingClaimsPerTarget: 1,
  }, {});
  await engine._runAdaptiveExtractionRoundRobin([{ plan: {
    claim,
    rankedCandidates: [
      { id: "abc", url: first, evidenceTargetId: 72, evidenceTargetType: "substantive" },
      { id: "bcd", url: rankedB, evidenceTargetId: 72, evidenceTargetType: "substantive" },
    ],
  } }], { bearingConfig: config, maxSourcesToScrapePerTarget: 5, maxEvidencePerDoc: 2 });

  assert.deepEqual(fetched, [first, rankedB]);
});

test("R6 rejects a citation carrying a target from another claim (no leakage)", async () => {
  const fetched = [];
  const first = "https://abc.example/report";
  const foreignAsset = "https://pmc.ncbi.nlm.nih.gov/articles/PMC999999/";
  const engine = new EvidenceEngine({
    fetcher: {
      async getText(candidate) {
        fetched.push(candidate.url);
        return {
          isProcessed: true,
          cleanText: "Source text with enough content for direct target evaluation. ".repeat(3),
          citationCount: candidate.url === first ? 1 : 0,
          // Simulate the observed bug: an NCBI asset citation carrying target 89
          // that actually belongs to a sibling claim (53118), not this one.
          citationCandidates: candidate.url === first ? [{
            id: "citation:PMC999999",
            url: foreignAsset,
            title: "PMC999999",
            evidenceTargetId: 89,
            evidenceTargetType: "substantive",
            citationDerived: true,
          }] : [],
        };
      },
    },
    extractQuotesAndScoreQuality: async ({ url }) => ({
      quotes: [{
        quote: `Direct evidence from ${url}`,
        stance: "support",
        bearing_score: 0.9,
        bearing_type: "direct",
        claim_component_addressed: "whole_claim",
        bearing_reason: "Direct.",
      }],
      qualityScores: null,
    }),
  });
  const claim = {
    id: 53117,
    text: "Thompson allegation.",
    evaluationTargets: [{ evaluationTargetId: 72, targetType: "substantive", verdictEligible: true }],
  };
  const config = normalizeBearingGatingConfig({
    enableBearingGating: true,
    minDeliveredSourcesPerContent: 1,
    maxSourceAttemptsPerContent: 5,
    minBearingLinksPerClaim: 5,
    maxSourcesComparedPerClaim: 5,
    minHighBearingClaimsPerTarget: 1,
  }, {});
  const run = await engine._runAdaptiveExtractionRoundRobin([{ plan: {
    claim,
    rankedCandidates: [{ id: "abc", url: first, evidenceTargetId: 72, evidenceTargetType: "substantive" }],
  } }], { bearingConfig: config, maxSourcesToScrapePerTarget: 5, maxEvidencePerDoc: 2 });

  // The foreign-target citation must never be scraped and must never deliver
  // evidence onto this claim.
  assert.ok(!fetched.includes(foreignAsset));
  assert.deepEqual(fetched, [first]);
  const delivered = run.byClaimId.get(53117).evidence;
  assert.ok(delivered.every((item) => Number(item.evidenceTargetId) === 72));
});

test("R6 asset, script, style, favicon, and account URLs are rejected as evidence", () => {
  assert.equal(isRejectableEvidenceUrl("https://ncbi.nlm.nih.gov/static/app.js"), true);
  assert.equal(isRejectableEvidenceUrl("https://example.com/theme/site.css"), true);
  assert.equal(isRejectableEvidenceUrl("https://example.com/images/logo.png"), true);
  assert.equal(isRejectableEvidenceUrl("https://example.com/favicon.ico"), true);
  assert.equal(isRejectableEvidenceUrl("https://example.com/account/login"), true);
  assert.equal(isRejectableEvidenceUrl("/relative/path"), true);
  // Genuine evidence URLs are preserved.
  assert.equal(isRejectableEvidenceUrl("https://pubmed.ncbi.nlm.nih.gov/14754936/"), false);
  assert.equal(isRejectableEvidenceUrl("https://doi.org/10.1542/peds.113.2.259"), false);
  assert.equal(isRejectableEvidenceUrl("https://cdc.gov/report/vaccine-study.pdf"), false);

  // Bibliography extraction is retired entirely, including genuine DOI URLs.
  const candidates = extractCitationDerivedCandidates({
    text: "Widget at https://cdc.gov/report/widget.js and study https://doi.org/10.1/valid-study",
    sourceCandidate: { url: "https://src.example/article" },
  });
  assert.deepEqual(candidates, []);
});
