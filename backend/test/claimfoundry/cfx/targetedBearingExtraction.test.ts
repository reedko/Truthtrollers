import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCfxEvidenceBlocks,
  buildCfxTargetedBearingRequest,
  runCfxTargetedBearingExtraction,
  validateCfxTargetedBearingExtraction,
} from "../../../src/claimfoundry/cfx/evidenceBearing/targetedExtraction.js";
import type {
  CfxEvidenceTextAccess,
} from "../../../src/claimfoundry/cfx/evidenceBearing/types.js";

const text =
  "The study enrolled 400 children.\n\nVaccination was not associated with the measured outcome.";

function access(
  accessLevel: CfxEvidenceTextAccess["accessLevel"] = "full_text",
): CfxEvidenceTextAccess {
  return {
    candidateId: "C01",
    accessLevel,
    textSource: "pmc",
    text: accessLevel === "metadata_only" || accessLevel === "unavailable"
      ? null
      : text,
    characterCount: text.length,
    wordCount: 12,
    sourceUrl: "https://example.test/source",
    canonicalUrl: "https://example.test/source",
    doi: null,
    pmid: "12345678",
    retrievalAttempts: [],
    accessDiagnostics: [],
  };
}

const prompt = {
  schemaVersion: "cfx.prompt.v1" as const,
  promptId: "cfx-targeted-bearing-extraction-v1",
  prompt: "Read only supplied text.\nTarget: <immutable fixture assertion>",
  promptHash: "hash",
};

test("request keeps the target immutable and supplies labelled evidence blocks", () => {
  const built = buildCfxTargetedBearingRequest({
    candidateId: "C01",
    propositionId: "P05",
    targetAssertion: "Vaccination causes the measured outcome.",
    access: access(),
    prompt,
    model: "test-model",
    temperature: 0,
    maxOutputTokens: 2_000,
    timeoutMs: 10_000,
  });
  assert.equal(built.blocks.length, 2);
  assert.ok(built.request.user.includes(
    "Target: Vaccination causes the measured outcome.",
  ));
  assert.ok(built.request.user.includes("[E0001]"));
  assert.ok(built.request.user.includes("[E0002]"));
  assert.ok(built.request.user.includes(text.split("\n\n")[1]!));
  assert.equal(built.request.retryCount, 0);
  assert.equal(built.request.store, false);
});

test("metadata-only and unavailable candidates cannot enter semantic extraction", () => {
  for (const accessLevel of ["metadata_only", "unavailable"] as const) {
    assert.throws(() => buildCfxTargetedBearingRequest({
      candidateId: "C01",
      propositionId: "P05",
      targetAssertion: "Target",
      access: access(accessLevel),
      prompt,
      model: "test",
      temperature: 0,
      maxOutputTokens: 100,
      timeoutMs: 100,
    }), /cannot be model-extracted/);
  }
});

test("validator accepts literal excerpts and resolvable block and character locations", () => {
  const blocks = buildCfxEvidenceBlocks(text);
  const exactExcerpt =
    "Vaccination was not associated with the measured outcome.";
  const charStart = text.indexOf(exactExcerpt);
  const result = validateCfxTargetedBearingExtraction({
    candidateId: "C01",
    propositionId: "P05",
    access: access(),
    blocks,
    rawOutput: {
      candidateId: "C01",
      propositionId: "P05",
      accessLevel: "full_text",
      noBearingAssertionsFound: false,
      assertions: [{
        evidenceAssertion:
          "Vaccination was not associated with the measured outcome.",
        bearingRelation: "challenges",
        exactExcerpt,
        sourceLocation: {
          page: null,
          section: null,
          paragraph: 2,
          blockId: "E0002",
          charStart,
          charEnd: charStart + exactExcerpt.length,
        },
        whyItBears: "It directly evaluates the asserted relationship.",
        confidence: 0.91,
        quality: 0.82,
        limitationsVisibleInText: [],
      }],
    },
  });
  assert.ok(result.accepted);
  assert.deepEqual(result.diagnostics, []);
});

