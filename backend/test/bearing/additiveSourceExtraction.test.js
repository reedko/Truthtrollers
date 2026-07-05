import assert from "node:assert/strict";
import test from "node:test";

import { ClaimExtractor } from "../../src/core/claimsEngine.js";
import {
  buildUnresolvedTargetScope,
  restrictTaskClaimsToEvidenceScope,
} from "../../src/core/evidenceAssertionPersistence.js";

test("R7 skips generic rediscovery when every originating target is resolved", () => {
  const scope = buildUnresolvedTargetScope({
    evidenceAssertions: [{
      taskClaimId: 52881,
      evaluationTargetId: 72,
      quote: "Direct assertion",
      targetUnresolved: false,
    }],
  });
  assert.equal(scope.hasDirectAssertions, true);
  assert.equal(scope.shouldExtractAdditional, false);
  assert.deepEqual(scope.unresolvedTargets, []);
});

test("R7 scopes secondary matching to the unresolved originating claim and target", () => {
  const scope = buildUnresolvedTargetScope({
    evidenceAssertions: [{
      taskClaimId: 52881,
      evaluationTargetId: 72,
      evaluationTargetType: "substantive",
      evaluationTargetText: "CDC researchers omitted analyses from the identified study.",
      quote: "Thompson said information was omitted.",
      targetUnresolved: true,
    }],
  });
  const scoped = restrictTaskClaimsToEvidenceScope([
    {
      id: 52876,
      text: "Broad public-health narratives conceal risk.",
      evaluationTargets: [{ evaluationTargetId: 60, targetType: "substantive", targetText: "Broad claim" }],
    },
    {
      id: 52881,
      text: "Visible Thompson claim",
      evaluationTargets: [
        { evaluationTargetId: 71, targetType: "attribution", targetText: "Thompson made the allegation." },
        { evaluationTargetId: 72, targetType: "substantive", targetText: "CDC researchers omitted analyses from the identified study." },
      ],
    },
  ], scope);

  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].id, 52881);
  assert.deepEqual(scoped[0].evaluationTargets.map((target) => target.evaluationTargetId), [72]);
  assert.equal(scoped[0].text, "CDC researchers omitted analyses from the identified study.");
});

test("R7 extraction prompt requests only distinct assertions for unresolved targets", async () => {
  const calls = [];
  const extractor = new ClaimExtractor({
    generate: async (request) => {
      calls.push(request);
      return { claims: [], reasoningStack: { pillars: [], evidenceClaims: [], backgroundClaims: [] } };
    },
  });
  extractor.loadClaimExtractionPrompts = async () => ({ system: "Extract source claims.", user: "Return claims.", parameters: { max_claims: 12 } });
  extractor.promptManager = {
    getPrompt: async (_name, fallback) => fallback,
  };

  await extractor.analyzeChunk({
    chunk: "The CDC response discussed why a subgroup analysis was excluded.",
    tokenLength: 20,
    incomingTestimonials: [],
    taskClaimsContext: ["CDC researchers omitted analyses."],
    existingAssertions: ["Thompson said statistically significant information was omitted."],
    unresolvedTargetContexts: [{
      taskClaimId: 52881,
      evaluationTargetId: 72,
      evaluationTargetType: "substantive",
      targetText: "CDC researchers improperly omitted analyses.",
    }],
    contentRole: "source",
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].user, /Extract ONLY additional, distinct assertions/);
  assert.match(calls[0].user, /target 72, substantive/);
  assert.match(calls[0].user, /ALREADY CAPTURED/);
  assert.doesNotMatch(calls[0].user, /STILL EXTRACT general factual claims/);
});
