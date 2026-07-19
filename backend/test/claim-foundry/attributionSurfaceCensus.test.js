import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectAttributionSurface } from "../../src/claim-foundry/attributionSurfaceCensus.js";
import { prepareArticle } from "./prompt-benchmark/generationRun.js";

const unit = (order, type, text) => ({ unitId: `U${String(order).padStart(4, "0")}`, order, type, text });

test("collects structural attribution surfaces by unit type", () => {
  const items = collectAttributionSurface({ sourceUnits: [
    unit(1, "quotation", "“That is not science,” he said."),
    unit(2, "speaker_turn", "INTERVIEWER: What did you find?"),
    unit(3, "social_post", "We tested it ourselves and the results were damning."),
    unit(4, "social_reply", "Replying: the agency never responded."),
  ] });
  assert.deepEqual(items.map((i) => i.kind),
    ["block_quotation", "speaker_turn", "embedded_post", "embedded_post"]);
});

test("collects prose attributed statements via lexical cue", () => {
  const items = collectAttributionSurface({ sourceUnits: [
    unit(1, "sentence", "Glyphosate is widely used across the country."),
    unit(2, "sentence", "Antoniou said the formulations are far more toxic."),
    unit(3, "sentence", "According to the agency, the limits are safe."),
  ] });
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, "attributed_statement");
  assert.ok(items[0].signals.includes("named_source"));
  assert.equal(items[1].kind, "attributed_statement");
});

test("flags question and challenge passages", () => {
  const items = collectAttributionSurface({ sourceUnits: [
    unit(1, "sentence", "But is the so-called safety limit actually meaningful?"),
    unit(2, "sentence", "There is no evidence the review was independent."),
  ] });
  assert.ok(items[0].signals.includes("qa_passage"));
  assert.ok(items[0].signals.includes("challenge_signal"));
  assert.equal(items[1].kind, "challenge_signal");
});

test("skips units that carry no attribution surface", () => {
  const items = collectAttributionSurface({ sourceUnits: [
    unit(1, "sentence", "The product is applied to crops in the spring."),
    unit(2, "heading", "Background"),
  ] });
  assert.equal(items.length, 0);
});

test("census ids are sequential and grounding is a single unit", () => {
  const items = collectAttributionSurface({ sourceUnits: [
    unit(1, "quotation", "“One.”"), unit(2, "quotation", "“Two.”")] });
  assert.deepEqual(items.map((i) => i.censusId), ["CEN001", "CEN002"]);
  assert.deepEqual(items[0].sourceUnitIds, ["U0001"]);
});

test("respects the maxItems ceiling", () => {
  const many = Array.from({ length: 100 }, (_, i) => unit(i + 1, "quotation", `“Q${i}”`));
  assert.equal(collectAttributionSurface({ sourceUnits: many, maxItems: 12 }).length, 12);
});

test("is independent of Call 1A: candidate list cannot influence output", () => {
  // The census must catch what 1A missed, so passing a candidate list (even one
  // that would "explain" a unit) changes nothing — only source units are read.
  const sourceUnits = [unit(1, "quotation", "“That is not science,” he said.")];
  const without = collectAttributionSurface({ sourceUnits });
  const withCandidates = collectAttributionSurface({ sourceUnits,
    candidateClaims: [{ claimText: "x", sourceUnitIds: ["U0001"] }] });
  assert.deepEqual(withCandidates, without);
  assert.deepEqual(collectAttributionSurface({ sourceUnits: [] }), []);
});

test("F02 smoke: recovers every block quotation as an attribution surface", () => {
  const raw = JSON.parse(readFileSync(new URL("./fixtures/CF1-F02/article.json", import.meta.url)));
  const { articleDocument } = prepareArticle(raw.article ?? raw);
  const items = collectAttributionSurface({ sourceUnits: articleDocument.sourceUnits });
  const quoteUnits = articleDocument.sourceUnits.filter((u) => u.type === "quotation").length;
  const censusQuotes = items.filter((i) => i.kind === "block_quotation").length;
  assert.equal(censusQuotes, quoteUnits);
  assert.ok(items.length > quoteUnits, "should also surface prose attributed statements");
});
