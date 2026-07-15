import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveUnitGrounding, inheritAssertionGrounding } from
  "../../src/claim-foundry/grounding.js";
import { articleDocumentFromText, buildArticleSourceBlocks } from
  "../../src/claim-foundry/article-document/index.js";
import { createArticleAndBlocks } from "./fixtures/packages.js";

test("grounding rejects unknown, repeated, and out-of-order source units", () => {
  const { articleDocument, structuralBlocks } = createArticleAndBlocks();
  const derive = (sourceUnitIds) => deriveUnitGrounding({ sourceUnitIds, articleDocument,
    sourceBlocks: structuralBlocks, path: "/rawAssertions/0/sourceUnitIds" });
  assert.throws(() => derive(["U9999"]), (error) => error.code === "CF1_GROUNDING_UNKNOWN_UNIT");
  assert.throws(() => derive(["U0001", "U0001"]),
    (error) => error.code === "CF1_GROUNDING_DUPLICATE_UNIT");
  assert.throws(() => derive(["U0002", "U0001"]),
    (error) => error.code === "CF1_GROUNDING_UNIT_ORDER");
});

test("selected claims inherit the ordered union of raw-assertion provenance", () => {
  const { articleDocument, structuralBlocks } = createArticleAndBlocks();
  const rawAssertions = [
    { rawAssertionId: "R001", sourceUnitIds: ["U0002"] },
    { rawAssertionId: "R002", sourceUnitIds: ["U0001", "U0002"] },
  ];
  const grounded = inheritAssertionGrounding({ sourceRawAssertionIds: ["R001", "R002"],
    rawAssertions, articleDocument, sourceBlocks: structuralBlocks,
    path: "/selectedEvaluationClaims/0/sourceRawAssertionIds" });
  assert.deepEqual(grounded.sourceUnitIds, ["U0001", "U0002"]);
  assert.deepEqual(grounded.sourceOffsets, [{ start: 0, end: articleDocument.canonicalText.length }]);
});

test("F01 provenance is derived exactly without a model-produced excerpt", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const article = JSON.parse(await readFile(join(here, "fixtures/CF1-F01/article.json"), "utf8"));
  const articleDocument = articleDocumentFromText({ text: article.text,
    metadata: { title: article.title, language: article.language } });
  const sourceBlocks = buildArticleSourceBlocks(articleDocument);
  const unit = articleDocument.sourceUnits.find((item) => item.text.includes(
    "Vaccination before\n36 months was more common among case children"));
  assert.ok(unit, "expected the F01 36-month finding to be a stable source unit");
  const grounded = deriveUnitGrounding({ sourceUnitIds: [unit.unitId], articleDocument,
    sourceBlocks, path: "/rawAssertions/0/sourceUnitIds" });
  assert.equal(grounded.sourceExcerpt, unit.text);
  assert.equal(articleDocument.canonicalText.slice(grounded.sourceOffsets[0].start,
    grounded.sourceOffsets[0].end), unit.text);
  assert.match(grounded.sourceExcerpt, /likely reflecting immunization requirements/);
});
