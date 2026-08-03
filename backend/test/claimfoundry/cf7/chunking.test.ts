import assert from "node:assert/strict";
import test from "node:test";
import { buildCf7Phase1 } from "../../../src/claimfoundry/cf7/runCf7.js";
import {
  chunkArticle,
  DEFAULT_CF7_CHUNK_CONFIG,
} from "../../../src/claimfoundry/cf7/chunking/chunkArticle.js";
import { buildCoverageReport } from "../../../src/claimfoundry/cf7/chunking/coverage.js";
import { ingestArticle } from "../../../src/claimfoundry/cf7/ingest/ingestArticle.js";

function words(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");
}

function sentence(prefix: string, count: number): string {
  return `${words(prefix, count)}.`;
}

test("chunking prefers paragraph boundaries and preserves complete coverage", () => {
  const text = Array.from(
    { length: 8 },
    (_, index) => sentence(`paragraph${index}word`, 260),
  ).join("\n\n");
  const ingest = ingestArticle({ title: "Paragraph boundaries", text });
  const chunks = chunkArticle(ingest);
  const report = buildCoverageReport(
    ingest,
    chunks,
    DEFAULT_CF7_CHUNK_CONFIG,
  );
  const paragraphEnds = new Set(
    ingest.paragraphGroups.map((group) => group.unitIds.at(-1)),
  );

  assert.ok(chunks.length > 1);
  for (const chunk of chunks.slice(0, -1)) {
    const nonOverlap = chunk.unitIds.filter((unitId) =>
      !chunk.overlapUnitIds.includes(unitId));
    assert.ok(paragraphEnds.has(nonOverlap.at(-1)));
  }
  assert.equal(report.coverageComplete, true);
  assert.deepEqual(report.uncoveredUnitIds, []);
  assert.deepEqual(report.inventedUnitIds, []);
});

test("oversized paragraphs fall back to sentence boundaries without fragmentation", () => {
  const text = Array.from(
    { length: 8 },
    (_, index) => sentence(`Sentence${index}word`, 340),
  ).join(" ");
  const ingest = ingestArticle({ title: "Oversized paragraph", text });
  assert.equal(ingest.paragraphGroups.length, 1);
  assert.ok(ingest.paragraphGroups[0]!.unitIds.length > 1);

  const chunks = chunkArticle(ingest);
  const report = buildCoverageReport(
    ingest,
    chunks,
    DEFAULT_CF7_CHUNK_CONFIG,
  );
  assert.ok(chunks.length > 1);
  assert.equal(report.sentenceFragmentationCount, 0);
  assert.equal(report.coverageComplete, true);
});

test("overlap is explicit, adjacent only, and deterministic", () => {
  const text = Array.from(
    { length: 10 },
    (_, index) => sentence(`overlap${index}word`, 240),
  ).join("\n\n");
  const first = buildCf7Phase1({ title: "Overlap", text });
  const second = buildCf7Phase1({ title: "Overlap", text });

  assert.equal(first.determinismHash, second.determinismHash);
  assert.deepEqual(first.chunks, second.chunks);
  assert.ok(first.chunks.length > 1);
  for (let index = 1; index < first.chunks.length; index += 1) {
    const chunk = first.chunks[index]!;
    const previousIds = new Set(first.chunks[index - 1]!.unitIds);
    assert.ok(chunk.overlapUnitIds.length > 0);
    assert.ok(chunk.overlapUnitIds.every((unitId) => previousIds.has(unitId)));
  }
  assert.equal(first.coverageReport.overlapAdjacentOnly, true);
  assert.deepEqual(first.coverageReport.duplicateNonOverlapUnitIds, []);
});

test("headings remain associated with following content where practical", () => {
  const text = [
    "IMPORTANT BACKGROUND",
    sentence("backgroundword", 300),
    sentence("laterword", 900),
  ].join("\n\n");
  const result = buildCf7Phase1({ title: "Heading association", text });
  const headingUnitId = result.ingest.paragraphGroups[0]!.unitIds[0]!;
  const contentUnitId = result.ingest.paragraphGroups[1]!.unitIds[0]!;
  const firstBaseUnitIds = result.chunks[0]!.unitIds.filter((unitId) =>
    !result.chunks[0]!.overlapUnitIds.includes(unitId));

  assert.ok(firstBaseUnitIds.includes(headingUnitId));
  assert.ok(firstBaseUnitIds.includes(contentUnitId));
  assert.ok(
    firstBaseUnitIds.indexOf(headingUnitId)
      < firstBaseUnitIds.indexOf(contentUnitId),
  );
});

test("one-paragraph articles produce one complete chunk when within range", () => {
  const result = buildCf7Phase1({
    title: "One paragraph",
    text: sentence("singleword", 900),
  });
  assert.equal(result.chunks.length, 1);
  assert.equal(result.coverageReport.coverageComplete, true);
  assert.deepEqual(result.chunks[0]!.overlapUnitIds, []);
});

test("a single oversized sentence remains intact and is reported as unavoidable", () => {
  const result = buildCf7Phase1({
    title: "One oversized sentence",
    text: sentence("oversizedword", 1_500),
  });
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0]!.unitIds.length, 1);
  assert.equal(result.coverageReport.sentenceFragmentationCount, 0);
  assert.deepEqual(
    result.coverageReport.unavoidableOversizedChunkIds,
    ["CHUNK-001"],
  );
});
