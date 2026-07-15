import test from "node:test";
import assert from "node:assert/strict";
import { proposeStructuralBlocks, verifyBlockCoverage } from "../../src/claim-foundry/structuralBlocks.js";
import { validateArticleInput } from "../../src/claim-foundry/validateArticleInput.js";

function article(text) {
  return validateArticleInput({ title: "Structure fixture", text, authors: [], metadataWarnings: [] });
}

test("structural blocks preserve exact source offsets and non-whitespace coverage", () => {
  const input = article([
    "Audit Findings",
    "",
    "The audit found a long delay in bridge repairs.",
    "",
    '"Procurement caused the delay," the department said.',
    "",
    "- repair timeline",
    "- procurement record",
  ].join("\n"));
  const blocks = proposeStructuralBlocks(input);
  const result = verifyBlockCoverage(input, blocks);

  assert.equal(result.valid, true);
  assert.deepEqual(blocks.map((block) => block.structuralType), [
    "heading_section", "paragraph_group", "quotation", "list",
  ]);
  assert.equal(blocks[0].heading, "Audit Findings");
  for (const block of blocks) {
    assert.equal(input.text.slice(block.sourceOffsets.start, block.sourceOffsets.end), block.text);
  }
});

test("adjacent compatible paragraphs group without losing separator text", () => {
  const input = article("First paragraph contains a material factual assertion.\n\nSecond paragraph develops that same factual assertion.");
  const blocks = proposeStructuralBlocks(input, { targetMaxChars: 1_000 });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, input.text);
  assert.equal(verifyBlockCoverage(input, blocks).valid, true);
});

test("oversized source units split below the hard maximum with full coverage", () => {
  const input = article(`A long report begins here. ${"evidence ".repeat(8_000)}`);
  const blocks = proposeStructuralBlocks(input, {
    targetMinChars: 1_000,
    targetMaxChars: 8_000,
    hardMaxChars: 10_000,
  });
  assert.ok(blocks.length > 1);
  assert.ok(blocks.every((block) => block.text.length <= 10_000));
  assert.equal(verifyBlockCoverage(input, blocks, { hardMaxChars: 10_000 }).valid, true);
});

test("coverage verifier detects gaps, overlap, mutation, and order errors", () => {
  const input = article("The first material paragraph is here.\n\nThe second material paragraph is here.");
  const blocks = proposeStructuralBlocks(input, { targetMinChars: 20, targetMaxChars: 40 });
  const broken = structuredClone(blocks);
  broken[0].text = "invented text";
  broken[1].sourceOffsets.start = broken[0].sourceOffsets.end - 1;
  broken[1].order = 9;
  const codes = new Set(verifyBlockCoverage(input, broken).issues.map((item) => item.code));
  assert.ok(codes.has("CF1_BLOCK_TEXT_MISMATCH"));
  assert.ok(codes.has("CF1_BLOCK_RANGE"));
  assert.ok(codes.has("CF1_BLOCK_ORDER"));
});

test("block sizing options must be internally consistent", () => {
  const input = article("This article has enough meaningful text to pass portable validation.");
  assert.throws(
    () => proposeStructuralBlocks(input, { targetMinChars: 100, targetMaxChars: 50 }),
    (error) => error.code === "CF1_INVALID_BLOCK_OPTIONS",
  );
});
