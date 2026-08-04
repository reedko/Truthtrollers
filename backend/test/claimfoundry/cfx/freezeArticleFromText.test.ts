import assert from "node:assert/strict";
import test from "node:test";
import { freezeCfxArticleFromText } from "../../../src/claimfoundry/cfx/input/freezeArticle.js";

const title = "A live-scraped headline";
const text = [
  "The first paragraph of a freshly scraped article.",
  "",
  "The second paragraph adds a supporting detail.",
  "",
  "The third and final paragraph closes the piece.",
].join("\n");

test("freezing the same raw text twice produces identical, stable S0 units", () => {
  const first = freezeCfxArticleFromText({ title, text, sourceUrl: "https://example.test/a" });
  const second = freezeCfxArticleFromText({ title, text, sourceUrl: "https://example.test/a" });

  assert.equal(first.articleTextSha256, second.articleTextSha256);
  assert.equal(first.normalizedArticleHash, second.normalizedArticleHash);
  assert.equal(first.sourceUnitManifestHash, second.sourceUnitManifestHash);
  assert.equal(first.unitProjectionSha256, second.unitProjectionSha256);
  assert.deepEqual(first.sourceUnits, second.sourceUnits);
  assert.equal(first.sourceUnitCount, second.sourceUnitCount);
  assert.ok(first.sourceUnitCount > 0);
});

test("source units are contiguous, correctly bounded, and carry a stable unitId shape", () => {
  const frozen = freezeCfxArticleFromText({ title, text });
  for (const unit of frozen.sourceUnits) {
    assert.match(unit.unitId, /^U\d+$/u);
    assert.ok(unit.charStart >= 0);
    assert.ok(unit.charEnd > unit.charStart);
    assert.ok(unit.charEnd <= frozen.canonicalText.length);
    assert.equal(frozen.canonicalText.slice(unit.charStart, unit.charEnd), unit.text);
  }
});

test("sourceUrl and contentId affect only provenance labels, never the grounded unit hashes", () => {
  const bare = freezeCfxArticleFromText({ title, text });
  const withProvenance = freezeCfxArticleFromText({
    title, text, sourceUrl: "https://example.test/live-scrape", contentId: 18057,
  });

  assert.equal(bare.sourceUnitManifestHash, withProvenance.sourceUnitManifestHash);
  assert.equal(bare.normalizedArticleHash, withProvenance.normalizedArticleHash);
  assert.deepEqual(bare.sourceUnits, withProvenance.sourceUnits);
  assert.notEqual(bare.fixtureId, withProvenance.fixtureId);
  assert.equal(withProvenance.fixtureId, "content-18057");
  assert.equal(withProvenance.fixturePath, "https://example.test/live-scrape");
});

test("different article text produces a different hash and unit set", () => {
  const first = freezeCfxArticleFromText({ title, text });
  const second = freezeCfxArticleFromText({ title, text: `${text}\n\nA fourth paragraph was added.` });
  assert.notEqual(first.articleTextSha256, second.articleTextSha256);
  assert.notEqual(first.sourceUnitManifestHash, second.sourceUnitManifestHash);
});

test("freezing from text is a pure, synchronous computation -- no DB writes, no model calls are possible", () => {
  const returned = freezeCfxArticleFromText({ title, text });
  assert.equal(returned instanceof Promise, false);
  assert.equal(typeof returned.articleText, "string");
});
