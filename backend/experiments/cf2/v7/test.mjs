import test from "node:test";
import assert from "node:assert/strict";
import { buildCf2V6DiscoveryPrompt } from "../v6/prompts.js";
import {
  buildCf2V7DiscoveryPrompt,
  V6_ATTRIBUTION_INSTRUCTION,
  V7_ATTRIBUTION_INSTRUCTION,
} from "./prompts.js";

const article = {
  title: "Test",
  authors: ["Test Author"],
};
const sourceUnits = [{
  unitId: "U0001",
  text: "Institution X stated that treatment Y is safe.",
}];

test("CF2 V7 changes only the protected Call A attribution instruction", () => {
  const args = { article, sourceUnits, candidateMaximum: 30 };
  const v6 = buildCf2V6DiscoveryPrompt(args);
  const v7 = buildCf2V7DiscoveryPrompt(args);

  assert.equal(v7.system, v6.system);
  assert.deepEqual(v7.responseSchema, v6.responseSchema);
  assert.match(v7.user, /Never append or synthesize "according to X"/);
  assert.equal(
    v7.user.replace(V7_ATTRIBUTION_INSTRUCTION, V6_ATTRIBUTION_INSTRUCTION),
    v6.user,
  );
});

test("CF2 V7 retains explicit attribution and grounding requirements", () => {
  const prompt = buildCf2V7DiscoveryPrompt({ article, sourceUnits });
  assert.match(prompt.user, /only when that frame is explicitly present/);
  assert.match(prompt.user, /groundingUnitIds must independently support/);
  assert.match(prompt.user, /neighboring unit\s+identifies the supplier/);
  assert.doesNotMatch(prompt.user, /Preserve a reporting frame in rawAssertion when/);
});
