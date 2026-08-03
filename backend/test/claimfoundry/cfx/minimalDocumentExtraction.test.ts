import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCfxMinimalExtractionRequest,
  CFX_MINIMAL_EXTRACTION_SYSTEM,
  CFX_MINIMAL_EXTRACTION_TASK,
  validateCfxMinimalExtraction,
} from "../../../src/claimfoundry/cfx/experiments/minimalDocumentExtraction/extraction.js";

const targets = [
  { propositionId:"P1", assertion:"The agency omitted evidence." },
  { propositionId:"P2", assertion:"Independent reviews found no increased risk." },
];
const text = "The authors alleged that the agency omitted evidence.\n\nIndependent reviews found no increased risk.";

test("minimal extraction request uses the exact prompt surface and stable evidence blocks", () => {
  const built = buildCfxMinimalExtractionRequest({
    documentId:"DOC-1", accessLevel:"full_text", text, targets,
    model:"gpt-4o-mini",temperature:0.1,maxOutputTokens:8000,timeoutMs:180000,
  });
  assert.equal(built.request.system, CFX_MINIMAL_EXTRACTION_SYSTEM);
  assert.match(built.request.user, /^CASE ASSERTIONS\n\nP1/u);
  assert.match(built.request.user, /DOCUMENT_ID: DOC-1/u);
  assert.match(built.request.user, /\[E0001\]/u);
  assert.ok(built.request.user.endsWith(CFX_MINIMAL_EXTRACTION_TASK));
  assert.equal(built.request.responseSchema.name, "cfx_ranked_minimal_assertion_extraction_v1");
  assert.equal(built.request.store, false);
  assert.equal(built.request.retryCount, 0);
});

test("validator accepts literal rows and derives exact block and character coordinates", () => {
  const built = buildCfxMinimalExtractionRequest({
    documentId:"DOC-1", accessLevel:"full_text", text, targets,
    model:"gpt-4o-mini",temperature:0.1,maxOutputTokens:8000,timeoutMs:180000,
  });
  const excerpt = "Independent reviews found no increased risk.";
  const result = validateCfxMinimalExtraction({
    documentId:"DOC-1",targets,blocks:built.blocks,
    rawOutput:{documentId:"DOC-1",rows:[{
      targetAssertionId:"P2",exactExcerpt:excerpt,relation:"challenges",reason:"Directly denies increased risk.",
    }]},
  });
  assert.equal(result.rejectedRows.length, 0);
  assert.equal(result.acceptedRows.length, 1);
  assert.equal(result.acceptedRows[0].blockId, "E0002");
  assert.equal(text.slice(result.acceptedRows[0].charStart,result.acceptedRows[0].charEnd), excerpt);
});

test("validator preserves unknown, nonliteral, and duplicate rows as diagnostics", () => {
  const built = buildCfxMinimalExtractionRequest({
    documentId:"DOC-1", accessLevel:"full_text", text, targets,
    model:"gpt-4o-mini",temperature:0.1,maxOutputTokens:8000,timeoutMs:180000,
  });
  const literal = "The authors alleged that the agency omitted evidence.";
  const result = validateCfxMinimalExtraction({
    documentId:"DOC-1",targets,blocks:built.blocks,
    rawOutput:{documentId:"DOC-1",rows:[
      {targetAssertionId:"P1",exactExcerpt:literal,relation:"reports_allegation",reason:"Reports an allegation."},
      {targetAssertionId:"P1",exactExcerpt:literal,relation:"supports",reason:"Duplicate passage."},
      {targetAssertionId:"P999",exactExcerpt:"Invented excerpt",relation:"qualifies",reason:"Invalid."},
    ]},
  });
  assert.equal(result.acceptedRows.length, 1);
  assert.equal(result.rejectedRows.length, 2);
  assert.deepEqual(result.rejectedRows.map((row) => row.reasons[0].code), [
    "DUPLICATE_EXTRACTION_ROW", "UNKNOWN_TARGET_ASSERTION_ID",
  ]);
  assert.equal(result.rejectedRows[1].reasons.some((reason) => reason.code === "EXACT_EXCERPT_NOT_LITERAL"), true);
});

test("validator rejects a mismatched document envelope without publishing rows", () => {
  const built = buildCfxMinimalExtractionRequest({
    documentId:"DOC-1", accessLevel:"full_text", text, targets,
    model:"gpt-4o-mini",temperature:0.1,maxOutputTokens:8000,timeoutMs:180000,
  });
  const result = validateCfxMinimalExtraction({
    documentId:"DOC-1",targets,blocks:built.blocks,
    rawOutput:{documentId:"DOC-2",rows:[]},
  });
  assert.equal(result.acceptedRows.length, 0);
  assert.equal(result.rejectedRows[0].reasons[0].code, "INVALID_RESPONSE_ENVELOPE");
});
