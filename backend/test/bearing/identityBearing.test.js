import assert from "node:assert/strict";
import test from "node:test";

import {
  applyIdentityBearing,
  buildIdentityDocumentLink,
  classifyIdentityBearingCandidate,
} from "../../src/core/identityBearing.js";
import { selectCandidatesForClaim } from "../../src/core/evidenceCandidateSelector.js";
import { normalizeBearingGatingConfig } from "../../src/core/bearingConfig.js";

const claim = {
  id: 53164,
  text: "Data linking the MMR vaccine to autism had been manipulated by the CDC.",
  evaluationTargets: [
    { evaluationTargetId: 105, targetType: "substantive", verdictEligible: true },
    { evaluationTargetId: 106, targetType: "study_identity", verdictEligible: false },
  ],
  retrievalContexts: [{
    evaluationTargetId: 106,
    evaluationTargetType: "study_identity",
    resolvedWorks: [{
      title: "Age at first measles-mumps-rubella vaccination in children with autism and school-matched control subjects",
      authors: "Frank DeStefano, William Thompson",
      year: 2004,
      identifier: "PMID 14754936; DOI 10.1542/peds.113.2.259",
      url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
    }],
  }],
};

test("exact PMID receives protected original-study identity bearing", () => {
  const result = classifyIdentityBearingCandidate(claim, {
    id: "study",
    url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
    title: "Age at first MMR vaccination in children with autism",
  });
  assert.equal(result.protectedDocumentIdentity, true);
  assert.equal(result.identityBearingScore, 1);
  assert.equal(result.identityBearingType, "original_study");
  assert.equal(result.identityTargetId, 106);
});

test("a related reanalysis does not receive the exact-work override", () => {
  const result = classifyIdentityBearingCandidate(claim, {
    id: "reanalysis",
    url: "https://example.org/reanalysis",
    title: "Measles-mumps-rubella vaccination timing and autism: a reanalysis of CDC data",
    snippet: "This paper reanalyzes the 2004 DeStefano and Thompson study, Age at first measles-mumps-rubella vaccination in children with autism and school-matched control subjects.",
  });
  assert.equal(result.protectedDocumentIdentity, undefined);
});

test("generic topic overlap does not receive wildcard identity bearing", () => {
  const result = classifyIdentityBearingCandidate(claim, {
    id: "generic",
    url: "https://example.org/mmr-overview",
    title: "MMR vaccines and autism: an overview",
    snippet: "A general overview of vaccine safety research.",
  });
  assert.equal(result.protectedDocumentIdentity, undefined);
});

test("only the exact identified study receives reserved selection", () => {
  const candidates = applyIdentityBearing(claim, [
    {
      id: "ordinary",
      url: "https://example.org/high-bearing",
      bearingPreScore: 0.99,
      deterministicBearingScore: 0.99,
      bearingType: "direct",
      claimComponentAddressed: "whole_claim",
    },
    {
      id: "original",
      url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
      bearingPreScore: 0.05,
    },
    {
      id: "reanalysis",
      url: "https://example.org/reanalysis",
      title: "MMR vaccination timing and autism: a reanalysis of CDC data",
      snippet: "A reanalysis of the DeStefano Thompson 2004 Age at first measles-mumps-rubella vaccination in children with autism and school-matched control subjects study.",
      bearingPreScore: 0.08,
    },
  ]);
  const config = normalizeBearingGatingConfig({
    enableBearingGating: true,
    maxIdentitySlotsPerClaim: 2,
    perClaimLimits: { pillar_support: 3, default: 3 },
  }, {});
  const selected = selectCandidatesForClaim(
    { ...claim, role: "pillar_support" },
    candidates,
    config,
  ).selectedCandidates;
  assert.deepEqual(selected.map((candidate) => candidate.id), ["original", "ordinary"]);
  assert.equal(selected[0].gatingSelectionReason, "document_identity_slot");
});

test("three verified study-object roles survive ordinary candidate ranking", () => {
  const verified = [
    ["original", "original_study", 1],
    ["cdc", "official_study_page", 0.9],
    ["hooker", "reanalysis", 0.8],
  ].map(([id, identityBearingType, identityBearingScore]) => ({
    id,
    url: `https://example.org/${id}`,
    protectedDocumentIdentity: true,
    identityBearingType,
    identityBearingScore,
    bearingPreScore: 0.05,
  }));
  const selected = selectCandidatesForClaim(
    { ...claim, role: "pillar_support" },
    [
      { id: "ordinary", url: "https://example.org/ordinary", bearingPreScore: 0.99 },
      ...verified,
    ],
    normalizeBearingGatingConfig({
      enableBearingGating: true,
      maxIdentitySlotsPerClaim: 2,
      perClaimLimits: { pillar_support: 3, default: 3 },
    }, {}),
  ).selectedCandidates;
  assert.deepEqual(selected.map((candidate) => candidate.id), ["original", "cdc", "hooker"]);

  const boundedPlan = selectCandidatesForClaim(
    { ...claim, role: "pillar_support" },
    [{ id: "ordinary", url: "https://example.org/ordinary", bearingPreScore: 0.99 }, ...verified],
    normalizeBearingGatingConfig({
      enableBearingGating: true,
      maxIdentitySlotsPerClaim: 2,
      perClaimLimits: { pillar_support: 2, default: 2 },
    }, {}),
  );
  assert.deepEqual(boundedPlan.rankedCandidates.slice(0, 3).map((candidate) => candidate.id), [
    "original",
    "cdc",
    "hooker",
  ]);
});

test("query intent alone cannot manufacture origin protection", () => {
  const plan = selectCandidatesForClaim(claim, [{
    id: "press",
    url: "https://example.org/press",
    bearingPreScore: 0.01,
    evidenceTargetType: "original_study",
    stanceGoal: "origin",
    bearingType: "origin",
  }], normalizeBearingGatingConfig({ enableBearingGating: true }, {}));
  assert.equal(plan.decisions[0].reason, "below_bearing_threshold");
  assert.equal(plan.selectedCandidates[0].gatingSelectionReason, "single_best_fallback");
});

test("identity document link is strong, claim-scoped, and explicitly non-verdict", () => {
  const candidate = classifyIdentityBearingCandidate(claim, {
    url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
    title: "The identified study",
  });
  const link = buildIdentityDocumentLink({
    candidate,
    refData: {
      referenceContentId: 17001,
      title: candidate.title,
      snippet: "PubMed metadata for the identified study.",
      claimIndices: [7],
    },
  });
  assert.equal(link.scrapeStatus, "identity_only");
  assert.equal(link.stance, "insufficient");
  assert.equal(link.documentOnly, true);
  assert.equal(link.quality, 1);
  assert.deepEqual(link.claims, [7]);
  assert.match(link.why, /does not establish/i);
});
