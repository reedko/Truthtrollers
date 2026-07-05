import assert from "node:assert/strict";
import test from "node:test";

import { EvidenceEngine } from "../../src/core/evidenceEngine.js";

// Step 20: many candidate-target assignments may point at one canonical URL, but
// that URL must be fetched/persisted/cleaned exactly once per run; target
// evaluations reuse the cached source object.

const SAME_URL = "https://www.vaccinateyourfamily.org/wp-content/uploads/statement.pdf";

function makeEngine() {
  const fetchCalls = [];
  const evalCalls = [];
  const engine = new EvidenceEngine({
    fetcher: {
      async getText(cand) {
        fetchCalls.push(cand.url);
        // Simulate async fetch + persist + clean producing one source row.
        await new Promise((r) => setTimeout(r, 5));
        return { isProcessed: true, cleanText: "Cleaned source text about the 2004 MMR study.", citationCount: 0, referenceContentId: 9001 };
      },
    },
    async extractQuotesAndScoreQuality({ evaluationTarget }) {
      evalCalls.push(evaluationTarget?.evaluationTargetId ?? null);
      return { quotes: [{ quote: "q", stance: "support", summary: "s" }], qualityScores: null };
    },
  });
  return { engine, fetchCalls, evalCalls };
}

const claim = {
  id: 54064,
  text: "data linking the MMR vaccine to autism had been manipulated by the CDC.",
  evaluationTargets: [
    { evaluationTargetId: 172, evaluationTargetType: "attribution", targetText: "Thompson made the allegation" },
    { evaluationTargetId: 173, evaluationTargetType: "substantive", targetText: "CDC manipulated data" },
    { evaluationTargetId: 174, evaluationTargetType: "original_study", targetText: "the 2004 study" },
  ],
};

const opt = { maxEvidencePerDoc: 2, taskContentId: 16833 };

test("Step 20: three concurrent same-URL assignments fetch/persist/clean once, evaluate per target", async () => {
  const { engine, fetchCalls, evalCalls } = makeEngine();
  const assignments = [172, 173, 174].map((id) => ({
    url: SAME_URL,
    title: "Vaccinate Your Family statement",
    evidenceTargetId: id,
    evidenceTargetType: claim.evaluationTargets.find((t) => t.evaluationTargetId === id).evaluationTargetType,
  }));

  const results = await Promise.all(assignments.map((a) => engine.extractEvidence(claim, a, opt)));

  // Source acquired exactly once despite three concurrent assignments.
  assert.equal(fetchCalls.length, 1, `expected 1 fetch, got ${fetchCalls.length}`);
  // Target-specific evaluation still runs separately for each target.
  assert.deepEqual(evalCalls.sort(), [172, 173, 174]);
  assert.equal(results.length, 3);
  // The cache holds the single canonical source object.
  assert.equal(engine._canonicalSourceCache.size, 1);
});

test("Step 20: _acquireCanonicalSource single-flights concurrent requests and reuses the cache", async () => {
  const { engine, fetchCalls } = makeEngine();
  const cand = { url: SAME_URL, evidenceTargetId: 173 };

  // Concurrent (in-flight coalescing).
  const [a, b, c] = await Promise.all([
    engine._acquireCanonicalSource(cand, claim, opt),
    engine._acquireCanonicalSource(cand, claim, opt),
    engine._acquireCanonicalSource(cand, claim, opt),
  ]);
  assert.equal(fetchCalls.length, 1);
  assert.strictEqual(a, b);
  assert.strictEqual(b, c);

  // Subsequent request (cache hit, no new fetch).
  const d = await engine._acquireCanonicalSource(cand, claim, opt);
  assert.equal(fetchCalls.length, 1);
  assert.strictEqual(d, a);
});

test("Step 20: cache resets between runs so a fresh run refetches", async () => {
  const { engine, fetchCalls } = makeEngine();
  const cand = { url: SAME_URL, evidenceTargetId: 173 };
  await engine._acquireCanonicalSource(cand, claim, opt);
  assert.equal(fetchCalls.length, 1);
  engine._resetCanonicalSourceCache();
  await engine._acquireCanonicalSource(cand, claim, opt);
  assert.equal(fetchCalls.length, 2);
});

test("Step 20: distinct canonical URLs are fetched independently", async () => {
  const { engine, fetchCalls } = makeEngine();
  await Promise.all([
    engine._acquireCanonicalSource({ url: SAME_URL, evidenceTargetId: 1 }, claim, opt),
    engine._acquireCanonicalSource({ url: "https://example.org/other", evidenceTargetId: 2 }, claim, opt),
  ]);
  assert.equal(fetchCalls.length, 2);
  assert.equal(engine._canonicalSourceCache.size, 2);
});
