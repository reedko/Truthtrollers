import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalClaimContext,
  buildMappingClaimPacket,
  deriveHostScoreTransform,
} from "./prompt-benchmark/legacyDbMappingDeterministic.js";

test("local context selects the paragraph matching claim metadata", () => {
  const article = "Unrelated opening.\n\nA report by River Institute found 37 affected sites.\n\nLater commentary.";
  const claim = { text: "Thirty-seven sites were affected.",
    searchText: "River Institute 37 affected sites", namedEntities: ["River Institute"] };
  const result = buildLocalClaimContext(article, claim, { radius: 0 });
  assert.equal(result.bestParagraphIndex, 1);
  assert.match(result.text, /River Institute/);
});

test("mapping packet preserves Call 1 metadata and adds deterministic context", () => {
  const packet = buildMappingClaimPacket("Opening.\n\nAgency Z stated the measured value was 42.", {
    text: "The measured value was 42.", role: "evidence", searchText: "Agency Z value 42",
    sourceCitedInArticle: "Agency Z", namedEntities: ["Agency Z"],
  }, 7);
  assert.equal(packet.claimId, 7);
  assert.equal(packet.sourceCitedInArticle, "Agency Z");
  assert.match(packet.localArticleContext, /Agency Z/);
});

test("host transform follows stance and function before a conflicting emitted default", () => {
  assert.equal(deriveHostScoreTransform("background", "rejects", "none"), "invert");
  assert.equal(deriveHostScoreTransform("opposing_claim_to_refute", "neutral", "normal"), "invert");
  assert.equal(deriveHostScoreTransform("evidence", "neutral", "normal"), "normal");
  assert.equal(deriveHostScoreTransform("reported_neutral", "neutral", "invert"), "none");
});
