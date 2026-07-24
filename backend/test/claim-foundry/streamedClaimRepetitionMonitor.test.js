import test from "node:test";
import assert from "node:assert/strict";
import { createStreamedClaimRepetitionMonitor }
  from "./prompt-benchmark/streamedClaimRepetitionMonitor.js";

test("recognizes claimText values split across arbitrary stream chunks", () => {
  const monitor = createStreamedClaimRepetitionMonitor();
  monitor.add('{"candidateClaims":[{"claim');
  monitor.add('Text":"A device failed during te');
  monitor.add('sting.","sourceUnitIds":["U0001"]},{"claimText":"A second claim."}]}');
  const result = monitor.snapshot();
  assert.deepEqual(result.claims.map((item) => item.claimText),
    ["A device failed during testing.", "A second claim."]);
  assert.equal(result.loop, null);
});

test("flags the third normalized occurrence of one claim", () => {
  const monitor = createStreamedClaimRepetitionMonitor({ repetitionThreshold: 3 });
  monitor.add('{"claimText":"The CDC claim repeated."}');
  monitor.add(',{"claimText":"A distinct claim."}');
  monitor.add(',{"claimText":"The CDC claim repeated!"}');
  assert.equal(monitor.snapshot().loop, null);
  monitor.add(',{"claimText":"THE CDC CLAIM REPEATED"}');
  const result = monitor.snapshot();
  assert.equal(result.loop.count, 3);
  assert.equal(result.loop.ordinal, 4);
  assert.equal(result.loop.normalized, "the cdc claim repeated");
});

test("handles quotes and escapes inside a streamed claim", () => {
  const monitor = createStreamedClaimRepetitionMonitor();
  monitor.add('{"claimText":"The ad said \\"safe\\" and used a \\\\ character."}');
  assert.equal(monitor.snapshot().claims[0].claimText,
    'The ad said "safe" and used a \\ character.');
});
