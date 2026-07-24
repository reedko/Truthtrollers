import test from "node:test";
import assert from "node:assert/strict";
import {
  buildP1aHistoricalLive20260715Prompt,
  P1A_HISTORICAL_LIVE_20260715_SCHEMA,
} from "./prompt-benchmark/promptSets/p1aHistoricalLive20260715.js";

test("historical July 15 arm retains the original heavy contract", () => {
  const properties = P1A_HISTORICAL_LIVE_20260715_SCHEMA.schema.properties;
  assert.deepEqual(Object.keys(properties),
    ["theme", "thesis", "pillars", "namedWorks", "candidateClaims"]);
  assert.equal(properties.candidateClaims.minItems, 1);
  assert.equal(properties.candidateClaims.maxItems, 20);
  assert.deepEqual(properties.candidateClaims.items.required,
    ["claimText", "sourceUnitIds", "articleRole", "articleUse", "assertionSource",
      "materiality", "relatedPillarLabels", "scope", "evidenceUsefulnessHint"]);
});

test("historical July 15 arm is fixture-neutral and assembles source units", () => {
  const prompt = buildP1aHistoricalLive20260715Prompt({
    article: { title: "Generic", text: "x".repeat(6_000) },
    structuralBlocks: [{ heading: "H", structuralType: "paragraph",
      sourceUnitIds: ["U0001"] }],
    sourceUnits: [{ unitId: "U0001", text: "A generic factual assertion." }],
  });
  assert.match(prompt.user, /U0001/);
  assert.equal(prompt.responseSchema.schema.properties.candidateClaims.minItems, 16);
  assert.doesNotMatch(`${prompt.system}\n${prompt.user}`,
    /\b(?:vaccine|vaccination|CDC|JCPH|thimerosal|MMR|autism|Ana Wolpin)\b/i);
});
