import test from "node:test";
import assert from "node:assert/strict";
import { buildP1aV9ChunkPacket, buildP1aV9LocalPillarPrompt,
  verifyP1aV9LocalPillars, mergeP1aV9LocalPillars }
  from "./prompt-benchmark/promptSets/p1aV9LocalPillars.js";

const blocks = [{ blockId: "B1", structuralType: "paragraph_group", heading: "",
  sourceUnitIds: ["U1", "U2"] }, { blockId: "B2", structuralType: "paragraph_group",
  heading: "", sourceUnitIds: ["U3"] }];
const assertions = [{ candidateId: "C1", claimText: "A law removed liability.",
  sourceUnitIds: ["U1"], relatedPillarLabels: ["old"] },
{ candidateId: "C2", claimText: "A schedule expanded.", sourceUnitIds: ["U2"] }];

test("P1aV9 packet omits old labels and prompt asks only for local questions", () => {
  const packet = buildP1aV9ChunkPacket({ chunkId: "C01", blocks, assertions,
    orientation: { theme: { text: "Theme" }, thesis: { text: "Thesis" } } });
  const prompt = buildP1aV9LocalPillarPrompt({ packet });
  assert.equal(packet.blocks[0].assertions.length, 2);
  assert.equal("relatedPillarLabels" in packet.blocks[0].assertions[0], false);
  assert.doesNotMatch(prompt.user, /old/);
  assert.deepEqual(prompt.responseSchema.schema.required, ["blockAnalyses"]);
});

test("P1aV9 verifies exact local assignment and exact-only question merging", () => {
  const packet = buildP1aV9ChunkPacket({ chunkId: "C01", blocks, assertions,
    orientation: { theme: { text: "Theme" }, thesis: { text: "Thesis" } } });
  const output = { blockAnalyses: [{ blockId: "B1", localPillars: [
    { evidenceQuestion: "Did the law remove liability?", assertionIds: ["C1"] },
    { evidenceQuestion: "Did the schedule expand?", assertionIds: ["C2"] }],
  unassignedAssertionIds: [] }, { blockId: "B2", localPillars: [],
    unassignedAssertionIds: [] }] };
  assert.deepEqual(verifyP1aV9LocalPillars(output, packet), output);
  const merged = mergeP1aV9LocalPillars([{ chunkId: "C01", output },
    { chunkId: "C02", output: { blockAnalyses: [{ blockId: "B3", localPillars: [
      { evidenceQuestion: "Did the law remove liability", assertionIds: ["C3"] }],
    unassignedAssertionIds: [] }] } }]);
  assert.equal(merged.summary.localPillarCount, 3);
  assert.equal(merged.summary.exactMergedPillarCount, 2);
  assert.deepEqual(merged.pillars[0].assertionIds, ["C1", "C3"]);
});
