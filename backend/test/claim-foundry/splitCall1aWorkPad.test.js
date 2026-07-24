import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSplitCall1aPrompt as buildSimpleV2Prompt }
  from "./prompt-benchmark/promptSets/splitCall1aDiscoveryPromptSimpleV2.js";
import { buildSplitCall1aWorkPadPrompt, WORKPAD_RESPONSE_SCHEMA }
  from "./prompt-benchmark/promptSets/splitCall1aDiscoveryPromptWorkPadV0.js";

test("workpad V0 is self-contained and initially reproduces Simple V2", () => {
  const sourceUnits = [
    { unitId: "U0001", text: "First proposition." },
    { unitId: "U0002", text: "Second proposition." },
  ];
  const structuralBlocks = [
    { blockId: "B001", heading: "One", structuralType: "prose", sourceUnitIds: ["U0001"] },
    { blockId: "B002", heading: "Two", structuralType: "prose", sourceUnitIds: ["U0002"] },
  ];
  const context = { article: { title: "Test article" }, structuralBlocks, sourceUnits };
  const baseline = buildSimpleV2Prompt(context);
  const workpad = buildSplitCall1aWorkPadPrompt(context);
  assert.equal(workpad.system, baseline.system);
  assert.equal(workpad.user, baseline.user);
  assert.deepEqual(workpad.responseSchema.schema, baseline.responseSchema.schema);
  assert.notEqual(workpad.responseSchema.name, baseline.responseSchema.name);
  assert.equal(workpad.responseSchema.schema.properties.candidateClaims.minItems, undefined);
  assert.equal(workpad.responseSchema.schema.properties.candidateClaims.maxItems, undefined);
  assert.equal(WORKPAD_RESPONSE_SCHEMA.strict, true);

  const source = readFileSync(new URL(
    "./prompt-benchmark/promptSets/splitCall1aDiscoveryPromptWorkPadV0.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s/m);
  assert.doesNotMatch(workpad.user, /\{\{[A-Z_]+\}\}/);
});
