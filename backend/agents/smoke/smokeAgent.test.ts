import assert from "node:assert/strict";
import test from "node:test";
import { readSmokeEnvironment } from "../shared/environment.js";
import { runAgent } from "../shared/agentRuntime.js";
import { SMOKE_RUN_BUDGET } from "../shared/runBudget.js";
import { smokeAgentDefinition } from "./smokeAgent.js";

test("live/billable: SDK manages a bounded typed tool loop", async () => {
  const environment = readSmokeEnvironment();
  const result = await runAgent({
    definition: smokeAgentDefinition,
    input: "Normalize this exact text:   CF6   SDK\nmanaged   loop  ",
    model: environment.model,
    apiKey: environment.apiKey,
    budget: SMOKE_RUN_BUDGET,
  });

  assert.equal(result.toolEvents.length, 1);
  assert.equal(result.toolEvents[0]?.name, "normalize_whitespace");
  assert.deepEqual(result.toolEvents[0]?.validatedArguments, {
    text: "  CF6   SDK\nmanaged   loop  ",
  });
  assert.equal(result.finalOutput.normalizedText, "CF6 SDK managed loop");
  assert.equal(result.finalOutput.characterCount, 20);
  assert.equal(result.finalOutput.wordCount, 4);
  assert.equal(result.finalOutput.toolUsed, "normalize_whitespace");
  assert.ok(result.sdkEventTypes.includes("tool_call_item"));
  assert.ok(result.sdkEventTypes.includes("tool_call_output_item"));
  assert.equal(result.metadata.toolCalls, 1);
  assert.ok(result.metadata.modelTurns >= 2);
  assert.ok(result.metadata.modelTurns <= SMOKE_RUN_BUDGET.maxModelTurns);
  assert.ok(result.metadata.durationMs <= SMOKE_RUN_BUDGET.maxWallTimeMs);
  assert.match(result.metadata.traceId, /^trace_/);
  assert.equal(result.metadata.terminationReason, "completed");

  console.log(JSON.stringify(result, null, 2));
});
