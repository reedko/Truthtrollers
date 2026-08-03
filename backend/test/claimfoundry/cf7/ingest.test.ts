import assert from "node:assert/strict";
import test from "node:test";
import { Cf7Error } from "../../../src/claimfoundry/shared/errors/Cf7Error.js";
import { ingestArticle } from "../../../src/claimfoundry/cf7/ingest/ingestArticle.js";

const ARTICLE = [
  "A stable first sentence. A stable second sentence.",
  "A separate paragraph remains structurally distinct.",
].join("\n\n");

test("ingest produces stable unit IDs, exact spans, and deterministic hashes", () => {
  const first = ingestArticle({ title: "Stable article", text: ARTICLE });
  const second = ingestArticle({ title: "Stable article", text: ARTICLE });

  assert.deepEqual(first.units, second.units);
  assert.deepEqual(first.regions, second.regions);
  assert.equal(
    first.sourceManifest.contentHash,
    second.sourceManifest.contentHash,
  );
  assert.equal(
    first.sourceManifest.sourceUnitManifestHash,
    second.sourceManifest.sourceUnitManifestHash,
  );
  assert.deepEqual(
    first.units.map((unit) => unit.unitId),
    first.units.map((_, index) => `U${String(index + 1).padStart(4, "0")}`),
  );
  for (const unit of first.units) {
    assert.equal(
      first.canonicalText.slice(unit.charStart, unit.charEnd),
      unit.text,
    );
    assert.match(unit.regionId, /^REGION-\d{3}$/);
    assert.ok(unit.quarter >= 1 && unit.quarter <= 4);
  }
});

test("empty articles are rejected deterministically before normalization", () => {
  assert.throws(
    () => ingestArticle({ title: "Empty", text: " \n\t " }),
    (error: unknown) =>
      error instanceof Cf7Error && error.code === "CF7_EMPTY_ARTICLE",
  );
});

test("ingest never strands honorific or U.S. abbreviation fragments", () => {
  const result = ingestArticle({
    title: "Complete evidence spans",
    text: [
      "The agency commissioned Dr. Rivera to conduct the study.",
      "The U.S. regulator later published the result.",
    ].join(" "),
  });
  assert.ok(result.units.every((unit) =>
    !/(?:\bDr\.|\bU\.S\.)$/.test(unit.text)));
  assert.ok(result.units.some((unit) =>
    unit.text.includes("Dr. Rivera")));
  assert.ok(result.units.some((unit) =>
    unit.text.includes("U.S. regulator")));
});

test("context-dependent units retain canonical text and declare antecedent context", () => {
  const result = ingestArticle({
    title: "Antecedent context",
    text:
      "The regulator rejected the filing. It later approved a revised filing.",
  });
  const dependent = result.units.find((unit) =>
    unit.text === "It later approved a revised filing.");
  assert.ok(dependent);
  assert.equal(dependent.contextUnitIds?.length, 1);
  assert.equal(
    result.canonicalText.slice(dependent.charStart, dependent.charEnd),
    dependent.text,
  );
  assert.match(dependent.resolvedProjection ?? "", /rejected[\s\S]*approved/);
});
