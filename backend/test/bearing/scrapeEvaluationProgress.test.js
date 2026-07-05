import assert from "node:assert/strict";
import test from "node:test";

import {
  getScrapeEvaluationStatus,
  setScrapeEvaluationStatus,
  updateScrapeEvaluationProgress,
} from "../../src/core/scrapeEvaluationRegistry.js";

test("R8 progress updates retain independent counts and advance refresh version", () => {
  const contentId = 990001;
  const started = setScrapeEvaluationStatus(contentId, "running", {
    counts: {
      sourcesDiscovered: 12,
      sourcesProcessed: 0,
      bearingAssertionsFound: 0,
      claimLevelLinksPersisted: 0,
    },
  });
  const processed = updateScrapeEvaluationProgress(contentId, {
    counts: {
      sourcesProcessed: 1,
      bearingAssertionsFound: 3,
      claimLevelLinksPersisted: 2,
    },
  });

  assert.ok(processed.progressVersion > started.progressVersion);
  assert.deepEqual(processed.counts, {
    sourcesDiscovered: 12,
    sourcesProcessed: 1,
    bearingAssertionsFound: 3,
    claimLevelLinksPersisted: 2,
  });
  assert.deepEqual(getScrapeEvaluationStatus(contentId), processed);
});

test("R8 terminal reconciliation preserves counts and exposes per-claim unresolved reasons", () => {
  const contentId = 990002;
  setScrapeEvaluationStatus(contentId, "running", {
    counts: { sourcesDiscovered: 4, sourcesProcessed: 4 },
  });
  const completed = setScrapeEvaluationStatus(contentId, "complete", {
    counts: {
      sourcesDiscovered: 4,
      sourcesProcessed: 4,
      bearingAssertionsFound: 0,
      claimLevelLinksPersisted: 0,
    },
    claims: [{
      claimId: 52882,
      bearingAssertionsFound: 0,
      unresolvedReason: "No source specifically addressed an order to destroy evidence.",
    }],
  });

  assert.equal(completed.status, "complete");
  assert.equal(completed.counts.claimLevelLinksPersisted, 0);
  assert.match(completed.claims[0].unresolvedReason, /order to destroy evidence/);
});
