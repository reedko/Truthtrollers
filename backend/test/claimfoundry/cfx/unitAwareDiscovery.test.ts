import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildCfxUnitAwareReportHtml,
} from "../../../src/claimfoundry/cfx/discoveryWithUnits/buildReportHtml.js";
import {
  buildCfxDiscoveryWithUnitsRequest,
  runCfxDiscoveryWithUnits,
} from "../../../src/claimfoundry/cfx/discoveryWithUnits/runDiscoveryWithUnits.js";
import { freezeCfxF03 } from "../../../src/claimfoundry/cfx/input/f03.js";
import {
  CFX_DISCOVERY_WITH_UNITS_PROMPT_SHA256,
  loadCfxDiscoveryWithUnitsPrompt,
} from "../../../src/claimfoundry/cfx/prompts/governedPrompts.js";
import {
  CFX_DISCOVERY_WITH_UNITS_JSON_SCHEMA,
} from "../../../src/claimfoundry/cfx/schemas/discoveryWithUnitsSchema.js";

const repositoryRoot = path.resolve("..");

function output(unitId = "U0001") {
  return {
    propositions: Array.from({ length: 12 }, (_, index) => ({
      assertion: `Assertion ${index + 1}`,
      assertionSource: `Source ${index + 1}`,
      whyItMattersToArticleThesis: `Reason ${index + 1}`,
      groundingUnitIds: [unitId],
    })),
  };
}

test("unit-aware prompt and schema exactly retain the governed additions", async () => {
  const prompt = await loadCfxDiscoveryWithUnitsPrompt();
  assert.equal(prompt.promptHash, CFX_DISCOVERY_WITH_UNITS_PROMPT_SHA256);
  assert.ok(prompt.prompt.endsWith(
    "- The source unit ID or IDs containing the article passage most directly associated with the assertion",
  ));
  assert.equal(
    CFX_DISCOVERY_WITH_UNITS_JSON_SCHEMA.name,
    "cfx_burden_of_proof_with_units_v1",
  );
  const item = (
    CFX_DISCOVERY_WITH_UNITS_JSON_SCHEMA.schema.properties.propositions.items
  );
  assert.ok(item.required.includes("groundingUnitIds"));
});

test("unit-aware request replaces raw article serialization with the complete S0 projection", async () => {
  const article = await freezeCfxF03(repositoryRoot);
  const prompt = await loadCfxDiscoveryWithUnitsPrompt();
  const request = buildCfxDiscoveryWithUnitsRequest({ article, prompt });
  assert.equal(request.user, `${prompt.prompt}\n\n${article.unitProjection}`);
  assert.ok(request.user.includes("[U0001] "));
  assert.ok(request.user.includes(
    `[U${String(article.sourceUnitCount).padStart(4, "0")}] `,
  ));
  assert.equal(request.user.includes("<first S0 block>"), false);
  assert.equal(request.user.includes(article.articleText), false);
});

