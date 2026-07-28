import assert from "node:assert/strict";
import test from "node:test";
import {
  Usage,
  type Model,
  type ModelProvider,
  type ModelResponse,
} from "@openai/agents";
import { z } from "zod";
import {
  runAgent,
  type AgentDefinition,
} from "../../shared/agentRuntime.js";

const names = [
  "update_working_package",
  "inspect_working_package",
  "finalize_working_package",
  "abstain_or_request_review",
] as const;

test("multiple emitted state calls execute in order with no overlap", async () => {
  let active = 0;
  let maximumActive = 0;
  const started: string[] = [];
  const finished: string[] = [];
  const invocationIds: Array<string | null> = [];
  const output = z.object({ status: z.literal("finished") }).strict();
  const definition: AgentDefinition<z.infer<typeof output>> = {
    name: "serialized-state-tools",
    instructions: "Execute the supplied deterministic state calls.",
    outputType: output,
    modelSettings: { parallelToolCalls: false },
    toolUseBehavior: () => ({
      isFinalOutput: true,
      isInterrupted: undefined,
      finalOutput: JSON.stringify({ status: "finished" }),
    }),
    tools: names.map(name => ({
      name,
      description: `Serialized probe for ${name}.`,
      parameters: z.object({ sequence: z.number().int() }).strict(),
      execute: async ({ sequence }, invocation) => {
        invocationIds.push(invocation?.toolCallId ?? null);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        started.push(`${sequence}:${name}`);
        await new Promise(resolve => setTimeout(resolve, 5));
        finished.push(`${sequence}:${name}`);
        active -= 1;
        return { sequence, name };
      },
    })),
  };

  class MultiCallModel implements Model {
    async getResponse(): Promise<ModelResponse> {
      return {
        usage: new Usage({
          requests: 1,
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
        }),
        responseId: "resp-multi-state",
        output: names.map((name, index) => ({
          type: "function_call" as const,
          callId: `call-${index}`,
          name,
          status: "completed" as const,
          arguments: JSON.stringify({ sequence: index + 1 }),
        })),
      };
    }
    async *getStreamedResponse(): AsyncIterable<any> {
      throw new Error("Streaming is not used");
    }
  }
  const provider: ModelProvider = {
    async getModel() {
      return new MultiCallModel();
    },
  };

  const result = await runAgent({
    definition,
    input: "Run the probes.",
    model: "script-model",
    modelProvider: provider,
    conversationId: "conv-serialized-tools",
    budget: { maxModelTurns: 6, maxToolCalls: 4, maxWallTimeMs: 10_000 },
    maxFunctionToolConcurrency: 1,
  });

  assert.equal(maximumActive, 1);
  assert.deepEqual(started, names.map((name, index) => `${index + 1}:${name}`));
  assert.deepEqual(finished, started);
  assert.deepEqual(
    invocationIds,
    names.map((_name, index) => `call-${index}`),
  );
  assert.equal(result.metadata.modelTurns, 1);
  assert.equal(result.toolEvents.length, 4);
});
