import assert from "node:assert/strict";
import test from "node:test";

import { EvidenceEngine } from "../../src/core/evidenceEngine.js";
import { buildEvidenceNeedV1 } from "../../src/core/evidenceNeed.js";
import {
  assessSnippetBearingBatch,
  buildSnippetBearingCalibrationRecords,
  combineBearingPreScores,
  isSnippetBearingLlmEnabled,
  scoreCandidatesInBearingShadow,
  validateSnippetBearingBatchResult,
} from "../../src/core/snippetBearing.js";

function legacyProjection(candidate) {
  return {
    id: candidate.id,
    url: candidate.url,
    title: candidate.title,
    snippet: candidate.snippet,
    domain: candidate.domain,
    score: candidate.score,
    source: candidate.source,
    searchIntent: candidate.searchIntent,
    matchedPart: candidate.matchedPart,
  };
}

const claim = {
  id: 501,
  text: "Fluoride exposure improves adolescent cognitive performance",
  role: "thesis",
};
const evidenceNeed = buildEvidenceNeedV1(claim);

function deterministicCandidates() {
  return scoreCandidatesInBearingShadow(evidenceNeed, [
    {
      id: "a",
      url: "https://example.org/a",
      title: "Adolescent cognition study",
      snippet: "Fluoride exposure was associated with improved cognitive performance among adolescents.",
      domain: "example.org",
      score: 0.9,
      source: "web_search",
      searchIntent: "support",
      matchedPart: "object_claim",
    },
    {
      id: "b",
      url: "https://example.org/b",
      title: "Fluoride overview",
      snippet: "General resources and news about fluoride.",
      domain: "example.org",
      score: 0.8,
      source: "bing",
      searchIntent: "background",
      matchedPart: "context",
    },
    {
      id: "c",
      url: "https://example.org/c",
      title: "Limitations of cognition research",
      snippet: "The adolescent study did not measure several cognitive outcomes.",
      domain: "example.org",
      score: 0.7,
      source: "web_search",
      searchIntent: "nuance",
      matchedPart: "object_claim",
    },
  ]);
}

