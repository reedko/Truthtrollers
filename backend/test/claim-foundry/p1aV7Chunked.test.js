import test from "node:test";
import assert from "node:assert/strict";
import { buildP1aV7Chunks, buildP1aV7OrientationPacket,
  verifyP1aV7ChunkCoverage } from "./prompt-benchmark/p1aV7Chunking.js";
import { buildP1aV7OrientationPrompt, verifyP1aV7Orientation }
  from "./prompt-benchmark/promptSets/p1aV7Orientation.js";
import { buildP1aV7ChunkPrompt, normalizeAndVerifyP1aV7ChunkOutput }
  from "./prompt-benchmark/promptSets/p1aV7ChunkAssertion.js";
import { buildP1aV7ChunkOrientationLitePrompt, buildP1aV7ChunkLocalOnlyPrompt }
  from "./prompt-benchmark/promptSets/p1aV7ChunkAblations.js";
import { buildP1aV7OrientationPostPacket, buildP1aV7OrientationPostPrompt,
  verifyP1aV7PostOrientation }
  from "./prompt-benchmark/promptSets/p1aV7OrientationPost.js";
import { mergeP1aV7Assertions, orientationConsistencyDiagnostic,
  articleRegionCounts } from "./prompt-benchmark/p1aV7Merge.js";

const sourceUnits = Array.from({ length: 16 }, (_, index) => ({
  unitId: `U${String(index + 1).padStart(4, "0")}`,
  text: `Source unit ${index + 1} contains a distinct factual statement.`,
}));
const structuralBlocks = Array.from({ length: 8 }, (_, index) => ({
  blockId: `B${String(index + 1).padStart(3, "0")}`,
  order: index,
  heading: index % 2 === 0 ? `Section ${index + 1}` : "",
  structuralType: "paragraph_group",
  sourceUnitIds: sourceUnits.slice(index * 2, (index * 2) + 2).map((unit) => unit.unitId),
}));
const article = { title: "A test article", authors: ["A. Author"] };

test("P1aV7 chunk planner creates four balanced contiguous owners with context only", () => {
  const chunks = buildP1aV7Chunks({ structuralBlocks, sourceUnits, chunkCount: 4,
    contextUnits: 1 });
  assert.equal(chunks.length, 4);
  assert.deepEqual(chunks.map((chunk) => chunk.ownedBlockIds.length), [2, 2, 2, 2]);
  assert.deepEqual(chunks[1].contextBeforeUnitIds, ["U0004"]);
  assert.deepEqual(chunks[1].contextAfterUnitIds, ["U0009"]);
  assert.equal(verifyP1aV7ChunkCoverage({ chunks, structuralBlocks, sourceUnits }).valid, true);
});

test("P1aV7 orientation prompt is orientation-only and grounded in its packet", () => {
  const chunks = buildP1aV7Chunks({ structuralBlocks, sourceUnits, chunkCount: 4 });
  const packet = buildP1aV7OrientationPacket({ article, chunks, structuralBlocks, sourceUnits });
  const prompt = buildP1aV7OrientationPrompt({ orientationPacket: packet });
  assert.deepEqual(prompt.responseSchema.schema.required,
    ["theme", "thesis", "thesisHinge", "pillars"]);
  assert.equal("assertions" in prompt.responseSchema.schema.properties, false);
  const output = { theme: { text: "The system has a broad problem.", sourceUnitIds: ["U0001"] },
    thesis: { text: "One policy caused that problem.", sourceUnitIds: ["U0002"] },
    thesisHinge: "substance", pillars: [{ label: "Policy effects",
      text: "The policy caused measurable effects.", importance: "load_bearing",
      sourceUnitIds: ["U0002"] }] };
  assert.deepEqual(verifyP1aV7Orientation(output, packet), output);
});

test("P1aV7 C prompt retains V4 materiality but emits no global orientation fields", () => {
  const chunks = buildP1aV7Chunks({ structuralBlocks, sourceUnits, chunkCount: 4 });
  const orientation = { theme: { text: "Broad theme" }, thesis: { text: "Specific thesis" },
    thesisHinge: "substance", pillars: [{ label: "Policy effects", text: "Policy effects",
      importance: "load_bearing" }] };
  const prompt = buildP1aV7ChunkPrompt({ article, chunk: chunks[0], sourceUnits, orientation });
  assert.deepEqual(prompt.responseSchema.schema.required, ["assertions"]);
  const item = prompt.responseSchema.schema.properties.assertions.items;
  assert.ok(item.required.includes("materiality"));
  assert.deepEqual(item.properties.relatedPillarLabels.items.enum, ["Policy effects"]);
  for (const field of ["theme", "thesis", "thesisHinge", "pillars"]) {
    assert.equal(field in prompt.responseSchema.schema.properties, false);
  }
  const normalized = normalizeAndVerifyP1aV7ChunkOutput({ chunk: chunks[0], orientation,
    output: { assertions: [{ assertionText: "A measurable event occurred.",
      sourceUnitIds: ["U0001"], materiality: "high", relatedPillarLabels: ["Policy effects"],
      scope: "test", evidenceUsefulnessHint: "Check a contemporaneous record." }] } });
  assert.equal(normalized[0].claimText, "A measurable event occurred.");
  assert.throws(() => normalizeAndVerifyP1aV7ChunkOutput({ chunk: chunks[0], orientation,
    output: { assertions: [{ assertionText: "Outside grounding.", sourceUnitIds: ["U0016"],
      materiality: "high", relatedPillarLabels: [], scope: "test",
      evidenceUsefulnessHint: "Check a record." }] } }), /outside its owned units/);
});