test("validator rejects invented excerpts, ID changes, access upgrades, and contradictory no-bearing output", () => {
  const result = validateCfxTargetedBearingExtraction({
    candidateId: "C01",
    propositionId: "P05",
    access: access("snippet"),
    blocks: buildCfxEvidenceBlocks(text),
    rawOutput: {
      candidateId: "C02",
      propositionId: "P06",
      accessLevel: "full_text",
      noBearingAssertionsFound: true,
      assertions: [{
        evidenceAssertion: "Invented result.",
        bearingRelation: "supports",
        exactExcerpt: "This sentence was never supplied.",
        sourceLocation: {
          page: null,
          section: null,
          paragraph: null,
          blockId: "E9999",
          charStart: 0,
          charEnd: 5,
        },
        whyItBears: "Invented.",
        confidence: 0.9,
        quality: 0.8,
        limitationsVisibleInText: [],
      }],
    },
  });
  assert.equal(result.accepted, null);
  for (const code of [
    "CANDIDATE_ID_MISMATCH",
    "PROPOSITION_ID_MISMATCH",
    "ACCESS_LEVEL_MISMATCH",
    "NO_BEARING_CONTRADICTION",
    "EXACT_EXCERPT_NOT_FOUND",
    "UNKNOWN_EVIDENCE_BLOCK",
    "CHARACTER_RANGE_MISMATCH",
  ]) {
    assert.ok(result.diagnostics.some((item) => item.code === code), code);
  }
});

test("valid no-bearing output contains no assertions", () => {
  const result = validateCfxTargetedBearingExtraction({
    candidateId: "C01",
    propositionId: "P05",
    access: access("abstract"),
    blocks: buildCfxEvidenceBlocks(text),
    rawOutput: {
      candidateId: "C01",
      propositionId: "P05",
      accessLevel: "abstract",
      noBearingAssertionsFound: true,
      assertions: [],
    },
  });
  assert.ok(result.accepted);
});

test("validator keeps confidence distinct and enforces legacy metric ranges", () => {
  const exactExcerpt = "The study enrolled 400 children.";
  const common = {
    candidateId: "C01",
    propositionId: "P05",
    accessLevel: "full_text",
    noBearingAssertionsFound: false,
    assertions: [{
      evidenceAssertion: exactExcerpt,
      bearingRelation: "qualifies",
      exactExcerpt,
      sourceLocation: {
        page: null, section: null, paragraph: 1, blockId: "E0001",
        charStart: 0, charEnd: exactExcerpt.length,
      },
      whyItBears: "It constrains the population size.",
      confidence: 0.75,
      quality: 1.1,
      limitationsVisibleInText: [],
    }],
  };
  const accepted = validateCfxTargetedBearingExtraction({
    candidateId: "C01", propositionId: "P05", access: access(),
    blocks: buildCfxEvidenceBlocks(text), rawOutput: common,
  });
  assert.equal(accepted.accepted?.assertions[0]?.confidence, 0.75);
  assert.equal(accepted.accepted?.assertions[0]?.quality, 1.1);

  const rejected = validateCfxTargetedBearingExtraction({
    candidateId: "C01", propositionId: "P05", access: access(),
    blocks: buildCfxEvidenceBlocks(text),
    rawOutput: {
      ...common,
      assertions: [{ ...common.assertions[0], confidence: 1.01, quality: 1.21 }],
    },
  });
  assert.equal(rejected.accepted, null);
  assert.ok(rejected.diagnostics.some((item) => item.code === "BEARING_SCHEMA_VIOLATION"));
});

test("runner captures the immutable raw response before validation and makes one call", async () => {
  let calls = 0;
  let captured: unknown;
  const rawOutput = {
    candidateId: "C01",
    propositionId: "P05",
    accessLevel: "abstract",
    noBearingAssertionsFound: true,
    assertions: [],
  };
  const result = await runCfxTargetedBearingExtraction({
    candidateId: "C01",
    propositionId: "P05",
    targetAssertion: "Target",
    access: access("abstract"),
    prompt,
    model: "test",
    temperature: 0,
    maxOutputTokens: 1_000,
    timeoutMs: 10_000,
    provider: {
      async invokeStructured() {
        calls += 1;
        return {
          output: rawOutput,
          rawResponse: { immutable: rawOutput },
          model: "test",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 5,
            totalTokens: 15,
          },
          responseId: "response",
          requestId: "request",
        };
      },
    },
    async afterResponse(value) {
      captured = value.rawResponse;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "completed");
  assert.deepEqual(captured, { immutable: rawOutput });
  assert.equal(result.providerCallCount, 1);
});