test("batched LLM scoring makes one call and preserves candidate count, order, and legacy fields", async () => {
  const candidates = deterministicCandidates();
  const before = structuredClone(candidates);
  const calls = [];
  const promptNames = [];
  const llm = {
    async generate(args) {
      calls.push(args);
      return {
        // Deliberately reversed to prove mapping is by candidateKey, not order.
        results: [
          { candidateKey: "c2", url: candidates[2].url, bearingPreScore: 0.6, expectedStance: "nuance", bearingType: "context", claimComponentAddressed: "scope", triageDecision: "maybe", reason: "Material limitation." },
          { candidateKey: "c1", url: candidates[1].url, bearingPreScore: 0.05, expectedStance: "background", bearingType: "none", claimComponentAddressed: "none", triageDecision: "skip", reason: "Topic only." },
          { candidateKey: "c0", url: candidates[0].url, bearingPreScore: 0.9, expectedStance: "support", bearingType: "direct", claimComponentAddressed: "whole_claim", triageDecision: "scrape", reason: "Exact outcome and population." },
        ],
      };
    },
  };
  const promptManager = {
    async getPrompt(name, fallback) {
      promptNames.push(name);
      return fallback;
    },
  };

  const result = await assessSnippetBearingBatch({
    claim,
    evidenceNeed,
    candidates,
    llm,
    promptManager,
    taskContentId: 99,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(promptNames, ["snippet_bearing_assessment_system", "snippet_bearing_assessment_user"]);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].maxRetries, 1);
  assert.equal(calls[0].timeout, 15000);
  assert.match(calls[0].user, /Do not reward same-topic overlap alone/);
  assert.match(calls[0].user, /Association\/correlation only partially bears on a causal claim/);
  assert.match(calls[0].user, /whether X said Y and whether Y is true are separate/);
  assert.match(calls[0].user, /article-level fact-check does not refute every embedded subclaim/);

  assert.deepEqual(candidates, before, "input candidates must not be mutated");
  assert.deepEqual(result.candidates.map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(result.candidates.map(legacyProjection), before.map(legacyProjection));
  assert.equal(result.candidates[0].llmBearingPreScore, 0.9);
  assert.equal(result.candidates[1].llmBearingPreScore, 0.05);
  assert.equal(result.candidates[2].llmBearingPreScore, 0.6);
  assert.equal(result.candidates[0].bearingPreScore, combineBearingPreScores(before[0].deterministicBearingScore, 0.9).bearingPreScore);
});

test("validation rejects unknown, duplicate, mismatched, and invalid results independently", () => {
  const payload = [
    { candidateKey: "c0", url: "https://example.org/a" },
    { candidateKey: "c1", url: "https://example.org/b" },
  ];
  const validated = validateSnippetBearingBatchResult({
    results: [
      { candidateKey: "c0", url: "https://example.org/a", bearingPreScore: 0.8, expectedStance: "support", bearingType: "direct", claimComponentAddressed: "whole_claim", triageDecision: "scrape", reason: "Direct." },
      { candidateKey: "c0", url: "https://example.org/a", bearingPreScore: 0.7 },
      { candidateKey: "c1", url: "https://wrong.example/b", bearingPreScore: 0.5 },
      { candidateKey: "c9", url: "https://example.org/z", bearingPreScore: 0.5 },
    ],
  }, payload);

  assert.equal(validated.validatedByKey.size, 1);
  assert.ok(validated.validatedByKey.has("c0"));
  assert.ok(validated.errors.some((error) => error.startsWith("duplicate_candidate_key")));
  assert.ok(validated.errors.some((error) => error.startsWith("url_mismatch")));
  assert.ok(validated.errors.some((error) => error.startsWith("unknown_candidate_key")));
});

test("missing batch items and LLM errors fall back deterministically without reordering", async () => {
  const candidates = deterministicCandidates();
  const partial = await assessSnippetBearingBatch({
    claim,
    evidenceNeed,
    candidates,
    llm: {
      async generate() {
        return {
          results: [{ candidateKey: "c0", url: candidates[0].url, bearingPreScore: 0.8, expectedStance: "support", bearingType: "direct", claimComponentAddressed: "whole_claim", triageDecision: "scrape", reason: "Direct." }],
        };
      },
    },
  });
  assert.deepEqual(partial.candidates.map((item) => item.id), ["a", "b", "c"]);
  assert.equal(partial.candidates[0].llmBearingPreScore, 0.8);
  assert.equal(partial.candidates[1].llmBearingPreScore, null);
  assert.equal(partial.candidates[1].bearingPreScore, candidates[1].deterministicBearingScore);

  const failed = await assessSnippetBearingBatch({
    claim,
    evidenceNeed,
    candidates,
    llm: { async generate() { throw new Error("timeout"); } },
  });
  assert.deepEqual(failed.candidates.map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(failed.candidates.map(legacyProjection), candidates.map(legacyProjection));
  assert.ok(failed.candidates.every((item) => item.llmBearingPreScore === null));
  assert.ok(failed.candidates.every((item) => item.bearingPreScore === item.deterministicBearingScore));
});

test("snippet quantitative guard converts 25 percent from support to refute for a majority claim", async () => {
  const quantitativeClaim = {
    id: 777,
    text: "More than half of all babies born with CHD will require surgery in order to survive.",
  };
  const candidate = {
    url: "https://example.org/chd",
    title: "CHD surgery statistics",
    snippet: "Approximately 25% of children born with a CHD will need heart surgery in their first year to survive.",
    deterministicBearingScore: 0.5,
  };
  const result = await assessSnippetBearingBatch({
    claim: quantitativeClaim,
    evidenceNeed: buildEvidenceNeedV1(quantitativeClaim),
    candidates: [candidate],
    llm: { async generate() { return { results: [{
      candidateKey: "c0",
      url: candidate.url,
      bearingPreScore: 0.8,
      expectedStance: "support",
      bearingType: "direct",
      claimComponentAddressed: "whole_claim",
      triageDecision: "scrape",
      reason: "Many babies need surgery.",
    }] }; } },
  });

  assert.equal(result.candidates[0].expectedStance, "refute");
  assert.match(result.candidates[0].triageReason, /25%.*contradicts.*50%/);
  assert.equal(result.candidates[0].bearingType, "direct");
});

test("batch cap scores at most 12 candidates and keeps overflow candidates as deterministic fallback", async () => {
  const many = scoreCandidatesInBearingShadow(evidenceNeed, Array.from({ length: 14 }, (_, index) => ({
    id: `id-${index}`,
    url: `https://example.org/${index}`,
    title: `Candidate ${index}`,
    snippet: "Fluoride adolescent cognitive performance study.",
    score: 1 - index / 100,
    source: "web_search",
  })));
  let seenPayload = [];
  const result = await assessSnippetBearingBatch({
    claim,
    evidenceNeed,
    candidates: many,
    llm: {
      async generate(args) {
        const match = args.user.match(/SEARCH CANDIDATES:\n(\[[\s\S]*?\])\n\nFor every candidate/);
        seenPayload = JSON.parse(match[1]);
        return {
          results: seenPayload.map((item) => ({
            candidateKey: item.candidateKey,
            url: item.url,
            bearingPreScore: 0.5,
            expectedStance: "nuance",
            bearingType: "indirect",
            claimComponentAddressed: "object",
            triageDecision: "maybe",
            reason: "Fixture.",
          })),
        };
      },
    },
    maxCandidates: 99,
  });

  assert.equal(seenPayload.length, 12);
  assert.equal(result.candidates.length, 14);
  assert.deepEqual(result.candidates.map((item) => item.id), many.map((item) => item.id));
  assert.equal(result.candidates[11].llmBearingPreScore, 0.5);
  assert.equal(result.candidates[12].llmBearingPreScore, null);
  assert.equal(result.candidates[13].llmBearingPreScore, null);
});

test("calibration joins final post-scrape scores by URL without changing candidates", () => {
  const candidates = deterministicCandidates().map((candidate, index) => ({
    ...candidate,
    llmBearingPreScore: 0.2 + index * 0.1,
    bearingPreScore: 0.3 + index * 0.1,
    bearingPreMethod: "combined_pre_bearing_v1",
  }));
  const records = buildSnippetBearingCalibrationRecords({
    taskContentId: 42,
    claim,
    candidates,
    selectedCandidateCount: 2,
    evidence: [
      { url: "https://example.org/a", bearingScore: 0.85 },
      { url: "https://example.org/a", bearingScore: 0.75 },
      { url: "https://example.org/b", bearingScore: null },
    ],
  });

  assert.equal(records.length, 3);
  assert.equal(records[0].postScrapeScore, 0.85);
  assert.equal(records[0].actuallyScraped, true);
  assert.equal(records[1].postScrapeScore, null);
  assert.equal(records[1].actuallyScraped, true);
  assert.equal(records[2].actuallyScraped, false);
});

test("snippet LLM feature is opt-in only", () => {
  assert.equal(isSnippetBearingLlmEnabled({}), false);
  assert.equal(isSnippetBearingLlmEnabled({ ENABLE_SNIPPET_BEARING_LLM: "false" }), false);
  assert.equal(isSnippetBearingLlmEnabled({ ENABLE_SNIPPET_BEARING_LLM: "true" }), true);
});

test("EvidenceEngine Phase 3 shadow path does not alter fetched candidate order", async () => {
  const originalBearing = process.env.ENABLE_BEARING_SHADOW;
  const originalLlm = process.env.ENABLE_SNIPPET_BEARING_LLM;
  const searchRows = [
    { id: "a", url: "https://example.org/a", title: "A", snippet: "Direct fluoride cognition result", score: 0.9, source: "web_search" },
    { id: "b", url: "https://example.org/b", title: "B", snippet: "General fluoride overview", score: 0.8, source: "web_search" },
    { id: "c", url: "https://example.org/c", title: "C", snippet: "Adolescent cognition limitation", score: 0.7, source: "web_search" },
  ];

  async function runWithLlmFlag(enabled) {
    process.env.ENABLE_BEARING_SHADOW = "true";
    process.env.ENABLE_SNIPPET_BEARING_LLM = enabled ? "true" : "false";
    const fetched = [];
    const engine = new EvidenceEngine({
      llm: {
        async generate() {
          return {
            results: [
              { candidateKey: "c2", url: searchRows[2].url, bearingPreScore: 0.99, expectedStance: "refute", bearingType: "direct", claimComponentAddressed: "whole_claim", triageDecision: "scrape", reason: "Highest LLM score but remains third." },
              { candidateKey: "c1", url: searchRows[1].url, bearingPreScore: 0.01, expectedStance: "background", bearingType: "none", claimComponentAddressed: "none", triageDecision: "skip", reason: "Low but remains second." },
              { candidateKey: "c0", url: searchRows[0].url, bearingPreScore: 0.5, expectedStance: "support", bearingType: "direct", claimComponentAddressed: "object", triageDecision: "scrape", reason: "Remains first." },
            ],
          };
        },
      },
      search: {
        internal: async () => [],
        web: async () => searchRows.map((row) => ({ ...row })),
      },
      fetcher: {
        async getText(candidate) {
          fetched.push(candidate.url);
          return { isProcessed: true, cleanText: "Full source text.", citationCount: 0 };
        },
      },
      extractQuotesAndScoreQuality: async ({ url }) => ({
        quotes: [{ quote: `Quote from ${url}`, stance: "support", summary: "Fixture" }],
        qualityScores: null,
      }),
    });
    await engine.run([
      {
        ...claim,
        evidenceNeed,
        searchTargets: [{ query: "fluoride cognition", intent: "support", matchedPart: "object_claim" }],
      },
    ], null, {
      enableInternal: false,
      enableWeb: true,
      topKQueries: 1,
      topKCandidates: 10,
      topKPerIntent: 10,
      maxEvidenceCandidates: 2,
      maxEvidencePerDoc: 1,
      enableFringeSearch: false,
      taskContentId: 42,
    });
    return fetched;
  }

  try {
    const withoutLlm = await runWithLlmFlag(false);
    const withLlm = await runWithLlmFlag(true);
    assert.deepEqual(withLlm, withoutLlm);
    assert.deepEqual(withLlm, ["https://example.org/a", "https://example.org/b"]);
  } finally {
    if (originalBearing === undefined) delete process.env.ENABLE_BEARING_SHADOW;
    else process.env.ENABLE_BEARING_SHADOW = originalBearing;
    if (originalLlm === undefined) delete process.env.ENABLE_SNIPPET_BEARING_LLM;
    else process.env.ENABLE_SNIPPET_BEARING_LLM = originalLlm;
  }
});
