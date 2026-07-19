import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runCall1Split } from "./prompt-benchmark/runCall1Split.js";
import { prepareArticle } from "./prompt-benchmark/generationRun.js";
import { CF1_SEMANTIC_INVENTORY_SCHEMA } from "../../src/claim-foundry/prompts/semanticInventorySchema.js";

// A stub model runner: returns canned 1A then 1B output, records each call's
// stage and schema so the test can assert the pipeline shape without any API.
function stubRunner({ inventory1a, call1b }) {
  const calls = [];
  return { calls, invokeStructured(request) {
    calls.push({ stage: request.usageContext.stage, schema: request.responseSchema.name,
      model: request.model });
    const discovery = request.responseSchema.name.startsWith("cf1_semantic_inventory_split_discovery");
    const output = discovery ? inventory1a : call1b;
    return Promise.resolve({ output, usage: { totalTokens: 10, cachedInputTokens: 3 }, attempts: 1,
      model: "gpt-test", rawResponse: { id: discovery ? "chatcmpl-1a" : "chatcmpl-1b",
        system_fingerprint: "fp_test", model: "gpt-test", service_tier: "default",
        created: 123, choices: [{ finish_reason: "stop" }] } });
  } };
}

test("runs 1A then 1B and emits a merged cf1_semantic_inventory_v1 even with no census outcomes", async () => {
  const raw = JSON.parse(readFileSync(new URL("./fixtures/CF1-F02/article.json", import.meta.url)));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const firstUnitId = articleDocument.sourceUnits.find((u) => u.type === "quotation").unitId;

  const inventory1a = {
    theme: { text: "Glyphosate safety is manufactured, not scientific.", sourceUnitIds: ["U0001"] },
    thesis: { text: "Regulators approve glyphosate on industry-shaped evidence.", sourceUnitIds: ["U0001"] },
    pillars: [{ label: "Regulatory capture", text: "p", importance: "load_bearing", sourceUnitIds: ["U0001"] }],
    thesisHinge: "substance",
    candidateClaims: [
      { claimText: "Commercial glyphosate formulations are far more toxic than glyphosate alone",
        sourceUnitIds: [firstUnitId], materiality: "high", relatedPillarLabels: ["Regulatory capture"],
        scope: "commercial products", evidenceUsefulnessHint: "Toxicology of full formulations vs the isolated compound.",
        attributionContextUnitIds: [firstUnitId] },
    ],
  };
  const call1b = {
    candidateJudgments: [{ candidateId: "CAND01", assertionSource: "Michael Antoniou",
      assertionSourceUnitIds: [firstUnitId], assertionSourceResolution: "resolved_from_context",
      contentStance: "supports_thesis", articleDeployment: "endorsed", articleRole: "pillar",
      sourceUnitIds: [firstUnitId], responseUnitIds: [],
      needsSplit: { split: false, reason: null } }],
  };
  const runner = stubRunner({ inventory1a, call1b });
  const result = await runCall1Split({ article, structuralBlocks,
    sourceUnits: articleDocument.sourceUnits, modelRunner: runner,
    options: { arm: "attribution-v3", model: "gpt-test", seed: 42, temperature: 0 } });

  // Exactly two model calls, in order, with the two split schemas.
  assert.deepEqual(runner.calls.map((c) => c.stage), ["semantic_inventory_1a", "source_posture_1b"]);
  assert.deepEqual(runner.calls.map((c) => c.schema),
    ["cf1_semantic_inventory_split_discovery_attribution_v2", "cf1_call1b_source_posture_attribution_v2"]);
  assert.deepEqual(runner.calls.map((c) => c.model), ["gpt-test", "gpt-test"]);

  // Output is a merged live-shaped inventory.
  assert.deepEqual(Object.keys(result.inventory).sort(),
    ["candidateClaims", "pillars", "theme", "thesis", "thesisHinge"]);
  const required = [...CF1_SEMANTIC_INVENTORY_SCHEMA.schema.properties.candidateClaims.items.required].sort();
  assert.deepEqual(Object.keys(result.inventory.candidateClaims[0]).sort(), required);
  assert.equal(result.inventory.candidateClaims[0].assertionSource, "Michael Antoniou");
  assert.equal(result.hostSignals[0].assertionSourceClass, "attributed_testimony");
  assert.equal(result.hostSignals[0].scoreTransform, "normal");

  // The census ran as a host-only diagnostic and never entered the 1B payload.
  assert.ok(result.censusDiagnostic.summary.totalPackets > 0, "census should surface items on F02");
  assert.ok(!result.raw.packets.some((packet) => packet.origin === "census"));
  assert.equal(result.raw.call1b.censusOutcomes, undefined);
  assert.equal(result.usage.totalTokens, 20);
  assert.equal(result.modelCalls.call1a.response.responseId, "chatcmpl-1a");
  assert.equal(result.modelCalls.call1b.response.responseId, "chatcmpl-1b");
  assert.equal(result.modelCalls.call1b.response.systemFingerprint, "fp_test");
  assert.equal(result.modelCalls.call1b.request.seed, 42);
  assert.match(result.modelCalls.call1b.request.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(result.modelCalls.call1b.request.schemaSha256, /^[a-f0-9]{64}$/);
});

test("can pin different models for 1A and 1B", async () => {
  const raw = JSON.parse(readFileSync(new URL("./fixtures/CF1-F02/article.json", import.meta.url)));
  const { article, structuralBlocks, articleDocument } = prepareArticle(raw.article ?? raw);
  const unitId = articleDocument.sourceUnits[0].unitId;
  const inventory1a = {
    theme: { text: "Theme", sourceUnitIds: [unitId] },
    thesis: { text: "Thesis", sourceUnitIds: [unitId] },
    pillars: [{ label: "Pillar", text: "Pillar text", importance: "load_bearing",
      sourceUnitIds: [unitId] }],
    thesisHinge: "substance",
    candidateClaims: [{ claimText: "A testable proposition.", sourceUnitIds: [unitId],
      materiality: "high", relatedPillarLabels: ["Pillar"], scope: "general",
      evidenceUsefulnessHint: "Evidence testing the proposition." }],
  };
  const call1b = { candidateJudgments: [{ candidateId: "CAND01", assertionSource: "unknown",
    assertionSourceUnitIds: [], assertionSourceResolution: "no_candidate_found",
    contentStance: "neutral", articleDeployment: "reported_neutral", articleRole: "qualification",
    sourceUnitIds: [unitId], responseUnitIds: [], needsSplit: { split: false, reason: null } }] };
  const runner = stubRunner({ inventory1a, call1b });

  await runCall1Split({ article, structuralBlocks, sourceUnits: articleDocument.sourceUnits,
    modelRunner: runner, options: { arm: "attribution-host-v4", model: "fallback-model",
      call1aModel: "model-for-1a", call1bModel: "model-for-1b", apiMode: "responses",
      temperature: 0 } });

  assert.deepEqual(runner.calls.map((c) => c.model), ["model-for-1a", "model-for-1b"]);
});
