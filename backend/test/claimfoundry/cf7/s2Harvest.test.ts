import assert from "node:assert/strict";
import test from "node:test";
import type {
  Cf7StructuredModelRequest,
  Cf7StructuredProvider,
} from "../../../src/claimfoundry/shared/provider/index.js";
import {
  createOpenAiCf7StructuredProvider,
} from "../../../src/claimfoundry/shared/provider/index.js";
import {
  buildCf7HarvestUserPrompt,
  CF7_HARVEST_SYSTEM_PROMPT,
} from "../../../src/claimfoundry/cf7/extraction/prompt.js";
import {
  CF7_HARVEST_JSON_SCHEMA,
} from "../../../src/claimfoundry/cf7/extraction/schema.js";
import {
  runCf7Harvest,
} from "../../../src/claimfoundry/cf7/extraction/runHarvest.js";
import type {
  Cf7Chunk,
  Cf7SourceUnit,
} from "../../../src/claimfoundry/cf7/types/index.js";

const units: Cf7SourceUnit[] = Array.from({ length: 6 }, (_, index) => ({
  unitId: `U${String(index + 1).padStart(4, "0")}`,
  text: `Sentence ${index + 1}.`,
  charStart: index * 20,
  charEnd: index * 20 + 11,
  regionId: "REGION-001",
  quarter: Math.min(4, Math.floor(index / 2) + 1) as 1 | 2 | 3 | 4,
}));

const chunks: Cf7Chunk[] = [
  {
    chunkId: "CHUNK-001",
    chunkIndex: 1,
    chunkCount: 3,
    unitIds: ["U0001", "U0002"],
    regionIds: ["REGION-001"],
    overlapUnitIds: [],
    tokenEstimate: 10,
    text: "Sentence 1. Sentence 2.",
  },
  {
    chunkId: "CHUNK-002",
    chunkIndex: 2,
    chunkCount: 3,
    unitIds: ["U0002", "U0003", "U0004"],
    regionIds: ["REGION-001"],
    overlapUnitIds: ["U0002"],
    tokenEstimate: 15,
    text: "Sentence 2. Sentence 3. Sentence 4.",
  },
  {
    chunkId: "CHUNK-003",
    chunkIndex: 3,
    chunkCount: 3,
    unitIds: ["U0004", "U0005", "U0006"],
    regionIds: ["REGION-001"],
    overlapUnitIds: ["U0004"],
    tokenEstimate: 15,
    text: "Sentence 4. Sentence 5. Sentence 6.",
  },
];

function response(output: unknown) {
  return {
    output,
    model: "test-model",
    usage: {
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 20,
      totalTokens: 120,
    },
    responseId: "response-test",
    requestId: "request-test",
  };
}

test("S2 schedules every chunk once with bounded parallelism and validates grounding", async () => {
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const provider: Cf7StructuredProvider = {
    async invokeStructured() {
      const call = calls;
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      if (call === 0) {
        return response({
          disputedAssertions: [{
            assertionText: "Sentence 1 is disputed.",
            groundingUnitIds: ["U0001"],
          }],
          assertions: [],
        });
      }
      if (call === 1) {
        return response({
          disputedAssertions: [],
          assertions: [
            {
              assertionText: "Sentence 3 is factual.",
              groundingUnitIds: ["U0003"],
            },
            {
              assertionText: "Foreign grounding is rejected.",
              groundingUnitIds: ["U9999"],
            },
          ],
        });
      }
      return response({ disputedAssertions: [], assertions: [] });
    },
  };

  const result = await runCf7Harvest({
    chunks,
    units,
    provider,
    config: {
      model: "test-model",
      maximumConcurrency: 2,
      maxOutputTokens: 1_000,
      timeoutMs: 1_000,
      temperature: 0,
      retryCount: 0,
      store: false,
    },
  });

  assert.equal(calls, chunks.length);
  assert.equal(result.expectedHarvestCallCount, chunks.length);
  assert.equal(result.harvestCallCount, chunks.length);
  assert.equal(maximumActive, 2);
  assert.equal(result.status, "completed");
  assert.equal(result.inventory.length, 2);
  assert.equal(
    result.findings.filter((finding) =>
      finding.code === "CF7_OUT_OF_RANGE_GROUNDING").length,
    1,
  );
  assert.equal(
    result.findings.filter((finding) =>
      finding.code === "CF7_EMPTY_CHUNK").length,
    1,
  );
  assert.equal(result.accounting.requestCount, 3);
  assert.equal(result.accounting.totalTokens, 360);
});

