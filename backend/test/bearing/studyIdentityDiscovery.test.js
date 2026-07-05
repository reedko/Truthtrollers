import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMappingItem } from "../../src/core/argumentMappingEngine.js";
import { buildRetrievalContextsForClaim } from "../../src/core/retrievalContext.js";
import {
  buildStudyIdentityDiscoveryQueries,
  discoverStudyIdentities,
  resolveStudyIdentityCandidates,
} from "../../src/core/studyIdentityDiscovery.js";

const visibleClaim = "William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC.";
const objectClaim = "Data linking the MMR vaccine to autism had been manipulated by the CDC.";

test("R3 deterministically adds a non-verdict study-identity target when mapping omits it", () => {
  const mapped = normalizeMappingItem({
    claimId: 52881,
    objectClaim,
    isAttribution: true,
    speakerEntity: "William Thompson",
    targets: [{
      targetType: "substantive",
      targetText: objectClaim,
      subjectEntity: "CDC",
      allegedAction: "manipulated",
      objectText: "MMR/autism study data",
    }],
  }, { id: 52881, text: visibleClaim });

  const studyTarget = mapped.targets.find((target) => target.targetType === "study_identity");
  assert.ok(studyTarget);
  assert.equal(studyTarget.searchEligible, true);
  assert.equal(studyTarget.verdictEligible, false);
  assert.equal(studyTarget.resolutionStatus, "underspecified");
  assert.match(studyTarget.targetText, /Resolve the exact study/);
});

function discoveryContext() {
  return {
    objectClaimText: objectClaim,
    targetText: "Resolve the exact MMR/autism study referenced by William Thompson.",
    speakerEntities: ["William Thompson"],
    organizations: ["CDC"],
    dates: ["2004"],
    populations: ["metropolitan Atlanta"],
    requiredAnchors: ["William Thompson", "CDC", "MMR", "autism", "2004"],
  };
}

test("R3 discovery queries are compact natural anchor queries", () => {
  const queries = buildStudyIdentityDiscoveryQueries(discoveryContext());
  assert.ok(queries.length >= 1 && queries.length <= 2);
  assert.match(queries[0], /William Thompson/);
  assert.match(queries[0], /CDC/);
  assert.match(queries[0], /2004/);
  assert.match(queries[0], /MMR/i);
});

test("R3 resolves PMID 14754936 and rejects the related review PMID 14761240", () => {
  const resolution = resolveStudyIdentityCandidates([
    {
      url: "https://pubmed.ncbi.nlm.nih.gov/14761240/",
      title: "MMR vaccine and autism: an update of the scientific evidence",
      publishedAt: "2004",
      provider: "pubmed",
      academicMetadata: { pmid: "14761240", authors: ["Some Reviewer"] },
    },
    {
      url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
      title: "Age at first measles-mumps-rubella vaccination in children with autism and school-matched control subjects: a population-based study in metropolitan Atlanta",
      publishedAt: "2004",
      provider: "pubmed",
      academicMetadata: {
        pmid: "14754936",
        doi: "10.1542/peds.113.2.259",
        authors: ["Frank DeStefano", "William W Thompson"],
        journal: "Pediatrics",
      },
    },
  ], discoveryContext());

  assert.equal(resolution.status, "resolved");
  assert.match(resolution.resolvedWork.identifier, /PMID 14754936/);
  assert.match(resolution.resolvedWork.identifier, /DOI 10\.1542\/peds\.113\.2\.259/);
  assert.equal(resolution.resolvedWork.population, "metropolitan Atlanta");
  assert.match(resolution.resolvedWork.title, /metropolitan Atlanta/);
});

test("study-object discovery rejects a press release while retaining the CDC page and Hooker reanalysis", () => {
  const resolution = resolveStudyIdentityCandidates([
    {
      url: "https://www.globenewswire.com/news-release/2016/05/03/example.html",
      title: "CDC Whistleblower to Extend MMR Vaccine Fraud",
      publishedAt: "2016",
      provider: "brave",
    },
    {
      url: "https://archive.cdc.gov/www_cdc_gov/vaccinesafety/concerns/autism/cdc2004pediatrics.html",
      title: "CDC Statement: 2004 MMR and Autism Study | Vaccine Safety | CDC",
      provider: "tavily",
    },
    {
      url: "https://link.springer.com/article/10.1186/2047-9158-3-16",
      title: "Measles-mumps-rubella vaccination timing and autism among young African American boys: a reanalysis of CDC data",
      publishedAt: "2014",
      provider: "tavily",
    },
  ], {
    ...discoveryContext(),
    articlePassageContext: "Thompson discussed the 2004 study results and alleged that CDC data were manipulated.",
  });

  assert.equal(resolution.primaryStudy.identityRole, "official_study_page");
  assert.match(resolution.primaryStudy.url, /archive\.cdc\.gov/);
  assert.equal(resolution.relatedAnalyses.length, 1);
  assert.match(resolution.relatedAnalyses[0].url, /10\.1186\/2047-9158-3-16/);
  const globe = resolution.rejectedCandidates.find((candidate) => /globenewswire/.test(candidate.url));
  assert.equal(globe.identityRole, "press_release");
  assert.equal(globe.rejectionReason, "press_release_not_study_identity");
});

