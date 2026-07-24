import assert from "node:assert/strict";
import test from "node:test";
import { buildP1aV13BlockBatches, buildP1aV13LocalQuestionsPrompt,
  mergeP1aV13LocalQuestions, normalizeAndVerifyP1aV13LocalQuestions,
  verifyP1aV13LocalQuestions }
  from "./prompt-benchmark/promptSets/p1aV13LocalQuestions.js";
import { buildP1aV13AxisSynthesisPrompt, verifyAndEnrichP1aV13AxisSynthesis }
  from "./prompt-benchmark/promptSets/p1aV13AxisSynthesis.js";

const sourceUnits = Array.from({ length: 33 }, (_, index) => ({
  unitId: `U${String(index + 1).padStart(4, "0")}`,
  text: `Block ${index + 1} reports factual matter ${index + 1}.`,
}));
const structuralBlocks = sourceUnits.map((unit, index) => ({
  blockId: `B${String(index + 1).padStart(3, "0")}`,
  heading: `Section ${index + 1}`,
  structuralType: "body",
  sourceUnitIds: [unit.unitId],
}));

test("V13 creates balanced contiguous batches and the local prompt has no global concepts", () => {
  const batches = buildP1aV13BlockBatches({ structuralBlocks, maximumBlocks: 7 });
  assert.deepEqual(batches.map((batch) => batch.blocks.length), [7, 7, 7, 6, 6]);
  assert.deepEqual(batches.flatMap((batch) => batch.blockIds),
    structuralBlocks.map((block) => block.blockId));
  const prompt = buildP1aV13LocalQuestionsPrompt({ batch: batches[0], sourceUnits });
  assert.doesNotMatch(prompt.system, /\b(?:theme|thesis|pillar|axis|axes)\b/i);
  assert.match(prompt.user, /"blockId":"B001"/);
  assert.deepEqual(Object.keys(prompt.responseSchema.schema.properties), ["blocks"]);
  assert.equal(prompt.responseSchema.schema.properties.blocks.maxItems, 7);
  assert.equal(prompt.responseSchema.schema.properties.blocks.items.properties.questions.maxItems, 2);
});

test("V13 host rejects cross-block grounding and assigns stable local IDs", () => {
  const batch = buildP1aV13BlockBatches({ structuralBlocks, maximumBlocks: 40 })[0];
  const output = { blocks: batch.blocks.map((block, index) => ({ blockId: block.blockId,
    questions: index < 2 ? [{ question: `Is matter ${index + 1} accurate?`,
      contestedSubject: `matter ${index + 1}`,
      disconfirmingFinding: `Matter ${index + 1} is inaccurate.`,
      sourceUnitIds: block.sourceUnitIds }] : [] })) };
  const verified = verifyP1aV13LocalQuestions(output, batch);
  const merged = mergeP1aV13LocalQuestions([{ blocks: verified }]);
  assert.deepEqual(merged.questions.map((item) => item.localQuestionId), ["LQ001", "LQ002"]);
  assert.throws(() => verifyP1aV13LocalQuestions({ blocks: output.blocks.map((block, index) =>
    index === 0 ? { ...block, questions: [{ ...block.questions[0], sourceUnitIds: ["U0002"] }] }
      : block) }, batch), /outside its block/);
});

test("V13 derives a mislabelled block from authoritative local source units", () => {
  const batch = buildP1aV13BlockBatches({ structuralBlocks: structuralBlocks.slice(0, 2),
    maximumBlocks: 7 })[0];
  const output = { blocks: [
    { blockId: "B001", questions: [] },
    { blockId: "B002", questions: [{ question: "Was matter 1 accurate?",
      contestedSubject: "matter 1", disconfirmingFinding: "Matter 1 was inaccurate.",
      sourceUnitIds: ["U0001"] }] },
  ] };
  const normalized = normalizeAndVerifyP1aV13LocalQuestions(output, batch);
  assert.equal(normalized.blocks[0].questions.length, 1);
  assert.equal(normalized.blocks[1].questions.length, 0);
  assert.deepEqual(normalized.corrections[0], { fromBlockId: "B002", toBlockId: "B001",
    question: "Was matter 1 accurate?", sourceUnitIds: ["U0001"] });
});

test("V13 synthesis schema is ordered and host classifies each local question once", () => {
  const localQuestions = [
    { localQuestionId: "LQ001", blockId: "B001", question: "Was result A observed?",
      contestedSubject: "result A", disconfirmingFinding: "Result A was not observed.",
      sourceUnitIds: ["U0001"] },
    { localQuestionId: "LQ002", blockId: "B002", question: "Did rule B change?",
      contestedSubject: "rule B", disconfirmingFinding: "Rule B did not change.",
      sourceUnitIds: ["U0002"] },
  ];
  const prompt = buildP1aV13AxisSynthesisPrompt({ localQuestions });
  assert.deepEqual(Object.keys(prompt.responseSchema.schema.properties),
    ["evidenceAxes", "unassignedLocalQuestionIds", "thesis", "theme", "thesisHinge"]);
  assert.doesNotMatch(prompt.user, /Block 1 reports/);
  const output = {
    evidenceAxes: [{ label: "Observed result", question: "Was result A observed?",
      proposition: "Result A was observed.", localQuestionIds: ["LQ001"],
      ifSupported: "strengthens_thesis", ifRefuted: "weakens_thesis" }],
    unassignedLocalQuestionIds: ["LQ002"],
    thesis: { text: "Result A supports the article's conclusion.",
      sourceLocalQuestionIds: ["LQ001"] },
    theme: { text: "Reported evidence informs the conclusion.",
      sourceLocalQuestionIds: ["LQ001"] },
    thesisHinge: "substance",
  };
  const enriched = verifyAndEnrichP1aV13AxisSynthesis(output, localQuestions);
  assert.equal(enriched.evidenceAxes[0].axisId, "AX001");
  assert.deepEqual(enriched.evidenceAxes[0].sourceBlockIds, ["B001"]);
  assert.deepEqual(enriched.evidenceAxes[0].sourceUnitIds, ["U0001"]);
  assert.throws(() => verifyAndEnrichP1aV13AxisSynthesis({ ...output,
    unassignedLocalQuestionIds: ["LQ001", "LQ002"] }, localQuestions),
  /classified exactly once/);
});
