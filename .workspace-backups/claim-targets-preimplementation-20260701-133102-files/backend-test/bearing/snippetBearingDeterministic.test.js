import assert from "node:assert/strict";
import test from "node:test";

import { EvidenceEngine } from "../../src/core/evidenceEngine.js";
import { buildEvidenceNeedV1 } from "../../src/core/evidenceNeed.js";
import {
  buildBearingShadowLogRecord,
  isBearingShadowEnabled,
  scoreCandidatesInBearingShadow,
  scoreSnippetBearingDeterministic,
} from "../../src/core/snippetBearing.js";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function legacyProjection(candidate) {
  return {
    id: candidate.id,
    url: candidate.url,
    title: candidate.title,
    snippet: candidate.snippet,
    domain: candidate.domain,
    publishedAt: candidate.publishedAt,
    score: candidate.score,
    source: candidate.source,
    searchIntent: candidate.searchIntent,
    matchedPart: candidate.matchedPart,
  };
}

const cognitionClaim = {
  id: 101,
  text: "Fluoride exposure improves adolescent cognitive performance",
  role: "thesis",
};

test("shadow scoring is non-mutating and preserves candidate order and legacy fields", () => {
  const evidenceNeed = deepFreeze(buildEvidenceNeedV1(cognitionClaim));
  const candidates = deepFreeze([
    {
      id: "first",
      url: "https://example.org/direct?utm_source=test",
      title: "Study of fluoride and adolescent cognition",
      snippet: "Researchers found fluoride exposure was associated with better cognitive performance among adolescents.",
      domain: "example.org",
      publishedAt: "2025-01-01",
      score: 0.41,
      source: "web_search",
      searchIntent: "support",
      matchedPart: "object_claim",
    },
    {
      id: "second",
      url: "https://authority.gov/fluoride",
      title: "Fluoride topic overview",
      snippet: "Home page with fluoride resources and latest news.",
      domain: "authority.gov",
      publishedAt: null,
      score: 0.99,
      source: "bing",
      searchIntent: "background",
      matchedPart: "context",
    },
    {
      id: "third",
      url: "https://example.net/other",
      title: "Another result",
      snippet: "A report discusses cognitive performance among adolescents exposed to fluoride.",
      domain: "example.net",
      publishedAt: null,
      score: 0.5,
      source: "web_search",
      searchIntent: "nuance",
      matchedPart: "object_claim",
    },
  ]);
  const before = JSON.parse(JSON.stringify(candidates));

  const scored = scoreCandidatesInBearingShadow(evidenceNeed, candidates);

  assert.deepEqual(candidates, before, "input candidates must not be mutated");
  assert.notStrictEqual(scored, candidates, "the scorer returns a mapped array");
  assert.deepEqual(scored.map((candidate) => candidate.id), ["first", "second", "third"]);
  assert.deepEqual(scored.map(legacyProjection), before.map(legacyProjection));
  assert.ok(scored.every((candidate) => Number.isFinite(candidate.deterministicBearingScore)));
});

test("EvidenceEngine returns the same legacy candidates in the same order with shadow on or off", async () => {
  const originalFlag = process.env.ENABLE_BEARING_SHADOW;
  const searchRows = [
    { id: "low", url: "https://example.org/low", title: "Low", snippet: "Fluoride overview", score: 0.2, source: "web_search" },
    { id: "high", url: "https://example.org/high", title: "High", snippet: "Fluoride cognition study", score: 0.9, source: "web_search" },
    { id: "mid", url: "https://example.org/mid", title: "Mid", snippet: "Adolescent cognition report", score: 0.5, source: "web_search" },
  ];
  const engine = new EvidenceEngine({
    search: {
      internal: async () => [],
      web: async () => searchRows.map((row) => ({ ...row })),
    },
  });
  const claim = {
    ...cognitionClaim,
    evidenceNeed: buildEvidenceNeedV1(cognitionClaim),
  };
  const queries = [{ query: "fluoride cognition", intent: "support", matchedPart: "object_claim" }];
  const options = {
    enableInternal: false,
    enableWeb: true,
    topKCandidates: 10,
    topKQueries: 1,
    topKPerIntent: 10,
  };

  try {
    process.env.ENABLE_BEARING_SHADOW = "false";
    const withoutShadow = await engine.retrieveCandidates(claim, queries, options);
    process.env.ENABLE_BEARING_SHADOW = "true";
    const withShadow = await engine.retrieveCandidates(claim, queries, options);

    assert.deepEqual(withShadow.map((candidate) => candidate.id), withoutShadow.map((candidate) => candidate.id));
    assert.deepEqual(withShadow.map(legacyProjection), withoutShadow.map(legacyProjection));
    assert.ok(withoutShadow.every((candidate) => candidate.deterministicBearingScore === undefined));
    assert.ok(withShadow.every((candidate) => Number.isFinite(candidate.deterministicBearingScore)));
  } finally {
    if (originalFlag === undefined) delete process.env.ENABLE_BEARING_SHADOW;
    else process.env.ENABLE_BEARING_SHADOW = originalFlag;
  }
});

