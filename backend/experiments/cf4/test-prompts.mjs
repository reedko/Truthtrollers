import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCf4SelectionPrompt,
  buildCf4StanceAssertionsPrompt,
} from "./prompts.js";
import {
  validateSelection,
  validateStanceAssertions,
} from "./phase2-host.mjs";

test("stance schema is grounded, bounded, and candidate-free", () => {
  const prompt = buildCf4StanceAssertionsPrompt({
    article: { title: "Example" },
    units: [{ unitId: "U0001", text: "A factual article sentence." }],
  });
  const property = prompt.responseSchema.schema.properties.stanceAssertions;
  assert.equal(property.minItems, 1);
  assert.equal(property.maxItems, 15);
  assert.deepEqual(property.items.required,
    ["assertionText", "groundingUnitIds"]);
  assert.doesNotMatch(prompt.user, /candidate assertion ids/i);
});

test("selection receives every stance assertion and candidate lineage", () => {
  const stanceAssertions = [
    { stanceId: "S0001", assertionText: "First target.",
      groundingUnitIds: ["U0001"] },
    { stanceId: "S0002", assertionText: "Second target.",
      groundingUnitIds: ["U0002"] },
  ];
  const prompt = buildCf4SelectionPrompt({
    stanceAssertions,
    inventory: [{ assertionId: "C0001", assertionText: "Candidate.",
      groundingUnitIds: ["U0003"] }],
  });
  stanceAssertions.forEach((item) => {
    assert.match(prompt.user, new RegExp(item.stanceId));
    assert.match(prompt.user, new RegExp(item.assertionText));
  });
  assert.match(prompt.user, /C0001 \[U0003\]: Candidate\./);
  assert.match(prompt.user, /not as quotas/i);
});

test("host validates grounding, assigns IDs, and deduplicates", () => {
  const result = validateStanceAssertions([
    { assertionText: "Claim one.", groundingUnitIds: ["U0001"] },
    { assertionText: " Claim one! ", groundingUnitIds: ["U0001"] },
    { assertionText: "Bad unit.", groundingUnitIds: ["U9999"] },
  ], new Set(["U0001"]));
  assert.deepEqual(result.stanceAssertions.map((item) => item.stanceId),
    ["S0001"]);
  assert.deepEqual(result.findings.map((item) => item.code), [
    "CF4_DUPLICATE_STANCE_ASSERTION",
    "CF4_INVALID_STANCE_ASSERTION",
  ]);
});

test("host flags a stance set that fills the transport ceiling", () => {
  const rows = Array.from({ length: 15 }, (_, index) => ({
    assertionText: `Claim ${index + 1}.`,
    groundingUnitIds: ["U0001"],
  }));
  const result = validateStanceAssertions(rows, new Set(["U0001"]));
  assert.ok(result.findings.some((item) =>
    item.code === "CF4_STANCE_ASSERTIONS_AT_CEILING"));
});

test("selection retains only existing unique IDs", () => {
  const result = validateSelection(
    ["C0001", "C0001", "C9999"], new Set(["C0001"]));
  assert.deepEqual(result.selectedAssertionIds, ["C0001"]);
  assert.ok(result.findings.some((item) =>
    item.code === "CF4_SELECTION_UNKNOWN_ID"));
});
