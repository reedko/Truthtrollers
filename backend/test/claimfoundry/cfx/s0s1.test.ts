import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildCfxDiscoveryRequest,
  DEFAULT_CFX_DISCOVERY_CONFIG,
  runCfxDiscovery,
} from "../../../src/claimfoundry/cfx/discovery/runDiscovery.js";
import {
  freezeCfxF03,
} from "../../../src/claimfoundry/cfx/input/f03.js";
import {
  CFX_DISCOVERY_PROMPT_SHA256,
  CFX_EXACT_GROUNDING_PROMPT_SHA256,
  loadCfxDiscoveryPrompt,
  loadCfxExactGroundingPrompt,
} from "../../../src/claimfoundry/cfx/prompts/governedPrompts.js";
import type {
  CfxStructuredProvider,
} from "../../../src/claimfoundry/cfx/types/index.js";

const repositoryRoot = path.resolve("..");

function output(assertionPrefix = "Assertion") {
  return {
    propositions: Array.from({ length: 12 }, (_, index) => ({
      assertion: `${assertionPrefix} ${index + 1}`,
      assertionSource: `Source ${index + 1}`,
      whyItMattersToArticleThesis: `Reason ${index + 1}`,
    })),
  };
}

test("S0 freezes a deterministic full article and source-unit projection", async () => {
  const first = await freezeCfxF03(repositoryRoot);
  const second = await freezeCfxF03(repositoryRoot);
  assert.equal(first.fixtureFileSha256, second.fixtureFileSha256);
  assert.equal(first.articleTextSha256, second.articleTextSha256);
  assert.equal(first.sourceUnitManifestHash, second.sourceUnitManifestHash);
  assert.equal(first.unitProjectionSha256, second.unitProjectionSha256);
  assert.equal(first.sourceUnitCount, second.sourceUnitCount);
  assert.ok(first.sourceUnitCount > 300);
  assert.match(first.unitProjection, /^\[U0001\] /);
  assert.equal(
    first.sourceUnits.map((unit) => unit.unitId).at(-1),
    `U${String(first.sourceUnitCount).padStart(4, "0")}`,
  );
});

test("governed S1 and S2 prompts retain their frozen hashes", async () => {
  const discovery = await loadCfxDiscoveryPrompt();
  const grounding = await loadCfxExactGroundingPrompt();
  assert.equal(discovery.promptHash, CFX_DISCOVERY_PROMPT_SHA256);
  assert.equal(grounding.promptHash, CFX_EXACT_GROUNDING_PROMPT_SHA256);
  assert.equal(
    discovery.prompt,
    "Read the article.\n\nReturn the 12 propositions that carry the burden of proof for the article.\n\nThese are the assertions that, if shown false, would most undermine the article's overall argument.\n\nFor each provide:\n\n- Assertion\n- Assertion source\n- Why it matters to the article's thesis",
  );
});

test("S1 request contains the simple prompt and complete article without legacy inputs", async () => {
  const article = await freezeCfxF03(repositoryRoot);
  const prompt = await loadCfxDiscoveryPrompt();
  const request = buildCfxDiscoveryRequest({ article, prompt });
  assert.equal(
    request.user,
    `${prompt.prompt}\n\n${article.articleText}`,
  );
  assert.equal(request.user.includes("[U0001]"), false);
  assert.equal(request.user.includes("semantic group"), false);
  assert.equal(request.user.includes("working package"), false);
  assert.equal(request.retryCount, 0);
  assert.equal(request.store, false);
});

test("S1 makes one call, preserves raw response before validation, and assigns immutable IDs", async () => {
  const article = await freezeCfxF03(repositoryRoot);
  const prompt = await loadCfxDiscoveryPrompt();
  const events: string[] = [];
  let calls = 0;
  const rawOutput = output();
  const provider: CfxStructuredProvider = {
    async invokeStructured() {
      calls += 1;
      return {
        output: rawOutput,
        rawResponse: { id: "raw-1", output: rawOutput },
        model: "gpt-4o-mini-test",
        usage: {
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 50,
          totalTokens: 150,
        },
        responseId: "response-1",
        requestId: "request-1",
      };
    },
  };
  const result = await runCfxDiscovery({
    article,
    prompt,
    provider,
    config: { ...DEFAULT_CFX_DISCOVERY_CONFIG },
    async beforeInvoke() {
      events.push("request");
    },
    async afterResponse() {
      events.push("raw");
    },
  });
  events.push("validated");
  assert.equal(calls, 1);
  assert.deepEqual(events, ["request", "raw", "validated"]);
  assert.equal(result.status, "completed");
  assert.equal(result.canonicalInventory?.propositions.length, 12);
  assert.deepEqual(
    result.canonicalInventory?.propositions.map((row) => row.propositionId),
    Array.from({ length: 12 }, (_, index) =>
      `P${String(index + 1).padStart(2, "0")}`),
  );
  assert.equal(
    result.canonicalInventory?.propositions[0]?.assertion,
    rawOutput.propositions[0]!.assertion,
  );
});

test("S1 rejects duplicate normalized assertions without losing raw output", async () => {
  const article = await freezeCfxF03(repositoryRoot);
  const prompt = await loadCfxDiscoveryPrompt();
  const duplicateOutput = output();
  duplicateOutput.propositions[1]!.assertion = "  assertion   1 ";
  let captured: unknown;
  const result = await runCfxDiscovery({
    article,
    prompt,
    provider: {
      async invokeStructured() {
        return {
          output: duplicateOutput,
          rawResponse: { output: duplicateOutput },
          model: "test",
          usage: {
            inputTokens: 1,
            cachedInputTokens: 0,
            outputTokens: 1,
            totalTokens: 2,
          },
          responseId: null,
          requestId: null,
        };
      },
    },
    async afterResponse(value) {
      captured = value.rawResponse;
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.canonicalInventory, null);
  assert.ok(result.diagnostics.some(
    (item) => item.code === "DUPLICATE_NORMALIZED_ASSERTION",
  ));
  assert.deepEqual(captured, { output: duplicateOutput });
});
