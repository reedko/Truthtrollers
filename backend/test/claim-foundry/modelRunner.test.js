import test from "node:test";
import assert from "node:assert/strict";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";

const REQUEST = {
  system: "system", user: "user", responseSchema: { name: "test", schema: {} },
  model: "fake-model", temperature: 0, timeoutMs: 1_000,
};

test("model runner returns structured output and normalized usage telemetry", async () => {
  const records = [];
  const runner = createCf1ModelRunner({
    transport: { invoke: async () => ({ output: { ok: true }, model: "fake-model-v1",
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, prompt_tokens_details: { cached_tokens: 3 } } }) },
    usageRecorder: (usage) => records.push(usage),
  });
  const result = await runner.invokeStructured(REQUEST);
  assert.deepEqual(result.output, { ok: true });
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedInputTokens: 3 });
  assert.equal(result.attempts, 1);
  assert.equal(records.length, 1);
});

test("one transport retry is allowed when no usable response exists", async () => {
  let attempts = 0;
  const runner = createCf1ModelRunner({ transport: { invoke: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary transport failure");
    return { output: JSON.stringify({ repairedTransport: true }), usage: {} };
  } } });
  const result = await runner.invokeStructured(REQUEST);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.output, { repairedTransport: true });
});

test("caller can forbid transport retries", async () => {
  let attempts = 0;
  const runner = createCf1ModelRunner({ transport: { invoke: async () => {
    attempts += 1;
    throw new Error("transport failure");
  } } });
  await assert.rejects(
    runner.invokeStructured({ ...REQUEST, maximumAttempts: 1 }),
    (error) => error.code === "CF1_MODEL_UNAVAILABLE"
      && error.message === "No usable structured model response after 1 attempt",
  );
  assert.equal(attempts, 1);
});

test("usage from a malformed received response remains in retry totals", async () => {
  let attempts = 0;
  const records = [];
  const runner = createCf1ModelRunner({
    transport: { invoke: async () => {
      attempts += 1;
      if (attempts === 1) return { output: "not-json", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } };
      return { output: { usable: true }, usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } };
    } },
    usageRecorder: (usage) => records.push(usage),
  });
  const result = await runner.invokeStructured(REQUEST);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 5, totalTokens: 23, cachedInputTokens: 0 });
  assert.equal(records.length, 2);
});

test("usage attached to a thrown provider parse error remains in retry totals", async () => {
  let calls = 0;
  const runner = createCf1ModelRunner({ transport: { invoke: async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("provider JSON parse failed"), {
      usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 }, model: "fixture",
    });
    return { output: { ready: true }, usage: { total_tokens: 5 }, model: "fixture" };
  } } });
  const result = await runner.invokeStructured(REQUEST);
  assert.equal(result.usage.totalTokens, 20);
  assert.equal(result.attempts, 2);
});

test("two unusable responses terminate with a typed transient failure", async () => {
  const runner = createCf1ModelRunner({ transport: { invoke: async () => ({ output: "not-json" }) } });
  await assert.rejects(
    runner.invokeStructured(REQUEST),
    (error) => error.code === "CF1_MODEL_UNAVAILABLE" && error.retryable === true,
  );
});

test("telemetry failure does not repeat a successful model call", async () => {
  let calls = 0;
  const runner = createCf1ModelRunner({
    transport: { invoke: async () => { calls += 1; return { output: { ok: true }, usage: {} }; } },
    usageRecorder: () => { throw new Error("telemetry unavailable"); },
  });
  const result = await runner.invokeStructured(REQUEST);
  assert.equal(calls, 1);
  assert.equal(result.telemetryWarning.code, "CF1_USAGE_RECORD_FAILED");
});

test("invalid model requests fail before invoking transport", async () => {
  let calls = 0;
  const runner = createCf1ModelRunner({ transport: { invoke: async () => { calls += 1; } } });
  await assert.rejects(runner.invokeStructured({ ...REQUEST, model: "" }), (error) => error.code === "CF1_INVALID_MODEL_REQUEST");
  assert.equal(calls, 0);
});

test("truncated structured output fails without a second transport attempt", async () => {
  let calls = 0;
  const runner = createCf1ModelRunner({ transport: { invoke: async () => {
    calls += 1;
    return { output: "{\"partial\":", finish_reason: "length", usage: { total_tokens: 99 } };
  } } });
  await assert.rejects(runner.invokeStructured({ ...REQUEST, maximumAttempts: 1 }),
    (error) => error.code === "CF1_MODEL_UNAVAILABLE"
      && error.cause?.code === "CF1_MODEL_OUTPUT_TRUNCATED");
  assert.equal(calls, 1);
});

test("excessive trailing whitespace fails before JSON parsing", async () => {
  const runner = createCf1ModelRunner({ transport: { invoke: async () => ({
    output: `{\"ok\":true}${" ".repeat(1_025)}`, usage: {},
  }) } });
  await assert.rejects(runner.invokeStructured({ ...REQUEST, maximumAttempts: 1 }),
    (error) => error.cause?.code === "CF1_MODEL_EXCESSIVE_WHITESPACE");
});
