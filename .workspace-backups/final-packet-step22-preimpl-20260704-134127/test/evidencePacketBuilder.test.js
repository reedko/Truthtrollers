import test from "node:test";
import assert from "node:assert/strict";

import { EvidenceEngine } from "../../src/core/evidenceEngine.js";
import {
  buildEvidencePacket,
  classifyPacketRole,
  explainPacketSelection,
} from "../../src/core/evidencePacketBuilder.js";

function evidence(id, overrides = {}) {
  return {
    id,
    candidateId: id,
    url: `https://${id}.example.org/document`,
    title: `Title ${id}`,
    quote: `Exact quote ${id}`,
    summary: `Summary ${id}`,
    stance: "support",
    bearingScore: 0.8,
    bearingType: "direct",
    bearingReason: "Directly tests the predicate and outcome.",
    claimComponentAddressed: "whole_claim",
    causalStrength: "not_applicable",
    quality: 0.7,
    ...overrides,
  };
}

test("packet fills available support, refute, nuance, origin, and steelman slots", () => {
  const claim = { id: 1, evidenceNeed: { claimType: "factual" } };
  const packet = buildEvidencePacket({
    claim,
    evidence: [
      evidence("support", { stance: "support", bearingScore: 0.91 }),
      evidence("refute", { stance: "refute", bearingScore: 0.89 }),
      evidence("nuance", { stance: "nuance", bearingScore: 0.76, claimComponentAddressed: "scope" }),
      evidence("origin", { stance: "support", bearingScore: 0.72, bearingType: "origin", bearingRequirement: "source_attribution", claimComponentAddressed: "attribution" }),
      evidence("steelman", { stance: "refute", bearingScore: 0.68, bearingType: "steelman", isFringe: true }),
    ],
  });

  assert.equal(packet.itemCount, 5);
  assert.deepEqual(new Set(packet.items.map((item) => item.packetRole)), new Set([
    "data_ground",
    "rebuttal_limitation",
    "origin_attribution",
    "steelman",
  ]));
  assert.ok(packet.items.every((item) => item.verdictEligible));
  assert.ok(packet.items.every((item) => item.inclusionReason && item.qualityLabel));
});

test("topic-only and insufficient evidence is rejected and never pads a packet", () => {
  const packet = buildEvidencePacket({
    claim: { id: 2 },
    evidence: [
      evidence("direct", { bearingScore: 0.82 }),
      evidence("topic", { bearingScore: 0.9, bearingType: "none", claimComponentAddressed: "subject" }),
      evidence("context", { bearingScore: 0.8, bearingType: "context", claimComponentAddressed: "subject" }),
      evidence("weak", { bearingScore: 0.2 }),
      evidence("insufficient", { stance: "insufficient", bearingScore: 0.95 }),
    ],
  });

  assert.equal(packet.itemCount, 1);
  assert.equal(packet.items[0].evidenceId, "direct");
  assert.equal(packet.stats.rejectedCount, 4);
  assert.ok(packet.rejected.some((item) => item.reason === "topic_only_or_no_bearing"));
  assert.ok(packet.rejected.some((item) => item.reason === "topic_only_context"));
});

test("causal claims demote association-only support to partial nuance", () => {
  const packet = buildEvidencePacket({
    claim: { id: 3, evidenceNeed: { claimType: "causal" } },
    evidence: [evidence("association", {
      stance: "support",
      causalStrength: "correlational",
      claimComponentAddressed: "relation",
    })],
  });

  assert.equal(packet.items[0].stance, "nuance");
  assert.equal(packet.items[0].originalStance, "support");
  assert.equal(packet.items[0].partialForClaim, true);
  assert.equal(packet.items[0].packetRole, "rebuttal_limitation");
});

test("packet caps quotes per document and prefers domain diversity within a bearing band", () => {
  const shared = "https://same.example.org/report?utm_source=test";
  const packet = buildEvidencePacket({
    claim: { id: 4 },
    evidence: [
      evidence("a", { url: shared, quote: "Quote A", bearingScore: 0.9 }),
      evidence("b", { url: shared, quote: "Quote B", stance: "refute", bearingScore: 0.88 }),
      evidence("c", { url: shared, quote: "Quote C", stance: "nuance", bearingScore: 0.87 }),
      evidence("d", { url: "https://same.example.org/other", bearingScore: 0.85 }),
      evidence("e", { url: "https://different.example.net/study", bearingScore: 0.84 }),
    ],
    maxQuotesPerDocument: 2,
  });

  const sharedCount = packet.items.filter((item) => item.documentKey === "https://same.example.org/report").length;
  assert.ok(sharedCount <= 2);
  assert.ok(packet.stats.selectedDomainCount >= 2);
});

test("packet output is compact and helpers expose stable role/reason contracts", () => {
  const item = evidence("compact", { raw_text: "x".repeat(10000), bearingRequirement: "warrant_test" });
  const packet = buildEvidencePacket({ claim: { id: 5 }, evidence: [item] });

  assert.equal(classifyPacketRole(item), "warrant_test");
  assert.match(explainPacketSelection(item, "warrant_test"), /Selected as warrant_test/);
  assert.equal("raw_text" in packet.items[0], false);
  assert.ok(JSON.stringify(packet).length < 5000);
});

