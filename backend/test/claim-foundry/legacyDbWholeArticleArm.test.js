import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_DB_WHOLE_ARTICLE_ARM,
  buildLegacyDbWholeArticleRequest,
  runLegacyDbWholeArticleArm,
} from "./prompt-benchmark/legacyDbWholeArticleArm.js";

function fakeQuery(sql, params = []) {
  if (!sql.includes("FROM llm_prompts")) throw new Error(`Unexpected SQL: ${sql}`);
  const name = params[0];
  const rows = {
    claim_extraction_stack_system: [{
      prompt_type: "system",
      prompt_text: "SYSTEM {{extractionMode}} {{contentRole}}",
      parameters: "{}",
      max_claims: 9,
      min_sources: 2,
      max_sources: 4,
    }],
    claim_extraction_stack_with_topics: [{
      prompt_type: "user",
      prompt_text: "Return {{minClaims}}-{{maxClaims}} claims.",
      parameters: '{"shape":"reasoning_stack"}',
      max_claims: 9,
      min_sources: 2,
      max_sources: 4,
    }],
  };
  return Promise.resolve(rows[name] ?? []);
}

test("legacy DB arm recreates the one-whole-article DB prompt request", async () => {
  const articleText = "A".repeat(24_004);
  const built = await buildLegacyDbWholeArticleRequest({
    query: fakeQuery,
    articleText,
    extractionMode: "ranked",
  });
  assert.equal(LEGACY_DB_WHOLE_ARTICLE_ARM.sourceCommit, "4714383a");
  assert.deepEqual(built.promptSelection.selectedNames, {
    system: "claim_extraction_stack_system",
    user: "claim_extraction_stack_with_topics",
  });
  assert.equal(built.promptSelection.minClaims, 6);
  assert.equal(built.promptSelection.maxClaims, 9);
  assert.equal(built.request.system, "SYSTEM ranked case");
  assert.match(built.request.user, /Return 6-9 claims\./);
  assert.match(built.request.user, new RegExp(`TEXT:\\n${"A".repeat(80)}`));
  assert.equal(built.request.temperature, 0.2);
  assert.equal(built.request.schemaHint, "");
});

test("legacy DB arm retains historical flattening, exact dedupe, and cap", async () => {
  const calls = [];
  const llm = { generate: async (request) => {
    calls.push(request);
    return {
      output: {
        generalTopic: "topic",
        reasoningStack: {
          thesis: "Central claim.",
          pillars: [{ id: "P1", summary: "Pillar claim.", claims: [
            { text: "Supporting claim.", role: "pillar_support" },
          ] }],
          evidenceClaims: [{ text: "Supporting claim.", role: "evidence" }],
          backgroundClaims: ["Background claim."],
          searchAssertions: [],
        },
        claims: [{ text: "Additional claim.", role: "opposing_claim" }],
      },
      usage: { total_tokens: 123 },
      model: "gpt-4o-mini-test",
      rawResponse: { id: "response-1", system_fingerprint: "fp-test",
        choices: [{ finish_reason: "stop" }] },
    };
  } };
  const result = await runLegacyDbWholeArticleArm({
    query: fakeQuery,
    llm,
    articleText: "A factual article with enough text to inspect.",
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(result.extraction.claimsDetailed.map((claim) => claim.text), [
    "Central claim.", "Pillar claim.", "Supporting claim.", "Background claim.",
    "Additional claim.",
  ]);
  assert.equal(result.extraction.claimsDetailed.at(-1).role, "evidence");
  assert.equal(result.provider.systemFingerprint, "fp-test");
});
