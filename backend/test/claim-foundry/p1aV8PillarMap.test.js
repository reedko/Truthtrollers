import test from "node:test";
import assert from "node:assert/strict";
import { buildP1aV8WholeArticlePrompt, buildP1aV8GroupedAssertionPacket,
  buildP1aV8GroupedAssertionPrompt, verifyP1aV8PillarMap,
  mapAssertionsThroughBlocks }
  from "./prompt-benchmark/promptSets/p1aV8PillarMap.js";

const blocks = [{ blockId: "B1", structuralType: "paragraph_group", heading: "",
  text: "A study found an effect.", sourceUnitIds: ["U1"] },
{ blockId: "B2", structuralType: "paragraph_group", heading: "Later",
  text: "A law changed liability.", sourceUnitIds: ["U2"] }];
const article = { title: "Test", authors: ["Author"] };
const assertions = [{ candidateId: "C1", claimText: "A study found an effect.",
  sourceUnitIds: ["U1"], relatedPillarLabels: ["old diagnostic"] }];

test("P1aV8 arms share one schema while receiving different representations", () => {
  const packet = buildP1aV8GroupedAssertionPacket({ article,
    structuralBlocks: blocks, assertions });
  const whole = buildP1aV8WholeArticlePrompt({ article, structuralBlocks: blocks });
  const grouped = buildP1aV8GroupedAssertionPrompt({ packet });
  assert.deepEqual(whole.responseSchema, grouped.responseSchema);
  assert.match(whole.user, /A law changed liability/);
  assert.doesNotMatch(grouped.user, /A law changed liability/);
  assert.equal(packet.blocks[0].extractedAssertions.length, 1);
  assert.equal(packet.blocks[1].extractedAssertions.length, 0);
});

test("P1aV8 verifies blocks and deterministically joins assertions through units", () => {
  const output = { theme: { text: "Broad theme", sourceUnitIds: ["U1"] },
    thesis: { text: "Specific thesis", sourceUnitIds: ["U2"] },
    thesisHinge: "substance", pillars: [{ label: "Evidence", text: "Evidence axis",
      importance: "major", sourceUnitIds: ["U1"] }],
    blockPillarAssignments: [{ blockId: "B1", relatedPillarLabels: ["Evidence"] },
      { blockId: "B2", relatedPillarLabels: [] }] };
  assert.deepEqual(verifyP1aV8PillarMap(output, { structuralBlocks: blocks,
    allowedSourceUnitIds: ["U1", "U2"] }), output);
  const mapped = mapAssertionsThroughBlocks({ assertions, structuralBlocks: blocks,
    pillarMap: output });
  assert.deepEqual(mapped[0].mappedBlockIds, ["B1"]);
  assert.deepEqual(mapped[0].derivedPillarLabels, ["Evidence"]);
  assert.deepEqual(mapped[0].relatedPillarLabels, ["old diagnostic"]);
});
