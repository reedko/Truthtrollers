import test from "node:test";
import assert from "node:assert/strict";
import { verifySemanticInventory } from "../../src/claim-foundry/twoCallAgentVerification.js";
import { buildSemanticInventoryPrompt } from "../../src/claim-foundry/prompts/semanticInventoryPrompt.js";

const sourceUnits = [{ unitId: "U0001", text: "The city audit examined the bridge procurement timeline." }];

function inventory(themeText, thesisText) {
  return {
    thesisHinge: "substance",
    theme: { text: themeText, sourceUnitIds: ["U0001"] },
    thesis: { text: thesisText, sourceUnitIds: ["U0001"] },
    pillars: [{ label: "Procurement delay", text: "Procurement began nine months late.",
      importance: "major", sourceUnitIds: ["U0001"] }],
    candidateClaims: [{ claimText: "The city audit examined the bridge procurement timeline.",
      sourceUnitIds: ["U0001"], articleRole: "pillar", articleUse: "endorsed", assertionSource: "article",
      materiality: "high", relatedPillarLabels: ["Procurement delay"], scope: "the audited procurement",
      evidenceUsefulnessHint: "Check the audit's dated procurement records." }],
  };
}

test("a valid-proposition theme without a listed verb is NOT overwritten with thesis (clobber gone)", () => {
  // "mismanaged" is not in the verb heuristic; before the fix this theme was clobbered by thesis.
  const themeText = "City management routinely mismanaged the bridge repair program.";
  const thesisText = "Management delay drove the late bridge repairs.";
  const v = verifySemanticInventory(inventory(themeText, thesisText), { sourceUnits, minimumCandidates: 1 });
  assert.equal(v.theme.text, themeText); // preserved verbatim, not replaced
  assert.notEqual(v.theme.text, v.thesis.text);
});

test("theme identical to thesis raises a warning WITHOUT mutating either text", () => {
  const text = "Management delay caused the late bridge repairs.";
  const v = verifySemanticInventory(inventory(text, text), { sourceUnits, minimumCandidates: 1 });
  assert.equal(v.theme.text, text); // unchanged
  assert.equal(v.thesis.text, text); // unchanged
  assert.ok(v.themeWarnings.includes("CF1_THEME_EQUALS_THESIS"));
});

test("a distinct proposition theme raises no theme warning", () => {
  const v = verifySemanticInventory(
    inventory("City oversight of the repair program was inadequate.",
      "Management delay caused the late bridge repairs."), { sourceUnits, minimumCandidates: 1 });
  assert.deepEqual(v.themeWarnings, []);
});

test("Call 1 prompt instructs theme and thesis to be distinct propositions", () => {
  const prompt = buildSemanticInventoryPrompt({ article: { title: "t" }, structuralBlocks: [], sourceUnits: [] });
  assert.match(prompt.system, /must be DISTINCT and must not be identical/i);
  assert.match(prompt.system, /complete proposition/i);
});
