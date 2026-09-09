import assert from "node:assert/strict";
import test from "node:test";

import { createConcurrencyLimiter } from "../src/utils/concurrencyLimiter.js";

test("concurrency limiter never exceeds its configured active task count", async () => {
  const runLimited = createConcurrencyLimiter(2);
  let active = 0;
  let peak = 0;

  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      runLimited(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return index;
      }),
    ),
  );

  assert.equal(peak, 2);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("concurrency limiter releases its slot when a task rejects", async () => {
  const runLimited = createConcurrencyLimiter(1);
  const failed = runLimited(async () => {
    throw new Error("expected failure");
  });
  const recovered = runLimited(async () => "next task ran");

  await assert.rejects(failed, /expected failure/);
  assert.equal(await recovered, "next task ran");
});