test("provider failures do not prevent later chunks from being scheduled", async () => {
  let calls = 0;
  const provider: Cf7StructuredProvider = {
    async invokeStructured() {
      calls += 1;
      if (calls === 1) throw new Error("synthetic provider failure");
      return response({ disputedAssertions: [], assertions: [] });
    },
  };
  const result = await runCf7Harvest({
    chunks,
    units,
    provider,
    config: {
      model: "test-model",
      maximumConcurrency: 1,
      maxOutputTokens: 1_000,
      timeoutMs: 1_000,
      temperature: 0,
      retryCount: 0,
      store: false,
    },
  });
  assert.equal(calls, chunks.length);
  assert.equal(result.harvestCallCount, chunks.length);
  assert.equal(result.status, "failed");
  assert.equal(result.accounting.failedRequestCount, 1);
});

test("the governed prompt and schema retain assertion terminology and key order", () => {
  const user = buildCf7HarvestUserPrompt(chunks[0]!, units);
  const modelFacingText = `${CF7_HARVEST_SYSTEM_PROMPT}\n${user}`;
  assert.doesNotMatch(modelFacingText, /\b(?:claim|claims|proposition|propositions)\b/i);
  assert.match(user, /\[U0001\] Sentence 1\./);
  assert.deepEqual(
    Object.keys(CF7_HARVEST_JSON_SCHEMA.schema.properties),
    ["disputedAssertions", "assertions"],
  );
  assert.equal(CF7_HARVEST_JSON_SCHEMA.name, "cf7_harvest_v1");
  assert.equal(CF7_HARVEST_JSON_SCHEMA.strict, true);
});

test("each provider request receives the bounded strict schema", async () => {
  const requests: Cf7StructuredModelRequest[] = [];
  const provider: Cf7StructuredProvider = {
    async invokeStructured(request) {
      requests.push(request);
      return response({ disputedAssertions: [], assertions: [] });
    },
  };
  await runCf7Harvest({
    chunks: [chunks[0]!],
    units,
    provider,
    config: {
      model: "test-model",
      maximumConcurrency: 1,
      maxOutputTokens: 777,
      timeoutMs: 2_000,
      temperature: 0,
      retryCount: 0,
      store: false,
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.maxOutputTokens, 777);
  assert.equal(requests[0]!.retryCount, 0);
  assert.equal(requests[0]!.store, false);
  assert.equal(requests[0]!.responseSchema, CF7_HARVEST_JSON_SCHEMA);
});

test("the repository Chat Completions transport receives one attempt and store false", async () => {
  const inputs: Array<Record<string, unknown>> = [];
  const provider = createOpenAiCf7StructuredProvider({
    async generate(input) {
      inputs.push(input);
      return {
        output: { disputedAssertions: [], assertions: [] },
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
        model: "gpt-4o-mini",
        rawResponse: { id: "chatcmpl-test" },
      };
    },
  });
  await provider.invokeStructured({
    system: CF7_HARVEST_SYSTEM_PROMPT,
    user: "test",
    responseSchema: CF7_HARVEST_JSON_SCHEMA,
    model: "gpt-4o-mini",
    temperature: 0.2,
    retryCount: 0,
    store: false,
    maxOutputTokens: 4_000,
    timeoutMs: 180_000,
  });
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]!.model, "gpt-4o-mini");
  assert.equal(inputs[0]!.temperature, 0.2);
  assert.equal(inputs[0]!.maxRetries, 1);
  assert.equal(inputs[0]!.store, false);
  assert.equal(inputs[0]!.maxOutputTokens, 4_000);
  assert.equal(inputs[0]!.timeout, 180_000);
});
