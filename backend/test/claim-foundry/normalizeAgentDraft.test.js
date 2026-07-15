import test from "node:test";
import assert from "node:assert/strict";
import { Cf1Error } from "../../src/claim-foundry/errors.js";
import { normalizeAgentDraft } from "../../src/claim-foundry/normalizeAgentDraft.js";
import { createAgentDraft, createArticleAndBlocks } from "./fixtures/packages.js";

test("agent draft normalization assigns canonical IDs and rewrites references", () => {
  const source = createArticleAndBlocks();
  const draft = createAgentDraft();
  const normalized = normalizeAgentDraft(draft, source);

  assert.equal(normalized.rawAssertions[0].rawAssertionId, "R001");
  assert.equal(normalized.articleMap.pillars[0].pillarId, "P01");
  assert.equal(normalized.selectedEvaluationClaims[0].selectedClaimId, "S01");
  assert.equal(normalized.phase3Targets[0].selectedClaimId, "S01");
  assert.equal(normalized.evidenceNeedCards[0].cardId, "ENC-T001");
  assert.equal(normalized.evidenceNeedCards[0].identifierHints.doi[0], "10.1234/bridge.7");
  assert.deepEqual(normalized.rawAssertions[0].sourceOffsets, [{ start: 68, end: 141 }]);
  assert.equal(normalized.rawAssertions[0].sourceExcerpt,
    "The audit, DOI:10.1234/Bridge.7, says procurement began nine months late.");
  assert.equal(draft.rawAssertions[0].rawAssertionId, "agent-raw-a");
});

test("normalization preserves unresolved references for verification rather than guessing", () => {
  const source = createArticleAndBlocks();
  const draft = createAgentDraft();
  draft.phase3Targets[0].selectedClaimId = "invented-selection";
  const normalized = normalizeAgentDraft(draft, source);
  assert.equal(normalized.phase3Targets[0].selectedClaimId, "invented-selection");
});

test("normalization rejects duplicate temporary IDs", () => {
  const source = createArticleAndBlocks();
  const draft = createAgentDraft();
  draft.rawAssertions.push(structuredClone(draft.rawAssertions[0]));
  assert.throws(
    () => normalizeAgentDraft(draft, source),
    (error) => error instanceof Cf1Error && error.code === "CF1_DUPLICATE_AGENT_ID",
  );
});

test("structural source truth cannot be overwritten by annotations", () => {
  const source = createArticleAndBlocks();
  const draft = createAgentDraft();
  draft.semanticBlockAnnotations[0].text = "invented replacement";
  draft.semanticBlockAnnotations[0].sourceOffsets = { start: 4, end: 9 };
  const normalized = normalizeAgentDraft(draft, source);
  assert.equal(normalized.semanticBlocks[0].text, source.structuralBlocks[0].text);
  assert.deepEqual(normalized.semanticBlocks[0].sourceOffsets, source.structuralBlocks[0].sourceOffsets);
});

test("normalization ignores model-authored deterministic provenance fields", () => {
  const source = createArticleAndBlocks();
  const draft = createAgentDraft();
  draft.rawAssertions[0].sourceExcerpt = "The audit.";
  draft.selectedEvaluationClaims[0].sourceExcerpt = "The audit.";
  draft.phase3Targets[0].sourceExcerpt = "The audit.";
  const normalized = normalizeAgentDraft(draft, source);
  const exact = "The audit, DOI:10.1234/Bridge.7, says procurement began nine months late.";
  assert.equal(normalized.rawAssertions[0].sourceExcerpt, exact);
  assert.equal(normalized.selectedEvaluationClaims[0].sourceExcerpt, exact);
  assert.equal(normalized.phase3Targets[0].sourceExcerpt, exact);
});

test("normalization conservatively defaults omitted block annotations", () => {
  const source = createArticleAndBlocks();
  const draft = createAgentDraft();
  draft.semanticBlockAnnotations = [];
  const normalized = normalizeAgentDraft(draft, source);
  assert.equal(normalized.semanticBlocks[0].semanticFunction, "unclear");
  assert.equal(normalized.semanticBlocks[0].articleStance, "unclear");
  assert.equal(normalized.semanticBlocks[0].confidence, 0);
  assert.match(normalized.agentWarnings.at(-1), /defaulted 1 omitted/);
});
