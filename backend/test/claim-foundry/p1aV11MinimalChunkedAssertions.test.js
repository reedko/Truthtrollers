import assert from "node:assert/strict";
import test from "node:test";
import { buildP1aV11MinimalChunkPrompt,
  normalizeAndVerifyP1aV11ChunkOutput, P1A_V11_SYSTEM }
  from "./prompt-benchmark/promptSets/p1aV11MinimalChunkedAssertions.js";

const article = { title: "Fixture-neutral title" };
const sourceUnits = [
  { unitId: "U0001", text: "Source A states proposition one." },
  { unitId: "U0002", text: "The article disputes proposition two." },
  { unitId: "U0003", text: "Outside this chunk." },
];
const chunk = {
  chunkId: "P1aV11-C01",
  firstUnitId: "U0001",
  lastUnitId: "U0002",
  ownedUnitIds: ["U0001", "U0002"],
  blocks: [{ blockId: "B1", heading: "Heading", structuralType: "body",
    sourceUnitIds: ["U0001", "U0002"] }],
};

test("P1aV11 prompt is minimal, local, uncapped, and polarity-preserving", () => {
  const prompt = buildP1aV11MinimalChunkPrompt({ article, chunk, sourceUnits });
  assert.match(prompt.system, /every distinct externally verifiable factual assertion/);
  assert.match(prompt.system, /original polarity/);
  assert.doesNotMatch(prompt.system, /pillar|materiality|thesis|stance/i);
  assert.doesNotMatch(prompt.system, /\b(?:up to|at least|minimum|maximum)\s+\d+/i);
  assert.equal(prompt.responseSchema.schema.properties.assertions.minItems, undefined);
  assert.equal(prompt.responseSchema.schema.properties.assertions.maxItems, undefined);
  assert.match(prompt.user, /U0001/);
  assert.match(prompt.user, /U0002/);
  assert.doesNotMatch(prompt.user, /U0003/);
});

test("P1aV11 system prompt contains no fixture-specific vocabulary", () => {
  assert.doesNotMatch(P1A_V11_SYSTEM,
    /vaccine|cdc|health department|autism|mercury|aluminum|thimerosal/i);
});

test("P1aV11 normalization maps the canonical assertion to claimText", () => {
  const normalized = normalizeAndVerifyP1aV11ChunkOutput({ chunk, output: {
    assertions: [{ assertionText: " Proposition one. ", sourceUnitIds: ["U0001"] }],
  } });
  assert.equal(normalized[0].claimText, "Proposition one.");
  assert.equal(normalized[0].chunkId, "P1aV11-C01");
});

test("P1aV11 rejects grounding outside the owned chunk", () => {
  assert.throws(() => normalizeAndVerifyP1aV11ChunkOutput({ chunk, output: {
    assertions: [{ assertionText: "Outside.", sourceUnitIds: ["U0003"] }],
  } }), /outside its chunk/);
});
