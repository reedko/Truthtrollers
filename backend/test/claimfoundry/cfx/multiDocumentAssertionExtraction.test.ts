import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCfxMultiDocumentAssertionRequest,
  CFX_MULTI_DOCUMENT_ASSERTION_JSON_SCHEMA,
  prepareCfxMultiDocumentInput,
  validateCfxMultiDocumentAssertionExtraction,
} from "../../../src/claimfoundry/cfx/experiments/multiDocumentAssertionExtraction/extraction.js";

const prepared = prepareCfxMultiDocumentInput({
  assertionId: "P1",
  assertionText: "The agency omitted evidence.",
  documents: [
    { documentId: "DOC-A", selectedPackets: [{ packetId: "PACKET-1", blockIds: ["SOURCE-1"], charStart: 10, charEnd: 46, text: "The agency denied omitting evidence." }] },
    { documentId: "DOC-B", selectedPackets: [{ packetId: "PACKET-1", blockIds: ["SOURCE-1"], charStart: 100, charEnd: 145, text: "A researcher alleged the evidence was omitted." }] },
  ],
});
const blockA = "DOC-A::PACKET-1::BLOCK-0001";
const blockB = "DOC-B::PACKET-1::BLOCK-0001";
const row = (overrides: Record<string, unknown> = {}) => ({
  exactExcerpt: "The agency denied omitting evidence.",
  sourceAssertion: "The agency did not omit evidence.",
  relevanceType: "contradicts",
  reason: "Direct denial.",
  ...overrides,
});

test("one global block per passage maps document, packet, original blocks, and offsets", () => {
  assert.deepEqual(prepared.blocks.map((block) => block.globalBlockId), [blockA, blockB]);
  assert.deepEqual(prepared.provenance[blockA], { documentId: "DOC-A", packetId: "PACKET-1", originalSourceBlockIds: ["SOURCE-1"], documentCharStart: 10, documentCharEnd: 46 });
});

test("request uses block-only passage labels and schema with no packetId or documentId", () => {
  const request = buildCfxMultiDocumentAssertionRequest({ ...prepared, model: "gpt-4o-mini", temperature: 0.1, maxOutputTokens: 8000, timeoutMs: 180000 });
  assert.match(request.user, /\[BLOCK_ID: DOC-A::PACKET-1::BLOCK-0001\]/u);
  assert.match(request.user, /\[END_BLOCK: DOC-B::PACKET-1::BLOCK-0001\]/u);
  assert.equal(request.user.includes("[PACKET_ID:"), false);
  assert.equal(request.user.includes("DOCUMENT_ID:"), false);
  assert.equal(request.user.includes("packetIds"), false);
  assert.equal(JSON.stringify(CFX_MULTI_DOCUMENT_ASSERTION_JSON_SCHEMA).includes("packetIds"), false);
  assert.equal(JSON.stringify(CFX_MULTI_DOCUMENT_ASSERTION_JSON_SCHEMA).includes("documentId"), false);
  assert.match(request.user, /Process every supplied block independently\./u);
  assert.match(request.user, /Treat each block as a separate extraction task\./u);
  assert.match(request.user, /Do not deduplicate across blocks\./u);
  assert.match(request.user, /Do not omit any block\./u);
  assert.equal(request.responseSchema.name, "cfx_single_assertion_multi_document_extraction_v3");
});

test("validator derives document, packet, original blocks, and exact offsets from blockId", () => {
  const rawOutput = { assertionId: "P1", blockResults: [
    { blockId: blockA, assertions: [row()] },
    { blockId: blockB, assertions: [] },
  ] };
  const first = validateCfxMultiDocumentAssertionExtraction({ prepared, modelCallId: "call-1", rawOutput });
  const second = validateCfxMultiDocumentAssertionExtraction({ prepared, modelCallId: "call-2", rawOutput });
  assert.equal(first.rejectedRows.length, 0);
  assert.equal(first.acceptedRows[0].documentId, "DOC-A");
  assert.deepEqual(first.acceptedRows[0].originalPacketIds, ["PACKET-1"]);
  assert.deepEqual(first.acceptedRows[0].originalBlockIds, ["SOURCE-1"]);
  assert.equal(first.acceptedRows[0].documentCharStart, 10);
  assert.equal(first.acceptedRows[0].documentCharEnd, 46);
  assert.equal(first.acceptedRows[0].sourceAssertionId, second.acceptedRows[0].sourceAssertionId);
});

test("unknown, reordered, missing, and nonliteral block results are rejected while siblings survive", () => {
  const result = validateCfxMultiDocumentAssertionExtraction({
    prepared,
    modelCallId: "call-1",
    rawOutput: { assertionId: "P1", blockResults: [
      { blockId: blockA, assertions: [row(), row({ exactExcerpt: "Invented excerpt." })] },
      { blockId: "DOC-X::PACKET-1::BLOCK-0001", assertions: [] },
    ] },
  });
  assert.equal(result.acceptedRows.length, 1);
  assert.equal(result.rejectedRows.length, 2);
  assert.equal(result.rejectedRows[0].reasons.some((reason) => reason.code === "EXACT_EXCERPT_NOT_LITERAL"), true);
  assert.equal(result.rejectedRows[1].reasons.some((reason) => reason.code === "UNKNOWN_BLOCK_ID"), true);
  assert.equal(result.rejectedRows[1].reasons.some((reason) => reason.code === "BLOCK_RESULT_ORDER_MISMATCH"), true);
});

test("coverage validation preserves explicit empty blocks and diagnoses omitted results", () => {
  const complete = validateCfxMultiDocumentAssertionExtraction({
    prepared, modelCallId: "call-1", rawOutput: { assertionId: "P1", blockResults: [
      { blockId: blockA, assertions: [] }, { blockId: blockB, assertions: [] },
    ] },
  });
  assert.deepEqual(complete, { acceptedRows: [], rejectedRows: [] });
  const incomplete = validateCfxMultiDocumentAssertionExtraction({
    prepared, modelCallId: "call-1", rawOutput: { assertionId: "P1", blockResults: [{ blockId: blockA, assertions: [] }] },
  });
  assert.equal(incomplete.rejectedRows[0].reasons[0].code, "MISSING_BLOCK_RESULT");
});
