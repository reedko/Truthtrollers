import test from "node:test";
import assert from "node:assert/strict";
import { buildBlockBatches, runLongCf1Analysis } from "../../src/claim-foundry/longExecution.js";
import { validateArticleInput } from "../../src/claim-foundry/validateArticleInput.js";
import { articleDocumentFromText, buildArticleSourceBlocks } from
  "../../src/claim-foundry/article-document/index.js";
import { createAgentDraft } from "./fixtures/packages.js";

const LIMITS = { maxTotalTokens: 100_000, maxOutputTokensPerCall: 1_000, maxDurationMs: 60_000 };

function longSource(count = 6) {
  const paragraphs = Array.from({ length: count }, (_, index) => (
    `Section ${index + 1} reports item ${index + 1}. ${"evidence ".repeat(350)}end-${index + 1}.`
  ));
  const article = validateArticleInput({ title: "Long fixture", text: paragraphs.join("\n\n"), authors: [], metadataWarnings: [] });
  const articleDocument = articleDocumentFromText({ text: article.text,
    metadata: { title: article.title } });
  const structuralBlocks = buildArticleSourceBlocks(articleDocument, {
    targetMinChars: 500, targetMaxChars: 3_300, hardMaxChars: 5_000,
  });
  return { article, articleDocument, sourceUnits: articleDocument.sourceUnits, structuralBlocks };
}

function observationFor(blocks) {
  return {
    blockAnnotations: blocks.map((block) => ({ blockId: block.blockId,
      semanticFunction: "evidence_example", articleStance: "reports", speakerEntities: [],
      relatedBlockIds: [], confidence: 0.9 })),
    candidateAssertions: blocks.map((block, index) => ({ candidateId: `candidate-${index}`,
      text: block.text.slice(0, 80), sourceUnitIds: [block.sourceUnitIds[0]],
      speakerEntity: null, assertionForm: "direct",
      articleUse: "reported", namedEntities: [], namedWorks: [], numbersAndDates: [] })),
    namedWorksAndIdentifiers: [], possibleCrossBlockLinks: [], localWarnings: [],
  };
}

function synthesisFor(structuralBlocks) {
  const draft = createAgentDraft();
  const late = structuralBlocks.at(-1);
  draft.semanticBlockAnnotations = structuralBlocks.map((block) => ({ blockId: block.blockId,
    semanticFunction: "evidence_example", articleStance: "reports", speakerEntities: [],
    relatedBlockIds: [], confidence: 0.9 }));
  draft.rawAssertions[0].sourceUnitIds = [late.sourceUnitIds[0]];
  draft.rawAssertions[0].text = "The final section reports the last material item.";
  draft.articleMap.thesis.sourceBlockIds = [late.blockId];
  draft.articleMap.pillars[0].sourceBlockIds = [late.blockId];
  delete draft.selectedEvaluationClaims[0].sourceBlockIds;
  delete draft.selectedEvaluationClaims[0].sourceExcerpt;
  draft.selectedEvaluationClaims[0].claimText = "The final section reports the last material item.";
  delete draft.phase3Targets[0].sourceBlockIds;
  delete draft.phase3Targets[0].sourceExcerpt;
  draft.phase3Targets[0].targetText = draft.selectedEvaluationClaims[0].claimText;
  draft.evidenceNeedCards[0].identifierHints.doi = [];
  return draft;
}

function fakeRunner(source, calls, synthesisOverride) {
  return { invokeStructured: async (request) => {
    calls.push(request);
    if (request.usageContext.stage === "batch") {
      const ids = [...request.user.matchAll(/"blockId":"(B\d{3})"/g)].map((match) => match[1]);
      const blocks = ids.map((id) => source.structuralBlocks.find((block) => block.blockId === id));
      return { output: observationFor(blocks), usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0 }, attempts: 1, model: "fake", rawResponse: null };
    }
    return { output: synthesisOverride ?? synthesisFor(source.structuralBlocks),
      usage: { inputTokens: 200, outputTokens: 50, totalTokens: 250, cachedInputTokens: 0 },
      attempts: 1, model: "fake", rawResponse: null };
  } };
}

test("batch builder covers each block once without overlap", () => {
  const source = longSource();
  const batches = buildBlockBatches({ ...source, modelContextTokens: 20_000 });
  const ids = batches.flatMap((batch) => batch.blocks.map((block) => block.blockId));
  assert.ok(batches.length > 1 && batches.length <= 6);
  assert.deepEqual(ids, source.structuralBlocks.map((block) => block.blockId));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(batches.every((batch) => batch.estimatedInputTokens <= batch.inputTokenCeiling));
});

test("more than six required batches fails instead of omitting blocks", () => {
  const source = longSource(7);
  const estimator = (payload) => 100 + ((JSON.stringify(payload).match(/B\d{3}/g) ?? []).length * 100);
  assert.throws(
    () => buildBlockBatches({ ...source, modelContextTokens: 800, tokenEstimator: estimator }),
    (error) => error.code === "CF1_INPUT_TOO_LARGE",
  );
});

test("long execution uses bounded batches and one synthesis while preserving late blocks", async () => {
  const source = longSource();
  const calls = [];
  const result = await runLongCf1Analysis({ ...source, executionDecision: { path: "long" },
    modelRunner: fakeRunner(source, calls), model: "fake", timeoutMs: 1_000,
    budgetLimits: LIMITS, modelContextTokens: 20_000 });
  assert.equal(result.usage.batchCalls, result.batches.length);
  assert.equal(result.usage.synthesisCalls, 1);
  assert.equal(result.usage.semanticCalls, result.batches.length + 1);
  assert.ok(result.usage.semanticCalls <= 7);
  assert.equal(calls.filter((call) => call.usageContext.stage === "synthesis").length, 1);
  assert.equal(result.agentDraft.rawAssertions[0].sourceUnitIds[0],
    source.structuralBlocks.at(-1).sourceUnitIds[0]);
});

test("invalid batch observation terminates before synthesis", async () => {
  const source = longSource();
  const calls = [];
  const brokenRunner = { invokeStructured: async (request) => {
    calls.push(request);
    return { output: { ...observationFor([]), blockAnnotations: [] }, usage: {}, attempts: 1 };
  } };
  await assert.rejects(runLongCf1Analysis({ ...source, executionDecision: { path: "long" },
    modelRunner: brokenRunner, model: "fake", timeoutMs: 1_000, budgetLimits: LIMITS,
    modelContextTokens: 20_000 }), (error) => error.code === "CF1_INVALID_BLOCK_OBSERVATION");
  assert.equal(calls.length, 1);
});

test("synthesis missing any original block is rejected", async () => {
  const source = longSource();
  const calls = [];
  const incomplete = synthesisFor(source.structuralBlocks);
  incomplete.semanticBlockAnnotations.pop();
  await assert.rejects(runLongCf1Analysis({ ...source, executionDecision: { path: "long" },
    modelRunner: fakeRunner(source, calls, incomplete), model: "fake", timeoutMs: 1_000,
    budgetLimits: LIMITS, modelContextTokens: 20_000 }),
  (error) => error.code === "CF1_INCOMPLETE_LONG_SYNTHESIS");
  assert.equal(calls.filter((call) => call.usageContext.stage === "synthesis").length, 1);
});