test("R3 does not resolve an identified but topically wrong CDC publication", () => {
  const resolution = resolveStudyIdentityCandidates([{
    url: "https://doi.org/10.3389/fped.2015.00018",
    title: "Do the Benefits of Male Circumcision Outweigh the Risks? A Critique of the Proposed CDC Guidelines",
    publishedAt: "2015",
    provider: "openalex",
    academicMetadata: { doi: "10.3389/fped.2015.00018", authors: ["Brian D. Earp"] },
  }], {
    targetText: "Resolve the study behind the CDC announcement that no more vaccine-autism research would be funded.",
    requiredAnchors: ["CDC", "vaccines", "autism", "research funding"],
    organizations: ["CDC"],
  });
  assert.equal(resolution.status, "unresolved");
  assert.equal(resolution.resolvedWork, null);
  assert.equal(resolution.reason, "insufficient_identity_anchors");
});

test("R3 stores a resolved work only on the separate study-identity target", async () => {
  const updates = [];
  const claim = {
    id: 52881,
    text: objectClaim,
    originalText: visibleClaim,
    objectClaim,
    speakerEntity: "William Thompson",
    namedEntities: ["William Thompson", "CDC"],
    dates: ["2004"],
    evidenceNeed: { mustIncludeTerms: ["MMR", "CDC"], subjectTerms: ["MMR", "autism"] },
    evaluationTargets: [{
      evaluationTargetId: 73,
      targetType: "study_identity",
      targetText: "Resolve the exact MMR/autism study.",
      objectText: "MMR/autism study",
      searchEligible: true,
      verdictEligible: false,
    }],
  };
  claim.retrievalContexts = buildRetrievalContextsForClaim(claim, {
    articleText: "William Thompson was a coauthor of a 2004 CDC MMR autism study.",
  });
  claim.retrievalContext = claim.retrievalContexts[0];
  const query = async (sql, params) => {
    updates.push({ sql, params });
    return { affectedRows: 1 };
  };
  const search = {
    web: async () => [{
      url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
      title: "Age at first measles-mumps-rubella vaccination in children with autism and school-matched control subjects",
      publishedAt: "2004",
      provider: "pubmed",
      academicMetadata: { pmid: "14754936", authors: ["Frank DeStefano", "William W Thompson"], journal: "Pediatrics" },
    }],
  };

  await discoverStudyIdentities({ query, taskContentId: 16386, claims: [claim], search });

  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /UPDATE claim_evaluation_targets/);
  assert.equal(updates[0].params[3], "PMID 14754936");
  assert.equal(updates[0].params[6], 73);
  assert.equal(claim.evaluationTargets[0].resolutionStatus, "resolved");
  assert.equal(claim.evaluationTargets[0].verdictEligible, false, "identity resolution does not become a substantive verdict");
});

test("official CDC discovery triggers academic-only resolution and retains original, official page, and reanalysis", async () => {
  const calls = [];
  const updates = [];
  const claim = {
    id: 54064,
    text: objectClaim,
    originalText: visibleClaim,
    objectClaim,
    speakerEntity: "William Thompson",
    namedEntities: ["William Thompson", "CDC"],
    evaluationTargets: [
      { evaluationTargetId: 173, targetType: "substantive", targetText: objectClaim, verdictEligible: true },
      { evaluationTargetId: 174, targetType: "study_identity", targetText: "Resolve the exact 2004 MMR/autism study.", verdictEligible: false },
    ],
  };
  claim.retrievalContexts = buildRetrievalContextsForClaim(claim, {
    articleText: "William Thompson discussed the 2004 study results and alleged that CDC data were manipulated.",
  });
  claim.retrievalContext = claim.retrievalContexts[1];
  const webCandidates = [
    { url: "https://archive.cdc.gov/www_cdc_gov/vaccinesafety/concerns/autism/cdc2004pediatrics.html", title: "CDC Statement: 2004 MMR and Autism Study | Vaccine Safety | CDC", provider: "tavily" },
    { url: "https://link.springer.com/article/10.1186/2047-9158-3-16", title: "Measles-mumps-rubella vaccination timing and autism among young African American boys: a reanalysis of CDC data", publishedAt: "2014", provider: "tavily" },
    { url: "https://www.globenewswire.com/news-release/2016/05/03/example.html", title: "CDC Whistleblower to Extend MMR Vaccine Fraud", publishedAt: "2016", provider: "brave" },
  ];
  const search = {
    web: async (options) => {
      calls.push(options);
      if (options.retrievalMode === "study_bibliographic_resolution") {
        return [{
          url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
          title: "Age at first measles-mumps-rubella vaccination in children with autism and school-matched control subjects: a population-based study in metropolitan Atlanta",
          publishedAt: "2004",
          provider: "pubmed",
          academicMetadata: {
            pmid: "14754936",
            doi: "10.1542/peds.113.2.259",
            authors: ["Frank DeStefano", "William W Thompson"],
            journal: "Pediatrics",
          },
        }];
      }
      return webCandidates;
    },
  };
  const query = async (sql, params) => {
    updates.push({ sql, params });
    return { affectedRows: 1 };
  };

  await discoverStudyIdentities({ query, taskContentId: 16833, claims: [claim], search });

  assert.ok(calls.some((call) => call.retrievalMode === "study_bibliographic_resolution"));
  assert.ok(calls.filter((call) => call.retrievalMode === "study_bibliographic_resolution")
    .every((call) => call.onlyProviders.join(",") === "pubmed,crossref,openalex"));
  assert.equal(updates.length, 1);
  assert.match(updates[0].params[3], /PMID 14754936/);
  assert.deepEqual(claim.resolvedWorks.map((work) => work.identityRole).sort(), [
    "official_study_page",
    "original_study",
    "reanalysis",
  ]);
  assert.ok(claim.resolvedWorks.every((work) => work.identityTargetId === 174));
  assert.ok(claim.resolvedWorks.every((work) => work.evaluationTargetId === 173));
});