test("unit-aware discovery makes one call and publishes only known, non-duplicated unit IDs", async () => {
  const article = await freezeCfxF03(repositoryRoot);
  const prompt = await loadCfxDiscoveryWithUnitsPrompt();
  let rawCaptured = false;
  let calls = 0;
  const result = await runCfxDiscoveryWithUnits({
    article,
    prompt,
    provider: {
      async invokeStructured() {
        calls += 1;
        const value = output();
        return {
          output: value,
          rawResponse: { output: value },
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
    async afterResponse() {
      rawCaptured = true;
    },
  });
  assert.equal(calls, 1);
  assert.equal(rawCaptured, true);
  assert.equal(result.status, "completed");
  assert.equal(result.inventory?.propositions.length, 12);
  assert.deepEqual(
    result.inventory?.propositions[0]?.groundingUnitIds,
    ["U0001"],
  );
});

test("unknown and duplicate unit IDs reject publication without erasing raw output", async () => {
  const article = await freezeCfxF03(repositoryRoot);
  const prompt = await loadCfxDiscoveryWithUnitsPrompt();
  const invalid = output();
  invalid.propositions[0]!.groundingUnitIds = ["U9999"];
  invalid.propositions[1]!.groundingUnitIds = ["U0001", "U0001"];
  let captured: unknown;
  const result = await runCfxDiscoveryWithUnits({
    article,
    prompt,
    provider: {
      async invokeStructured() {
        return {
          output: invalid,
          rawResponse: { output: invalid },
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
  assert.equal(result.inventory, null);
  assert.ok(result.diagnostics.some(
    (item) => item.code === "UNKNOWN_GROUNDING_UNIT_ID",
  ));
  assert.ok(result.diagnostics.some(
    (item) => item.code === "DUPLICATE_GROUNDING_UNIT_ID",
  ));
  assert.deepEqual(captured, { output: invalid });
});

test("unit-aware discovery normalizes fixture-valid ID widths and preserves the original diagnostic value", async () => {
  const article = await freezeCfxF03(repositoryRoot);
  const prompt = await loadCfxDiscoveryWithUnitsPrompt();
  const returned = output("U009");
  const result = await runCfxDiscoveryWithUnits({
    article,
    prompt,
    provider: {
      async invokeStructured() {
        return {
          output: returned,
          rawResponse: { output: returned },
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
  });
  assert.equal(result.status, "completed");
  assert.equal(
    result.inventory?.propositions[0]?.groundingUnitIds[0],
    "U0009",
  );
  assert.equal(
    (result.rawOutput as typeof returned).propositions[0]!
      .groundingUnitIds[0],
    "U009",
  );
  const diagnostic = result.diagnostics.find(
    (item) => item.code === "GROUNDING_UNIT_ID_NORMALIZED",
  );
  assert.equal(diagnostic?.comparison?.originalReturnedValue, "U009");
  assert.equal(diagnostic?.comparison?.canonicalUnitId, "U0009");
  assert.equal(diagnostic?.comparison?.normalizationOccurred, true);
  assert.equal(diagnostic?.comparison?.fixtureId, article.fixtureId);
});

test("malformed returned IDs fail structurally with the original value in diagnostics", async () => {
  const article = await freezeCfxF03(repositoryRoot);
  const prompt = await loadCfxDiscoveryWithUnitsPrompt();
  const returned = output("U1-U2");
  const result = await runCfxDiscoveryWithUnits({
    article,
    prompt,
    provider: {
      async invokeStructured() {
        return {
          output: returned,
          rawResponse: { output: returned },
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
  });
  assert.equal(result.status, "failed");
  assert.equal(result.inventory, null);
  const diagnostic = result.diagnostics.find(
    (item) => item.code === "MALFORMED_UNIT_ID",
  );
  assert.equal(diagnostic?.comparison?.originalReturnedValue, "U1-U2");
  assert.equal(diagnostic?.comparison?.canonicalUnitId, null);
  assert.equal(diagnostic?.comparison?.normalizationOccurred, false);
});

test("unit-aware report renders returned IDs with escaped canonical unit text", async () => {
  const article = await freezeCfxF03(repositoryRoot);
  const inventory = {
    schemaVersion: "cfx.unitAwarePropositions.v1" as const,
    fixtureId: article.fixtureId,
    propositions: output().propositions.map((row, index) => ({
      propositionId: `P${String(index + 1).padStart(2, "0")}`,
      ...row,
      assertion: index === 0 ? "<script>bad</script>" : row.assertion,
    })),
  };
  const html = buildCfxUnitAwareReportHtml({
    runId: "run",
    generatedAt: "2026-07-31T00:00:00.000Z",
    article,
    inventory,
    model: "test",
    promptHash: "prompt",
    schemaHash: "schema",
    requestHash: "request",
    canonicalInventoryHash: "inventory",
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      totalTokens: 2,
    },
    latencyMs: 1,
  });
  assert.equal(html.includes("<script>bad</script>"), false);
  assert.ok(html.includes("&lt;script&gt;bad&lt;/script&gt;"));
  assert.ok(html.includes("U0001"));
  assert.ok(html.includes(article.sourceUnits[0]!.text));
});