test("P1aV7 merge collapses only normalized exact duplicates and reports orientation coverage", () => {
  const assertions = [
    { candidateId: "C1", chunkId: "A", assertionText: "A result increased by 10%.",
      claimText: "A result increased by 10%.", sourceUnitIds: ["U0001"],
      relatedPillarLabels: ["Effects"] },
    { candidateId: "C2", chunkId: "B", assertionText: "A result increased by 10%",
      claimText: "A result increased by 10%", sourceUnitIds: ["U0002"],
      relatedPillarLabels: ["Effects"] },
    { candidateId: "C3", chunkId: "B", assertionText: "A different result occurred.",
      claimText: "A different result occurred.", sourceUnitIds: ["U0014"],
      relatedPillarLabels: [] },
  ];
  const merged = mergeP1aV7Assertions(assertions);
  assert.equal(merged.summary.mergedCount, 2);
  assert.equal(merged.duplicateGroups.length, 1);
  const diagnostic = orientationConsistencyDiagnostic({
    orientation: { pillars: [{ label: "Effects" }, { label: "Missing" }] },
    assertions: merged.mergedAssertions });
  assert.deepEqual(diagnostic.uncoveredPillars, ["Missing"]);
  assert.equal(diagnostic.unlinkedCount, 1);
  assert.deepEqual(articleRegionCounts(merged.mergedAssertions, sourceUnits),
    { 0: 1, 1: 0, 2: 0, 3: 1 });
});

test("P1aV7 C ablations remove pillar or all orientation text without changing local extraction fields", () => {
  const chunks = buildP1aV7Chunks({ structuralBlocks, sourceUnits, chunkCount: 4 });
  const orientation = { theme: { text: "Broad theme" }, thesis: { text: "Specific thesis" },
    thesisHinge: "substance", pillars: [{ label: "Policy effects", text: "Policy effects",
      importance: "load_bearing" }] };
  const input = { article, chunk: chunks[0], sourceUnits, orientation };
  const lite = buildP1aV7ChunkOrientationLitePrompt(input);
  const local = buildP1aV7ChunkLocalOnlyPrompt(input);
  for (const prompt of [lite, local]) {
    const item = prompt.responseSchema.schema.properties.assertions.items;
    assert.equal("relatedPillarLabels" in item.properties, false);
    assert.ok(item.required.includes("materiality"));
  }
  assert.match(lite.user, /pillars: \(not supplied\)/);
  assert.doesNotMatch(local.user, /FROZEN ORIENTATION|Specific thesis|Policy effects/);
  assert.doesNotMatch(local.system, /frozen whole-article orientation/);
});

test("P1aV7 O-post can revise orientation using only spine and assertion unit IDs", () => {
  const chunks = buildP1aV7Chunks({ structuralBlocks, sourceUnits, chunkCount: 4 });
  const spine = buildP1aV7OrientationPacket({ article, chunks, structuralBlocks, sourceUnits });
  const preOrientation = { theme: { text: "Broad theme", sourceUnitIds: ["U0001"] },
    thesis: { text: "Specific thesis", sourceUnitIds: ["U0002"] }, thesisHinge: "mixed",
    pillars: [{ label: "Initial", text: "Initial axis", importance: "major",
      sourceUnitIds: ["U0002"] }] };
  const packet = buildP1aV7OrientationPostPacket({ preOrientation,
    orientationPacket: spine, assertions: [{ candidateId: "A1",
      assertionText: "A later result occurred.", sourceUnitIds: ["U0016"],
      sourceChunkIds: ["C4"] }] });
  const prompt = buildP1aV7OrientationPostPrompt({ postPacket: packet });
  assert.equal("assertions" in prompt.responseSchema.schema.properties, false);
  assert.ok(prompt.responseSchema.schema.required.includes("assertionPillarAssignments"));
  const output = { theme: { text: "Broad corrected theme", sourceUnitIds: ["U0001"] },
    thesis: { text: "A later result supports the conclusion.", sourceUnitIds: ["U0016"] },
    thesisHinge: "substance", pillars: [{ label: "Later result",
      text: "The later result is central.", importance: "load_bearing",
      sourceUnitIds: ["U0016"] }], assertionPillarAssignments: [{ candidateId: "A1",
        relatedPillarLabels: ["Later result"] }] };
  assert.deepEqual(verifyP1aV7PostOrientation(output, packet), output);
});
