import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCfxDocumentBearingRequest,
  loadCfxDocumentBearingPrompt,
  runCfxDocumentBearingExtraction,
  resolveCfxLiteralAnchor,
  validateCfxDocumentBearingExtraction,
} from "../../../src/claimfoundry/cfx/evidenceBearing/documentExtraction.js";
import { buildCfxEvidenceBlocks } from "../../../src/claimfoundry/cfx/evidenceBearing/targetedExtraction.js";

const text = "The study found no association between MMR vaccination and autism.\n\nA second paragraph reports surveillance.";
const access = {
  candidateId:"DOC-1",accessLevel:"full_text" as const,textSource:"pmc" as const,
  text,characterCount:text.length,wordCount:text.split(/\s+/u).length,
  sourceUrl:"https://example.test",canonicalUrl:"https://example.test",
  doi:null,pmid:null,retrievalAttempts:[],accessDiagnostics:[],
};
const targets = [
  {propositionId:"P01",claimId:11,assertion:"MMR vaccination causes autism."},
  {propositionId:"P02",claimId:12,assertion:"A separate fixed assertion."},
];
const location = (excerpt:string) => ({
  page:null,section:null,paragraph:null,blockId:"E0001",
  charStart:text.indexOf(excerpt),charEnd:text.indexOf(excerpt)+excerpt.length,
});
const validAssertion = {
  evidenceAssertion:"The study found no association between MMR vaccination and autism.",
  bearingRelation:"challenges" as const,
  exactExcerpt:"The study found no association between MMR vaccination and autism.",
  sourceLocation:location("The study found no association between MMR vaccination and autism."),
  whyItBears:"It reports a directly relevant study result.",
  confidence:0.95,quality:0.9,limitationsVisibleInText:[],
};

test("one document request contains the complete fixed target inventory", async () => {
  const prompt = await loadCfxDocumentBearingPrompt();
  const built = buildCfxDocumentBearingRequest({
    documentId:"DOC-1",targets,access,prompt,model:"gpt-4o-mini",
    temperature:0.1,maxOutputTokens:6000,timeoutMs:180000,
  });
  assert.equal(built.request.retryCount, 0);
  assert.equal(built.request.store, false);
  assert.match(built.request.user, /propositionId: P01/u);
  assert.match(built.request.user, /propositionId: P02/u);
  assert.match(built.request.user, /\[E0001\]/u);
});

test("row-level validation preserves a valid sibling and quarantines an invalid excerpt", () => {
  const invalid = {
    ...validAssertion,
    evidenceAssertion:"An invented result.",
    exactExcerpt:"An invented result.",
    sourceLocation:{...validAssertion.sourceLocation,charStart:null,charEnd:null},
  };
  const result = validateCfxDocumentBearingExtraction({
    rawOutput:{
      documentId:"DOC-1",accessLevel:"full_text",
      targets:[
        {propositionId:"P01",noBearingAssertionsFound:false,assertions:[validAssertion]},
        {propositionId:"P02",noBearingAssertionsFound:false,assertions:[invalid]},
      ],
    },
    documentId:"DOC-1",targets,access,blocks:buildCfxEvidenceBlocks(text),
  });
  assert.equal(result.structurallyValid, true);
  assert.equal(result.acceptedTargets[0]?.assertions.length, 1);
  assert.equal(result.acceptedTargets[1]?.assertions.length, 0);
  assert.equal(result.diagnostics.some((row) => row.code === "EXACT_EXCERPT_NOT_FOUND"), true);
});

test("host derives exact coordinates when model coordinates are zero", () => {
  const returned = {
    ...validAssertion,
    sourceLocation:{...validAssertion.sourceLocation,blockId:null,charStart:0,charEnd:0},
  };
  const result = validateCfxDocumentBearingExtraction({
    rawOutput:{documentId:"DOC-1",accessLevel:"full_text",targets:[
      {propositionId:"P01",noBearingAssertionsFound:false,assertions:[returned]},
      {propositionId:"P02",noBearingAssertionsFound:true,assertions:[]},
    ]},
    documentId:"DOC-1",targets,access,blocks:buildCfxEvidenceBlocks(text),
  });
  const accepted = result.acceptedTargets[0]?.assertions[0];
  assert.equal(accepted?.sourceLocation.charStart, 0);
  assert.equal(accepted?.sourceLocation.charEnd, validAssertion.exactExcerpt.length);
  assert.equal(accepted?.sourceLocation.blockId, "E0001");
  assert.equal(result.diagnostics.some((row) => row.code === "SOURCE_LOCATION_DERIVED"), true);
});

test("presentation-only differences resolve to an exact immutable source slice", () => {
  const source = "The 1990\u20132010 analysis\nfound no association.";
  const excerpt = "The 1990-2010 analysis found no association.";
  const anchor = resolveCfxLiteralAnchor({
    exactExcerpt:excerpt,text:source,blocks:buildCfxEvidenceBlocks(source),
  });
  assert.deepEqual(anchor && {
    exactExcerpt:anchor.exactExcerpt,
    charStart:anchor.charStart,
    charEnd:anchor.charEnd,
    normalizationApplied:anchor.normalizationApplied,
  }, {
    exactExcerpt:source,charStart:0,charEnd:source.length,normalizationApplied:true,
  });
});

test("one document extraction invokes the provider exactly once", async () => {
  let calls = 0;
  const prompt = await loadCfxDocumentBearingPrompt();
  const result = await runCfxDocumentBearingExtraction({
    documentId:"DOC-1",targets,access,prompt,model:"gpt-4o-mini",
    temperature:0.1,maxOutputTokens:6000,timeoutMs:180000,
    provider:{async invokeStructured() {
      calls += 1;
      return {
        output:{documentId:"DOC-1",accessLevel:"full_text",targets:[
          {propositionId:"P01",noBearingAssertionsFound:false,assertions:[validAssertion]},
          {propositionId:"P02",noBearingAssertionsFound:true,assertions:[]},
        ]},
        model:"gpt-4o-mini",usage:{inputTokens:100,outputTokens:50,totalTokens:150,cachedInputTokens:0},
        responseId:"resp-1",requestId:"req-1",
      };
    }},
  });
  assert.equal(calls, 1);
  assert.equal(result.providerCallCount, 1);
  assert.equal(result.status, "completed");
});
