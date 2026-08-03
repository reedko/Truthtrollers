import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { prepareCfxFinalLinkingBaseline } from "../../../src/claimfoundry/cfx/finalLinking/baseline.js";
import {
  buildCfxLinkSuggestionRequest,
  projectCfxSuggestedScore,
  stableCfxSourceAssertionId,
  validateCfxLinkSuggestions,
  type CfxPersistableSourceAssertion,
} from "../../../src/claimfoundry/cfx/finalLinking/linkSuggestion.js";

const repositoryRoot = path.resolve(process.cwd(), "..");
const baselineRoot = path.join(repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-single-assertion-packet-extraction-20260802090828");
const selectedDocumentsPath = path.join(repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-ranked-minimal-extraction-20260802061220/selected-documents.json");

async function baseline() {
  const [acceptedRows, exactExtractionRequests, summary, selectedDocuments] = await Promise.all([
    readFile(path.join(baselineRoot, "accepted-source-assertions.json"), "utf8").then(JSON.parse),
    readFile(path.join(baselineRoot, "exact-model-requests.json"), "utf8").then(JSON.parse),
    readFile(path.join(baselineRoot, "model-test-summary.json"), "utf8").then(JSON.parse),
    readFile(selectedDocumentsPath, "utf8").then(JSON.parse),
  ]);
  return prepareCfxFinalLinkingBaseline({
    extractionRunId: path.basename(baselineRoot), acceptedRows, exactExtractionRequests,
    extractionPromptHash: summary.promptHash, extractionSchemaHash: summary.schemaHash,
    selectedDocuments,
  });
}

function sampleRows(): CfxPersistableSourceAssertion[] {
  return ["one", "two"].map((value, index) => ({
    sourceAssertionId: `SA-${value}`,
    caseAssertionId: "P1",
    caseAssertionText: "Case assertion.",
    documentId: `DOC-${index + 1}`,
    documentTitle: "Document",
    documentUrl: `https://example.com/${index + 1}`,
    sourceAssertion: `Source assertion ${value}.`,
    exactExcerpt: `Exact excerpt ${value}.`,
    documentCharStart: index * 20,
    documentCharEnd: index * 20 + 18,
    sourceBlockIds: ["SOURCE-0001"],
    sourcePacketIds: ["PACKET-0001"],
    extractionRunId: "run-extraction",
    extractionModelCallId: `request-00${index + 1}`,
    extractionPromptHash: "a".repeat(64),
    extractionSchemaHash: "b".repeat(64),
  }));
}

function validOutput() {
  return {
    caseAssertionId: "P1",
    linkResults: sampleRows().map((row, index) => ({
      sourceAssertionId: row.sourceAssertionId,
      suggestedStance: index ? "refute" : "support",
      suggestedScore: index ? 0.7 : 0.8,
      rationale: "Directly bears on the supplied assertion.",
    })),
  };
}

test("authoritative baseline produces all 14 stable source-assertion occurrences", async () => {
  const result = await baseline();
  assert.equal(result.rows.length, 14);
  assert.equal(new Set(result.rows.map((row) => row.sourceAssertionId)).size, 14);
  assert.equal(result.documents.length, 5);
});

test("stable source assertion IDs are deterministic", async () => {
  const first = await baseline();
  const second = await baseline();
  assert.deepEqual(first.rows.map((row) => row.sourceAssertionId), second.rows.map((row) => row.sourceAssertionId));
  const row = first.rows[0]!;
  assert.equal(row.sourceAssertionId, stableCfxSourceAssertionId({
    caseAssertionId: row.caseAssertionId, documentId: row.documentId,
    exactExcerpt: row.exactExcerpt, sourceAssertion: row.sourceAssertion,
  }));
});

test("baseline groups into exactly two compact calls without suppressing rows", async () => {
  const result = await baseline();
  const counts = Object.fromEntries(result.caseAssertions.map((item) => [item.caseAssertionId,
    result.rows.filter((row) => row.caseAssertionId === item.caseAssertionId).length]));
  assert.deepEqual(counts, { P54895: 8, P54897: 6 });
});

test("link request contains compact claims and excludes prior semantic labels", () => {
  const rows = sampleRows();
  const request = buildCfxLinkSuggestionRequest({
    caseAssertionId: "P1", caseAssertionText: "Case assertion.", sourceAssertions: rows,
    model: "gpt-4o-mini", temperature: 0.1, maxOutputTokens: 4_000, timeoutMs: 180_000,
  });
  assert.match(request.user, /SOURCE_ASSERTION_ID: SA-one/u);
  assert.match(request.user, /EXACT_EXCERPT: Exact excerpt one\./u);
  assert.doesNotMatch(request.user, /relevanceType|retrieval score|source-quality|prior extraction reason/iu);
  assert.equal(request.retryCount, 0);
  assert.equal(request.store, false);
});

test("valid response returns exactly one accepted result per supplied ID", () => {
  const result = validateCfxLinkSuggestions({
    caseAssertionId: "P1", suppliedSourceAssertionIds: ["SA-one", "SA-two"], rawOutput: validOutput(),
  });
  assert.equal(result.acceptedRows.length, 2);
  assert.equal(result.rejectedRows.length, 0);
});

test("unknown source assertion IDs are rejected", () => {
  const output = validOutput();
  output.linkResults[1]!.sourceAssertionId = "SA-unknown";
  const result = validateCfxLinkSuggestions({
    caseAssertionId: "P1", suppliedSourceAssertionIds: ["SA-one", "SA-two"], rawOutput: output,
  });
  assert.ok(result.rejectedRows.some((row) => row.reasons.some((reason) => reason.code === "UNKNOWN_SOURCE_ASSERTION_ID")));
});

test("duplicate source assertion IDs are rejected", () => {
  const output = validOutput();
  output.linkResults[1]!.sourceAssertionId = "SA-one";
  const result = validateCfxLinkSuggestions({
    caseAssertionId: "P1", suppliedSourceAssertionIds: ["SA-one", "SA-two"], rawOutput: output,
  });
  assert.ok(result.rejectedRows.some((row) => row.reasons.some((reason) => reason.code === "DUPLICATE_SOURCE_ASSERTION_ID")));
});

test("invalid stance is rejected", () => {
  const output:any = validOutput();
  output.linkResults[0].suggestedStance = "neutral";
  const result = validateCfxLinkSuggestions({
    caseAssertionId: "P1", suppliedSourceAssertionIds: ["SA-one", "SA-two"], rawOutput: output,
  });
  assert.ok(result.rejectedRows.some((row) => row.reasons.some((reason) => reason.code === "INVALID_LINK_RESULT_SCHEMA")));
});

test("out-of-range and non-finite scores are rejected without clamping", () => {
  for (const score of [-0.01, 1.01, Number.NaN]) {
    const output = validOutput();
    output.linkResults[0]!.suggestedScore = score;
    const result = validateCfxLinkSuggestions({
      caseAssertionId: "P1", suppliedSourceAssertionIds: ["SA-one", "SA-two"], rawOutput: output,
    });
    assert.equal(result.acceptedRows.some((row) => row.sourceAssertionId === "SA-one"), false);
  }
});

test("missing rows and count mismatches are preserved as diagnostics", () => {
  const output = validOutput();
  output.linkResults.pop();
  const result = validateCfxLinkSuggestions({
    caseAssertionId: "P1", suppliedSourceAssertionIds: ["SA-one", "SA-two"], rawOutput: output,
  });
  const codes = result.rejectedRows.flatMap((row) => row.reasons.map((reason) => reason.code));
  assert.ok(codes.includes("MISSING_SOURCE_ASSERTION_ID"));
  assert.ok(codes.includes("LINK_RESULT_COUNT_MISMATCH"));
});

test("insufficient requires zero bearing strength", () => {
  const output:any = validOutput();
  output.linkResults[0].suggestedStance = "insufficient";
  output.linkResults[0].suggestedScore = 0.2;
  const result = validateCfxLinkSuggestions({
    caseAssertionId: "P1", suppliedSourceAssertionIds: ["SA-one", "SA-two"], rawOutput: output,
  });
  assert.ok(result.rejectedRows.some((row) => row.reasons.some((reason) => reason.code === "INSUFFICIENT_SCORE_MISMATCH")));
});

test("bearing magnitude projects to the existing signed support-level convention", () => {
  assert.equal(projectCfxSuggestedScore({ suggestedStance: "support", suggestedScore: 0.8 }), 0.8);
  assert.equal(projectCfxSuggestedScore({ suggestedStance: "refute", suggestedScore: 0.8 }), -0.8);
  assert.equal(projectCfxSuggestedScore({ suggestedStance: "nuance", suggestedScore: 0.8 }), 0.4);
  assert.equal(projectCfxSuggestedScore({ suggestedStance: "insufficient", suggestedScore: 0 }), 0);
});

test("request builder rejects mixed-case batches", () => {
  const rows = sampleRows();
  rows[1]!.caseAssertionId = "P2";
  assert.throws(() => buildCfxLinkSuggestionRequest({
    caseAssertionId: "P1", caseAssertionText: "Case assertion.", sourceAssertions: rows,
    model: "gpt-4o-mini", temperature: 0.1, maxOutputTokens: 4_000, timeoutMs: 180_000,
  }), /every source assertion must belong/u);
});

test("rationale text is preserved but never used as an acceptance gate", () => {
  const output = validOutput();
  output.linkResults[0]!.rationale = "";
  const result = validateCfxLinkSuggestions({
    caseAssertionId: "P1", suppliedSourceAssertionIds: ["SA-one", "SA-two"], rawOutput: output,
  });
  assert.equal(result.acceptedRows.length, 2);
});
