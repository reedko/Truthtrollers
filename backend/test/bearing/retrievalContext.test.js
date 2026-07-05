import assert from "node:assert/strict";
import test from "node:test";

import { EvidenceEngine } from "../../src/core/evidenceEngine.js";
import {
  buildRetrievalContextsForClaim,
  retrievalContextForTarget,
} from "../../src/core/retrievalContext.js";

const THOMPSON_OBJECT = "Data linking the MMR vaccine to autism had been manipulated by the CDC.";

function thompsonClaim() {
  return {
    id: 52881,
    text: THOMPSON_OBJECT,
    originalText: "William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC.",
    objectClaim: THOMPSON_OBJECT,
    speakerEntity: "William Thompson",
    namedEntities: ["William Thompson", "CDC"],
    studiesOrDocuments: ["MMR/autism study"],
    evidenceNeed: {
      mustIncludeTerms: ["MMR", "CDC"],
      subjectTerms: ["CDC", "MMR", "autism"],
    },
    evaluationTargets: [{
      evaluationTargetId: 72,
      targetType: "substantive",
      targetText: "CDC researchers improperly omitted or altered analyses from the MMR/autism study.",
      subjectEntity: "CDC researchers",
      allegedAction: "omitted or altered analyses",
      objectText: "MMR/autism study data",
      searchEligible: true,
      verdictEligible: true,
    }],
  };
}

test("R2 keeps the Thompson object claim atomic while adding source-backed discovery context", () => {
  const claim = thompsonClaim();
  const original = structuredClone(claim);
  const articleText = [
    "The article discussed vaccine policy.",
    "William Thompson was a co-author of a 2004 CDC study involving MMR vaccination and autism in metropolitan Atlanta.",
    "The dispute concerned analyses of a subgroup and the authors' handling of the data.",
  ].join(" ");
  const [context] = buildRetrievalContextsForClaim(claim, { articleText });

  assert.equal(context.objectClaimText, THOMPSON_OBJECT);
  assert.equal(context.evaluationTargetId, 72);
  assert.equal(context.evaluationTargetType, "substantive");
  assert.ok(context.speakerEntities.includes("William Thompson"));
  assert.ok(context.organizations.some((value) => /CDC/i.test(value)));
  assert.ok(context.dates.includes("2004"));
  assert.match(context.articlePassageContext, /2004 CDC study involving MMR vaccination and autism/);
  assert.equal(context.studyResolutionRequired, true);
  assert.ok(context.studyClues.includes("Referenced study/document identity unresolved"));
  assert.ok(context.requiredAnchors.some((value) => /MMR/i.test(value)));
  assert.deepEqual(claim, original, "context construction must not rewrite the atomic claim or metadata");
});

test("R2 does not promote unresolved clues into resolved works", () => {
  const [unresolved] = buildRetrievalContextsForClaim(thompsonClaim(), {
    articleText: "William Thompson discussed the 2004 MMR autism study.",
  });
  assert.deepEqual(unresolved.resolvedWorks, []);

  const resolvedClaim = thompsonClaim();
  resolvedClaim.evaluationTargets[0] = {
    ...resolvedClaim.evaluationTargets[0],
    studyTitle: "Age at first measles-mumps-rubella vaccination in children with autism",
    studyAuthors: "DeStefano et al.",
    studyYear: 2004,
    studyIdentifier: "PMID 14754936",
    resolutionStatus: "resolved",
  };
  const [resolved] = buildRetrievalContextsForClaim(resolvedClaim);
  assert.equal(resolved.studyResolutionRequired, false);
  assert.equal(resolved.resolvedWorks[0].identifier, "PMID 14754936");
});

test("broad claims requesting credible evidence do not invent an unresolved study", () => {
  const [context] = buildRetrievalContextsForClaim({
    id: 53541,
    text: "The claims made by public health authorities regarding vaccines are based on false narratives and lack credible evidence.",
    objectClaim: "The claims made by public health authorities regarding vaccines are based on false narratives and lack credible evidence.",
    evaluationTargets: [{
      evaluationTargetId: 133,
      targetType: "substantive",
      targetText: "The claims made by public health authorities regarding vaccines are based on false narratives and lack credible evidence.",
      objectText: "Public-health vaccine claims lack credible evidence.",
    }],
  });
  assert.equal(context.studyResolutionRequired, false);
  assert.ok(!context.studyClues.includes("Referenced study/document identity unresolved"));
});

test("retained study works stay scoped to their assigned evaluation target", () => {
  const claim = thompsonClaim();
  claim.evaluationTargets = [
    { evaluationTargetId: 71, targetType: "attribution", targetText: "Thompson made the allegation." },
    { evaluationTargetId: 72, targetType: "substantive", targetText: THOMPSON_OBJECT },
    { evaluationTargetId: 73, targetType: "study_identity", targetText: "Resolve the 2004 study." },
  ];
  claim.resolvedWorks = [{
    title: "Hooker reanalysis",
    url: "https://doi.org/10.1186/2047-9158-3-16",
    identityRole: "reanalysis",
    evaluationTargetId: 72,
    evaluationTargetType: "substantive",
  }];
  const contexts = buildRetrievalContextsForClaim(claim);
  assert.equal(contexts.find((context) => context.evaluationTargetId === 71).resolvedWorks.length, 0);
  assert.equal(contexts.find((context) => context.evaluationTargetId === 72).resolvedWorks.length, 1);
  assert.equal(contexts.find((context) => context.evaluationTargetId === 73).resolvedWorks.length, 0);
});

test("R2 shares the same target context with provider routing and candidate provenance", async () => {
  const claim = thompsonClaim();
  claim.retrievalContexts = buildRetrievalContextsForClaim(claim, {
    articleText: "William Thompson discussed a 2004 CDC MMR autism study.",
  });
  claim.retrievalContext = claim.retrievalContexts[0];
  const providerCalls = [];
  const engine = new EvidenceEngine({
    search: {
      internal: async () => [],
      web: async (options) => {
        providerCalls.push(options);
        return [{ id: "source", url: "https://example.org/source", title: "Source", score: 0.8 }];
      },
    },
  });
  const [candidate] = await engine.retrieveCandidates(claim, [{
    query: "William Thompson CDC MMR study",
    intent: "refute",
    evidenceTargetId: 72,
    evidenceTargetType: "substantive",
  }], {
    enableInternal: false,
    enableWeb: true,
    topKQueries: 1,
    topKCandidates: 3,
  });

  assert.equal(providerCalls[0].retrievalContext, retrievalContextForTarget(claim, 72));
  assert.equal(candidate.retrievalContext, claim.retrievalContexts[0]);
});