test("topic-only candidate scores low even when its domain looks authoritative", () => {
  const need = buildEvidenceNeedV1(cognitionClaim);
  const result = scoreSnippetBearingDeterministic(need, {
    title: "Government fluoride topic overview",
    snippet: "Home page with fluoride resources, public information, and latest news.",
    domain: "health.gov",
  });

  assert.ok(result.score < 0.15);
  assert.equal(result.components.topicOnlyPenalty, 0.3);
  assert.equal(result.wouldScrape, false);
});

test("direct-bearing candidate scores higher than topic-only candidate", () => {
  const need = buildEvidenceNeedV1(cognitionClaim);
  const direct = scoreSnippetBearingDeterministic(need, {
    title: "Study of fluoride and adolescent cognition",
    snippet: "The study found fluoride exposure was associated with better cognitive performance among adolescents.",
  });
  const topicOnly = scoreSnippetBearingDeterministic(need, {
    title: "Fluoride overview",
    snippet: "General fluoride resources and news.",
  });

  assert.ok(direct.score >= 0.6, `expected direct score >= 0.6, got ${direct.score}`);
  assert.ok(direct.score > topicOnly.score);
});

test("attribution scoring separates speaker/origin alignment", () => {
  const need = buildEvidenceNeedV1({
    id: 102,
    text: "Dr. Rivera said the trial was stopped early",
    objectClaim: "The trial was stopped early",
    isAttribution: true,
    speakerEntity: "Dr. Rivera",
  });
  const origin = scoreSnippetBearingDeterministic(need, {
    title: "Transcript of Dr. Rivera interview",
    snippet: "Dr. Rivera stated that the trial was stopped early.",
  });
  const objectOnly = scoreSnippetBearingDeterministic(need, {
    title: "Trial status report",
    snippet: "The trial was stopped early after an interim review.",
  });

  assert.equal(need.claimType, "attribution");
  assert.ok(origin.components.attributionOrCausal > objectOnly.components.attributionOrCausal);
});

test("association language receives only partial causal alignment", () => {
  const need = buildEvidenceNeedV1({
    id: 103,
    text: "Exposure to compound Z causes liver disease",
  });
  const associative = scoreSnippetBearingDeterministic(need, {
    title: "Compound Z and liver disease",
    snippet: "Compound Z exposure was associated with liver disease in an observational cohort.",
  });
  const causal = scoreSnippetBearingDeterministic(need, {
    title: "Mechanism linking compound Z to liver disease",
    snippet: "Researchers found a causal mechanism by which compound Z causes liver disease.",
  });

  assert.equal(need.claimType, "causal");
  assert.equal(associative.components.attributionOrCausal, 0.3);
  assert.equal(causal.components.attributionOrCausal, 1);
  // Association still bears on a causal claim; Phase 1 must not turn bearing
  // into stance or evidence-strength adjudication. The typed component records
  // the partial causal match for later phases without gating either candidate.
  assert.ok(associative.score > 0);
});

test("empty title and snippet fail conservatively", () => {
  const result = scoreSnippetBearingDeterministic(buildEvidenceNeedV1(cognitionClaim), {
    title: "",
    snippet: "",
  });

  assert.equal(result.score, 0);
  assert.equal(result.decision, "skip");
  assert.equal(result.wouldScrape, false);
});

test("feature flag defaults on outside production and can be shut off", () => {
  assert.equal(isBearingShadowEnabled({ NODE_ENV: "development" }), true);
  assert.equal(isBearingShadowEnabled({ NODE_ENV: "production" }), false);
  assert.equal(isBearingShadowEnabled({ NODE_ENV: "production", ENABLE_BEARING_SHADOW: "true" }), true);
  assert.equal(isBearingShadowEnabled({ NODE_ENV: "development", ENABLE_BEARING_SHADOW: "false" }), false);
});

test("structured shadow logs cap title, snippet, reason, query, and claim text", () => {
  const long = "x".repeat(5000);
  const record = buildBearingShadowLogRecord({
    taskContentId: 1,
    claim: { id: 2, text: long, evidenceNeed: { version: 1, derivation: { method: "deterministic_v1" } } },
    candidate: {
      url: "https://example.org/item",
      canonicalUrl: "https://example.org/item",
      title: long,
      snippet: long,
      query: long,
      bearingShadowReason: long,
      deterministicBearingScore: 0.4,
      deterministicBearingComponents: {},
      bearingShadowWouldScrape: true,
    },
    actualSelected: true,
  });

  assert.ok(record.claimText.length <= 500);
  assert.ok(record.title.length <= 500);
  assert.ok(record.snippet.length <= 1000);
  assert.ok(record.query.length <= 500);
  assert.ok(record.reason.length <= 500);
});
