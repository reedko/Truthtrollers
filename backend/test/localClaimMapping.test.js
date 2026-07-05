import test from "node:test";
import assert from "node:assert/strict";

import { ClaimExtractor } from "../src/core/claimsEngine.js";
import {
  buildDeterministicClaimMapping,
  mapArgumentFunctions,
} from "../src/core/argumentMappingEngine.js";
import { groundLocalSourceExcerpt } from "../src/core/localClaimExtraction.js";

const THOMPSON_TEXT = "William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC.";
const THOMPSON_EXCERPT = "In 2014, William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC, the article alleges.";

function thompsonClaim(overrides = {}) {
  return {
    id: 53117,
    text: THOMPSON_TEXT,
    localSourceExcerpt: THOMPSON_EXCERPT,
    localRoleSuggestion: "pillar",
    finalRole: "pillar",
    articleStance: "endorses",
    namedActors: ["William Thompson", "CDC"],
    namedStudiesOrDocuments: [],
    allegedAction: "manipulated",
    claimType: {
      attribution: true,
      misconduct: true,
      disputed_study: true,
    },
    localExtractionConfidence: 0.9,
    documentThesis: "Public-health authorities concealed harms attributed to vaccines.",
    ...overrides,
  };
}

test("local excerpts are grounded in the actual chunk", () => {
  const chunk = `Opening material. ${THOMPSON_EXCERPT} Closing material.`;
  const excerpt = groundLocalSourceExcerpt(chunk, "A hallucinated excerpt", THOMPSON_TEXT);
  assert.match(excerpt, /William Thompson revealed/);
  assert.ok(excerpt.includes(THOMPSON_EXCERPT));
  assert.ok(chunk.includes(excerpt));
});

test("chunk workers consume every chunk and synthesis receives structured records, not the article body", async () => {
  const calls = [];
  const llm = {
    async generate(request) {
      calls.push(request);
      if (request.system.includes("Organize structured local claim records")) {
        assert.doesNotMatch(request.user, /BODY_ONLY_MARKER/);
        const records = JSON.parse(request.user.match(/STRUCTURED LOCAL CLAIMS:\n(.+)\n\nReturn:/s)[1]);
        return {
          globalThesis: records[0].claimText,
          globalPillars: [],
          claimRelationships: [],
          claimAssignments: records.map((record, index) => ({
            localClaimId: record.localClaimId,
            finalRole: index === 0 ? "thesis" : "evidence",
            articleStance: "endorses",
            thesisLoadScore: index === 0 ? 1 : 0.4,
          })),
        };
      }
      const chunkNumber = Number(request.user.match(/Chunk (\d)/)?.[1] || 0);
      return {
        localClaims: [{
          claimText: `Claim from chunk ${chunkNumber}.`,
          localSourceExcerpt: `Chunk ${chunkNumber} says this exact thing.`,
          localRoleSuggestion: chunkNumber === 1 ? "thesis" : "evidence",
          articleStance: "endorses",
          namedActors: [],
          namedStudiesOrDocuments: [],
          allegedAction: "",
          claimType: {},
          thesisCandidate: chunkNumber === 1,
          pillarCandidate: false,
          confidence: 0.9,
        }],
      };
    },
  };
  const query = async () => [];
  const extractor = new ClaimExtractor(llm, query);
  const chunks = Array.from({ length: 5 }, (_, index) => ({
    text: `Chunk ${index + 1} says this exact thing. ${index === 4 ? "BODY_ONLY_MARKER" : ""}`,
    tokenLength: 20,
  }));
  const result = await extractor.analyzeContent({ chunks, maxConcurrency: 3, contentRole: "case" });

  assert.equal(calls.filter((call) => call.system.includes("Extract locally verifiable claims")).length, 5);
  assert.equal(calls.filter((call) => call.system.includes("Organize structured local claim records")).length, 1);
  assert.deepEqual(result.claims, [
    "Claim from chunk 1.",
    "Claim from chunk 2.",
    "Claim from chunk 3.",
    "Claim from chunk 4.",
    "Claim from chunk 5.",
  ]);
});

