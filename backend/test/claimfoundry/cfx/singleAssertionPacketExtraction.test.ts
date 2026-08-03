import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCfxSingleAssertionPacketRequest,
  CFX_SINGLE_ASSERTION_PACKET_SYSTEM,
  CFX_SINGLE_ASSERTION_PACKET_USER_TEMPLATE,
  validateCfxSingleAssertionPacketExtraction,
  type CfxPacketExtractionInput,
} from "../../../src/claimfoundry/cfx/experiments/singleAssertionPacketExtraction/extraction.js";

const submitted: CfxPacketExtractionInput = {
  assertionId: "P1",
  assertionText: "The agency omitted evidence.",
  documentId: "DOC-1",
  selectedPackets: [
    { packetId: "PACKET-1", blockIds: ["B1"], charStart: 100, charEnd: 137, text: "The agency denied omitting evidence." },
    { packetId: "PACKET-2", blockIds: ["B2"], charStart: 200, charEnd: 228, text: "A researcher alleged that it did." },
  ],
};

const row = (overrides: Record<string, unknown> = {}) => ({
  exactExcerpt: "The agency denied omitting evidence.",
  sourceAssertion: "The agency did not omit evidence.",
  relevanceType: "contradicts",
  reason: "The passage directly denies the case assertion.",
  packetIds: ["PACKET-1"],
  blockIds: ["B1"],
  ...overrides,
});

test("request is byte-stable and exposes only one assertion, one document, and packet text", () => {
  const request = buildCfxSingleAssertionPacketRequest({
    ...submitted,
    model: "gpt-4o-mini",
    temperature: 0.1,
    maxOutputTokens: 8_000,
    timeoutMs: 180_000,
  });
  assert.equal(request.system, CFX_SINGLE_ASSERTION_PACKET_SYSTEM);
  assert.equal(request.user, CFX_SINGLE_ASSERTION_PACKET_USER_TEMPLATE
    .replace("{{assertionId}}", submitted.assertionId)
    .replace("{{assertionText}}", submitted.assertionText)
    .replace("{{documentId}}", submitted.documentId)
    .replace("{{selectedPackets}}", [
      "[PACKET_ID: PACKET-1]\nSOURCE_BLOCK_IDS: B1\nThe agency denied omitting evidence.\n[END_PACKET: PACKET-1]",
      "[PACKET_ID: PACKET-2]\nSOURCE_BLOCK_IDS: B2\nA researcher alleged that it did.\n[END_PACKET: PACKET-2]",
    ].join("\n\n")));
  assert.equal(request.responseSchema.name, "cfx_single_assertion_packet_extraction_v1");
  assert.equal(request.retryCount, 0);
  assert.equal(request.store, false);
  for (const forbidden of ["combinedScore", "matchedTerms", "aliases", "conceptGroup", "queryIntent", "expectedStance"]) {
    assert.equal(request.user.includes(forbidden), false);
  }
});

test("validator accepts literal grounding and resolves packet and document offsets", () => {
  const result = validateCfxSingleAssertionPacketExtraction({
    submitted,
    rawOutput: { assertionId: "P1", documentId: "DOC-1", assertions: [row()] },
  });
  assert.equal(result.rejectedRows.length, 0);
  assert.equal(result.acceptedRows.length, 1);
  assert.deepEqual(result.acceptedRows[0].grounding.packetSpans, [{
    packetId: "PACKET-1",
    packetCharStart: 0,
    packetCharEnd: 36,
    documentCharStart: 100,
    documentCharEnd: 136,
  }]);
});

test("validator accepts a literal excerpt crossing an adjacent joined packet range", () => {
  const exactExcerpt = "omitting evidence.\n\nA researcher alleged";
  const result = validateCfxSingleAssertionPacketExtraction({
    submitted,
    rawOutput: { assertionId: "P1", documentId: "DOC-1", assertions: [row({
      exactExcerpt,
      sourceAssertion: "The agency denied omission while a researcher alleged it.",
      relevanceType: "qualifies",
      packetIds: ["PACKET-1", "PACKET-2"],
      blockIds: ["B1", "B2"],
    })] },
  });
  assert.equal(result.rejectedRows.length, 0);
  assert.equal(result.acceptedRows[0].grounding.mode, "contiguous_packet_range");
  assert.equal(result.acceptedRows[0].grounding.packetSpans.length, 2);
});

test("validator preserves invalid IDs, nonliteral excerpts, and normalized duplicates independently", () => {
  const result = validateCfxSingleAssertionPacketExtraction({
    submitted,
    rawOutput: { assertionId: "P1", documentId: "DOC-1", assertions: [
      row(),
      row({ exactExcerpt: "  The agency  denied omitting evidence.  " }),
      row({ exactExcerpt: "Invented evidence.", packetIds: ["UNKNOWN"], blockIds: ["UNKNOWN"] }),
    ] },
  });
  assert.equal(result.acceptedRows.length, 1);
  assert.equal(result.rejectedRows.length, 2);
  assert.equal(result.rejectedRows[0].reasons.some((reason) => reason.code === "DUPLICATE_EXTRACTION_ROW"), true);
  assert.deepEqual(new Set(result.rejectedRows[1].reasons.map((reason) => reason.code)), new Set([
    "UNKNOWN_PACKET_ID",
    "UNKNOWN_BLOCK_ID",
    "BLOCK_NOT_IN_RETURNED_PACKET",
    "EXACT_EXCERPT_NOT_LITERAL",
  ]));
});

test("validator rejects incorrect packet/block grounding even when the excerpt is literal", () => {
  const result = validateCfxSingleAssertionPacketExtraction({
    submitted,
    rawOutput: { assertionId: "P1", documentId: "DOC-1", assertions: [row({
      packetIds: ["PACKET-2"], blockIds: ["B2"],
    })] },
  });
  assert.equal(result.acceptedRows.length, 0);
  assert.deepEqual(result.rejectedRows[0].reasons.map((reason) => reason.code), [
    "PACKET_GROUNDING_MISMATCH", "BLOCK_GROUNDING_MISMATCH",
  ]);
});

test("validator rejects a mismatched assertion or document envelope without publishing", () => {
  const result = validateCfxSingleAssertionPacketExtraction({
    submitted,
    rawOutput: { assertionId: "P2", documentId: "DOC-2", assertions: [row()] },
  });
  assert.equal(result.acceptedRows.length, 0);
  assert.equal(result.rejectedRows[0].reasons[0].code, "INVALID_RESPONSE_ENVELOPE");
});
