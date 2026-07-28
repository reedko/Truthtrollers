import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  Usage,
  type Model,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "@openai/agents";
import { z } from "zod";
import {
  runAgent,
  type AgentDefinition,
} from "../../shared/agentRuntime.js";

class SpyModel implements Model {
  readonly requests: ModelRequest[] = [];

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    return {
      usage: new Usage({
        requests: 1,
        input_tokens: 20,
        output_tokens: 5,
        total_tokens: 25,
        input_tokens_details: { cached_tokens: 0 },
      }),
      responseId: "resp-spy-1",
      requestId: "req-spy-1",
      output: [{
        id: "msg-spy-1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{
          type: "output_text",
          text: JSON.stringify({ status: "finished" }),
        }],
      }],
    };
  }

  async *getStreamedResponse(_request: ModelRequest): AsyncIterable<any> {
    throw new Error("Streaming is not used in the CF6 proof");
  }
}

class SpyProvider implements ModelProvider {
  readonly model = new SpyModel();
  getModelCalls = 0;

  async getModel(): Promise<Model> {
    this.getModelCalls += 1;
    return this.model;
  }
}

test("oneAgentRun.noOutOfBandModelCalls", async () => {
  const provider = new SpyProvider();
  const outputType = z.object({ status: z.literal("finished") }).strict();
  const definition: AgentDefinition<z.infer<typeof outputType>> = {
    name: "CF6 one-run boundary proof",
    instructions: "Return the required typed result.",
    outputType,
    tools: [],
    modelSettings: { parallelToolCalls: false },
  };

  const result = await runAgent({
    definition,
    input: "Complete the boundary proof.",
    model: "spy-model",
    modelProvider: provider,
    budget: { maxModelTurns: 6, maxToolCalls: 1, maxWallTimeMs: 10_000 },
    runtimeRunId: "one-agent-run-proof",
    conversationId: "conv-one-agent-run-proof",
    maxFunctionToolConcurrency: 1,
  });

  assert.deepEqual(result.finalOutput, { status: "finished" });
  assert.equal(result.runtimeEvidence.runnerInvocations, 1);
  assert.equal(result.runtimeEvidence.providerRequests, 1);
  assert.equal(result.runtimeEvidence.continuationStrategy, "conversationId");
  assert.equal(provider.getModelCalls, 1);
  assert.equal(provider.model.requests.length, 1);
  assert.equal(
    provider.model.requests[0]!.conversationId,
    "conv-one-agent-run-proof",
  );
  assert.equal(provider.model.requests[0]!.previousResponseId, undefined);
  assert.equal(provider.model.requests[0]!.modelSettings.parallelToolCalls, false);
});

test("tools and deterministic services have no model boundary imports", () => {
  const files = [
    "../../claimFoundry/claimFoundryTools.ts",
    "../../claimFoundry/claimFoundryValidation.ts",
    "../../claimFoundry/claimFoundryCoverage.ts",
    "../../claimFoundry/claimFoundryRequestAssertions.ts",
  ];
  const forbidden = [
    "@openai/agents",
    "OpenAI",
    "responses.create",
    "Runner.run",
    "runAgent(",
    "apiKey",
  ];
  for (const relative of files) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const source = readFileSync(path, "utf8");
    for (const marker of forbidden) {
      assert.equal(source.includes(marker), false, `${relative}: ${marker}`);
    }
  }

  const runtimePath = fileURLToPath(
    new URL("../../shared/agentRuntime.ts", import.meta.url),
  );
  const runtimeSource = readFileSync(runtimePath, "utf8");
  assert.equal(runtimeSource.match(/runner\.run\(/g)?.length, 1);

  const wholeArticleRunnerPath = fileURLToPath(
    new URL("../../claimFoundry/claimFoundryWholeArticleRunner.ts", import.meta.url),
  );
  const wholeArticleRunnerSource = readFileSync(
    wholeArticleRunnerPath,
    "utf8",
  );
  assert.equal(
    wholeArticleRunnerSource.match(/\brunAgent\(\{/g)?.length,
    1,
  );
  assert.equal(wholeArticleRunnerSource.includes("responses.create"), false);
  assert.equal(wholeArticleRunnerSource.includes("new Runner("), false);
  assert.equal(wholeArticleRunnerSource.includes("new Agent("), false);
});