test("Thompson metadata deterministically produces four distinct evaluation targets", () => {
  const claim = thompsonClaim();
  const before = structuredClone(claim);
  const mapped = buildDeterministicClaimMapping(claim);

  assert.deepEqual(claim, before, "target construction must not mutate the extracted local record");
  assert.equal(mapped.targetMappingUnresolved, false);
  assert.equal(mapped.speakerEntity, "William Thompson");
  assert.equal(mapped.articleStance, "endorses");
  assert.deepEqual(mapped.targets.map((target) => target.targetType), [
    "attribution",
    "substantive",
    "study_identity",
    "inference",
  ]);

  const attribution = mapped.targets[0];
  const substantive = mapped.targets[1];
  const study = mapped.targets[2];
  const inference = mapped.targets[3];
  assert.equal(attribution.subjectEntity, "William Thompson");
  assert.match(substantive.subjectEntity, /CDC/i);
  assert.equal(substantive.allegedAction, "manipulated");
  assert.match(substantive.objectText, /MMR vaccine to autism/i);
  assert.equal(study.verdictEligible, false);
  assert.equal(study.resolutionStatus, "underspecified");
  assert.match(inference.targetText, /concealed or misrepresented/i);
  assert.ok(mapped.targets.every((target) => target.sourceExcerpt.length > 0));
});

test("study identity uses the explicit study year rather than surrounding event dates", () => {
  const mapped = buildDeterministicClaimMapping(thompsonClaim({
    localSourceExcerpt: "In 2016 the film appeared. Thompson spoke privately in 2014. The article says the CDC's 2004 study results were manipulated.",
  }));
  const study = mapped.targets.find((target) => target.targetType === "study_identity");
  assert.equal(study.studyYear, 2004);
});

test("underspecified misconduct fails closed instead of creating a generic substantive target", () => {
  const mapped = buildDeterministicClaimMapping({
    id: 7,
    text: "A report alleged that evidence was manipulated.",
    localSourceExcerpt: "A report alleged that evidence was manipulated.",
    claimType: { attribution: true, misconduct: true, disputed_study: true },
    localExtractionConfidence: 0.3,
  });

  assert.equal(mapped.targetMappingUnresolved, true);
  assert.match(mapped.rationale, /^target_mapping_unresolved:/);
  assert.equal(mapped.targets.some((target) => target.targetType === "substantive"), false);
  assert.ok(mapped.targets.every((target) => target.verdictEligible === false));
});

test("live argument mapping sends one claim-local request and never includes the article body", async () => {
  const previous = process.env.ENABLE_MULTI_TARGET_EVIDENCE;
  process.env.ENABLE_MULTI_TARGET_EVIDENCE = "false";
  const llmCalls = [];
  const llm = {
    async generate(request) {
      llmCalls.push(request);
      return { mappingStatus: "underspecified", confidence: 0.8 };
    },
  };
  const query = async (sql) => {
    if (sql.includes("FROM llm_prompts")) return [];
    return { affectedRows: 1 };
  };
  try {
    const result = await mapArgumentFunctions({
      query,
      taskContentId: 16443,
      articleText: "ARTICLE_BODY_SENTINEL ".repeat(2000),
      claims: [thompsonClaim()],
      llm,
    });
    assert.equal(result.length, 1);
    assert.equal(llmCalls.length, 1);
    assert.doesNotMatch(llmCalls[0].user, /ARTICLE_BODY_SENTINEL/);
    assert.match(llmCalls[0].user, /ONE CLAIM:/);
    assert.match(llmCalls[0].user, /LOCAL SOURCE EXCERPT:/);
    assert.doesNotMatch(llmCalls[0].user, /CLAIMS:/);
  } finally {
    if (previous == null) delete process.env.ENABLE_MULTI_TARGET_EVIDENCE;
    else process.env.ENABLE_MULTI_TARGET_EVIDENCE = previous;
  }
});