test("EvidenceEngine packet flag is additive and leaves legacy adjudication unchanged", () => {
  const engine = new EvidenceEngine({});
  const claim = { id: 6, text: "Exact claim" };
  const items = [evidence("legacy")];
  const legacyBefore = engine.adjudicate(claim, items);

  assert.equal(engine.buildPacketSidecar(claim, items, { enableBearingPacket: false }), null);
  const packet = engine.buildPacketSidecar(claim, items, {
    enableBearingPacket: true,
    bearingConfig: { minBearingForPacket: 0.35, maxEvidencePacketItems: 5 },
  });
  const legacyAfter = engine.adjudicate(claim, items);

  assert.equal(packet.itemCount, 1);
  assert.deepEqual(legacyAfter, legacyBefore);
});

test("EvidenceEngine returns the packet beside the legacy adjudication when enabled", async () => {
  const engine = new EvidenceEngine({
    search: {
      internal: async () => [],
      web: async () => [{
        id: "source",
        url: "https://source.example/study",
        title: "Direct study",
        score: 0.8,
      }],
    },
    fetcher: {
      getText: async () => ({ isProcessed: true, cleanText: "Study text", citationCount: 1 }),
    },
    extractQuotesAndScoreQuality: async () => ({
      quotes: [{
        quote: "Exposure X increased outcome Y.",
        summary: "Direct finding.",
        stance: "support",
        bearing_score: 0.86,
        bearing_type: "direct",
        bearing_reason: "Matches the exact relation and outcome.",
        claim_component_addressed: "whole_claim",
        causal_strength: "causal",
      }],
      qualityScores: { quality_tier: "high" },
    }),
  });
  const [row] = await engine.run([{
    id: 7,
    text: "Exposure X increases outcome Y.",
    searchTargets: [{ query: "Exposure X outcome Y", intent: "both" }],
  }], null, {
    enableBearingGating: false,
    enableBearingPacket: true,
    bearingConfig: { minBearingForPacket: 0.35, maxEvidencePacketItems: 5 },
    enableInternal: false,
    enableWeb: true,
    enableFringeSearch: false,
    enableRedTeam: false,
    topKQueries: 1,
    topKCandidates: 1,
    maxEvidenceCandidates: 1,
    maxEvidencePerDoc: 2,
  });

  assert.equal(row.evidencePacket.itemCount, 1);
  assert.equal(row.evidencePacket.items[0].inclusionReason.includes("exact"), true);
  assert.deepEqual(row.adjudication, engine.adjudicate(row.claim, row.evidence));
});

test("live packet adjudication excludes low-bearing support from verdict weight", async () => {
  const engine = new EvidenceEngine({
    search: {
      internal: async () => [],
      web: async () => [
        { id: "topic", url: "https://topic.example/page", title: "Topic page", score: 1.2 },
        { id: "direct", url: "https://direct.example/study", title: "Direct study", score: 0.5 },
      ],
    },
    fetcher: {
      getText: async () => ({ isProcessed: true, cleanText: "Source text", citationCount: 0 }),
    },
    extractQuotesAndScoreQuality: async ({ url }) => url.includes("topic") ? ({
      quotes: [{
        quote: "General topic statement.", stance: "support", summary: "Topic only.",
        bearing_score: 0.2, bearing_type: "context", bearing_reason: "Does not test the claim.",
        claim_component_addressed: "subject", causal_strength: "not_applicable",
      }],
      qualityScores: null,
    }) : ({
      quotes: [{
        quote: "The study directly contradicted the claim.", stance: "refute", summary: "Direct test.",
        bearing_score: 0.9, bearing_type: "direct", bearing_reason: "Tests the whole claim.",
        claim_component_addressed: "whole_claim", causal_strength: "not_applicable",
      }],
      qualityScores: null,
    }),
  });

  const [row] = await engine.run([{
    id: 8,
    text: "Exact quantitative claim.",
    searchTargets: [{ query: "exact quantitative claim", intent: "both" }],
  }], null, {
    enableBearingGating: false,
    enableBearingPacket: true,
    enableBearingPacketLive: true,
    bearingConfig: { minBearingForPacket: 0.35, maxEvidencePacketItems: 5 },
    enableInternal: false,
    enableWeb: true,
    enableFringeSearch: false,
    enableRedTeam: false,
    topKQueries: 1,
    topKCandidates: 2,
    maxEvidenceCandidates: 2,
    maxEvidencePerDoc: 2,
  });

  assert.equal(row.evidence.length, 2);
  assert.equal(row.evidencePacket.itemCount, 1);
  assert.equal(row.evidencePacket.items[0].stance, "refute");
  assert.equal(row.adjudication.finalVerdict, "refute");
  assert.deepEqual(row.adjudication.evidenceIds, ["8:direct:0"]);
});
