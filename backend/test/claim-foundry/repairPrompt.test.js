import test from "node:test";
import assert from "node:assert/strict";
import { buildRepairPrompt, CF1_REPAIR_RESPONSE_SCHEMA } from "../../src/claim-foundry/prompts/repairPrompt.js";

test("repair prompt limits the model to supplied paths and grounding", () => {
  const request = {
    blockingErrors: [{ code: "CF1_INVALID_TARGET_POSTURE", path: "/phase3Targets/0" }],
    allowedPaths: ["/phase3Targets/0/scoreTransform"],
    affectedPackageFragments: { "/phase3Targets/0/scoreTransform": "invert" },
    groundingBlocks: [{ blockId: "B002", text: "Source text", sourceOffsets: { start: 10, end: 21 } }],
  };
  const prompt = buildRepairPrompt(request);
  assert.match(prompt.system, /single permitted/);
  assert.match(prompt.system, /Do not browse/);
  assert.match(prompt.user, /\/phase3Targets\/0\/scoreTransform/);
  assert.match(prompt.user, /B002/);
  assert.equal(prompt.responseSchema, CF1_REPAIR_RESPONSE_SCHEMA);
  assert.equal(prompt.responseSchema.schema.properties.repairs.maxItems, 30);
});
