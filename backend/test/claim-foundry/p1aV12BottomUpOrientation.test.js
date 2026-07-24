import assert from "node:assert/strict";
import test from "node:test";
import { adaptP1aV12ForV7ChunkPrompt, buildP1aV12BottomUpOrientationPrompt,
  verifyP1aV12BottomUpOrientation }
  from "./prompt-benchmark/promptSets/p1aV12BottomUpOrientation.js";

const article = { title: "Neutral fixture" };
const sourceUnits = [
  { unitId: "U0001", text: "One study reported result A." },
  { unitId: "U0002", text: "A separate law changed rule B." },
];
const structuralBlocks = [
  { blockId: "B001", heading: "Study", structuralType: "body",
    sourceUnitIds: ["U0001"] },
  { blockId: "B002", heading: "Law", structuralType: "body",
    sourceUnitIds: ["U0002"] },
];
const output = {
  blockAnalyses: {
    B001: { localArgumentQuestions: [{
      question: "Did the study report result A?", sourceUnitIds: ["U0001"] }] },
    B002: { localArgumentQuestions: [{
      question: "Did the law change rule B?", sourceUnitIds: ["U0002"] }] },
  },
  evidenceAxes: [
    { label: "Reported study result", question: "Did the study report result A?",
      sourceBlockIds: ["B001"], sourceUnitIds: ["U0001"] },
    { label: "Legal rule change", question: "Did the law change rule B?",
      sourceBlockIds: ["B002"], sourceUnitIds: ["U0002"] },
  ],
  thesis: { text: "Result A and rule B matter.", sourceUnitIds: ["U0001", "U0002"] },
  theme: { text: "Evidence and rules shape the issue.", sourceUnitIds: ["U0001", "U0002"] },
  thesisHinge: "substance",
};

test("P1aV12 schema and prose force local-to-global order", () => {
  const prompt = buildP1aV12BottomUpOrientationPrompt({ article, structuralBlocks,
    sourceUnits });
  assert.deepEqual(Object.keys(prompt.responseSchema.schema.properties),
    ["blockAnalyses", "evidenceAxes", "thesis", "theme", "thesisHinge"]);
  assert.deepEqual(Object.keys(prompt.responseSchema.schema.properties.blockAnalyses.properties),
    ["B001", "B002"]);
  assert.match(prompt.system, /Do not determine the overall thesis or theme\s+until/);
  assert.match(prompt.system, /same body of evidence would resolve them/);
  assert.match(prompt.user, /U0001/);
  assert.match(prompt.user, /U0002/);
});

test("P1aV12 verifies block-specific local-question grounding", () => {
  assert.deepEqual(verifyP1aV12BottomUpOrientation(output,
    { structuralBlocks, sourceUnits }), output);
  assert.throws(() => verifyP1aV12BottomUpOrientation({ ...output,
    blockAnalyses: { ...output.blockAnalyses, B001: { localArgumentQuestions: [{
      question: "Wrong block.", sourceUnitIds: ["U0002"] }] } } },
  { structuralBlocks, sourceUnits }), /outside its structural block/);
});

test("P1aV12 adapts evidence axes without changing their meaning", () => {
  const adapted = adaptP1aV12ForV7ChunkPrompt(output);
  assert.equal(adapted.pillars.length, 2);
  assert.equal(adapted.pillars[0].label, "Reported study result");
  assert.equal(adapted.pillars[0].text, "Did the study report result A?");
  assert.equal(adapted.pillars[0].importance, "unranked");
});
