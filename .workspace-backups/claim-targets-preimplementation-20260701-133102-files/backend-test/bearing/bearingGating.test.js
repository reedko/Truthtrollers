import assert from "node:assert/strict";
import test from "node:test";

import { EvidenceEngine } from "../../src/core/evidenceEngine.js";
import {
  DEFAULT_BEARING_GATING_CONFIG,
  normalizeBearingGatingConfig,
} from "../../src/core/bearingConfig.js";
import {
  allocateCandidatesAcrossClaims,
  mergeCanonicalCandidates,
  selectCandidatesForClaim,
  selectClaimsForBearingGating,
} from "../../src/core/evidenceCandidateSelector.js";
import { buildEvidenceNeedV1 } from "../../src/core/evidenceNeed.js";

function config(overrides = {}) {
  return normalizeBearingGatingConfig({
    enableBearingGating: true,
    ...overrides,
    perClaimLimits: {
      ...DEFAULT_BEARING_GATING_CONFIG.perClaimLimits,
      ...(overrides.perClaimLimits || {}),
    },
  }, {});
}

function candidate(id, score, extra = {}) {
  return {
    id,
    url: `https://example.org/${id}`,
    title: id,
    snippet: `Snippet ${id}`,
    score,
    source: "web_search",
    bearingPreScore: score,
    deterministicBearingScore: score,
    expectedStance: "support",
    bearingType: "direct",
    claimComponentAddressed: "whole_claim",
    ...extra,
  };
}

const thesisClaim = {
  id: 1,
  text: "Exposure X increases outcome Y",
  role: "thesis",
  evidenceNeed: { claimType: "factual" },
};

test("gating configuration is default-off, validated, and has an environment kill switch", () => {
  assert.equal(normalizeBearingGatingConfig({}, {}).enableBearingGating, false);
  assert.equal(normalizeBearingGatingConfig({ enableBearingGating: true }, {}).enableBearingGating, true);
  assert.equal(normalizeBearingGatingConfig({ enableBearingGating: true }, { ENABLE_BEARING_GATING: "false" }).enableBearingGating, false);
  assert.equal(normalizeBearingGatingConfig({}, { ENABLE_BEARING_GATING: "true" }).enableBearingGating, true);

  const normalized = normalizeBearingGatingConfig({
    minBearingToScrape: 5,
    forceSkipBelowBearing: -2,
    maxClaimsSearchedPerContent: 100,
    globalScrapeLimitPerContent: 0,
  }, {});
  assert.equal(normalized.minBearingToScrape, 1);
  assert.equal(normalized.forceSkipBelowBearing, 0);
  assert.equal(normalized.maxClaimsSearchedPerContent, 20);
  assert.equal(normalized.globalScrapeLimitPerContent, 1);
  assert.ok(normalized.forceSkipBelowBearing <= normalized.minBearingToScrape);
  assert.ok(normalized.deterministicForceSkipBelow <= normalized.minBearingToScrape);
  assert.equal(normalizeBearingGatingConfig({}, {}).enableBearingPacket, false);
  assert.equal(normalizeBearingGatingConfig({}, { ENABLE_BEARING_PACKET: "true" }).enableBearingPacket, true);
  assert.equal(normalizeBearingGatingConfig({ enableBearingPacket: true }, { ENABLE_BEARING_PACKET: "false" }).enableBearingPacket, false);
  assert.equal(normalizeBearingGatingConfig({}, { ENABLE_BEARING_PACKET_LIVE: "true" }).enableBearingPacketLive, false);
  assert.equal(normalizeBearingGatingConfig({
    enableBearingGating: true,
    enableBearingPacket: true,
    enableBearingPacketLive: true,
  }, {}).enableBearingPacketLive, true);
  assert.equal(normalizeBearingGatingConfig({
    enableBearingGating: true,
    enableBearingPacket: true,
    enableBearingPacketLive: true,
  }, { ENABLE_BEARING_PACKET_LIVE: "false" }).enableBearingPacketLive, false);
});

test("claim gate excludes background/none claims and enforces the case-claim cap", () => {
  const claims = [
    { id: 1, role: "thesis" },
    { id: 2, role: "background" },
    { id: 3, role: "evidence", scoreTransform: "none" },
    ...Array.from({ length: 10 }, (_, index) => ({ id: 10 + index, role: "evidence" })),
  ];
  const selected = selectClaimsForBearingGating(claims, config({ maxClaimsSearchedPerContent: 8 }));
  assert.equal(selected.eligible.length, 8);
  assert.ok(selected.skipped.some((item) => item.reason === "background_claim"));
  assert.ok(selected.skipped.some((item) => item.reason === "score_transform_none"));
  assert.ok(selected.skipped.some((item) => item.reason === "max_claims_searched"));
});

test("claim gate reserves a capped search slot for the thesis", () => {
  const claims = [
    ...Array.from({ length: 8 }, (_, index) => ({
      id: 10 + index,
      argumentFunction: "supporting_premise",
      scoreTransform: "normal",
    })),
    {
      id: 1,
      argumentFunction: "thesis",
      scoreTransform: "normal",
    },
  ];

  const selected = selectClaimsForBearingGating(
    claims,
    config({ maxClaimsSearchedPerContent: 8 }),
  );

  assert.equal(selected.eligible.length, 8);
  assert.equal(selected.eligible[0].id, 1);
  assert.ok(selected.eligible.some((claim) => claim.id === 1));
  assert.ok(selected.skipped.some((item) => item.claim.id === 17 && item.reason === "max_claims_searched"));
  assert.deepEqual(claims.map((claim) => claim.id), [10, 11, 12, 13, 14, 15, 16, 17, 1]);
});

test("selection is bearing-first and does not reward authority or force balance", () => {
  const candidates = [
    candidate("direct", 0.88, { expectedStance: "support" }),
    candidate("authority", 0.05, {
      url: "https://agency.gov/topic",
      domain: "agency.gov",
      expectedStance: "refute",
      bearingType: "none",
      claimComponentAddressed: "none",
    }),
  ];
  const plan = selectCandidatesForClaim(thesisClaim, candidates, config());
  assert.deepEqual(plan.selectedCandidates.map((item) => item.id), ["direct"]);
  assert.ok(plan.decisions.some((item) => item.candidate.id === "authority" && item.decision === "skip"));
});

test("origin is protected, while a junk steelman is not", () => {
  const candidates = [
    candidate("origin", 0.03, {
      evidenceTargetType: "primary_source",
      stanceGoal: "origin",
      bearingType: "origin",
      expectedStance: "insufficient",
    }),
    candidate("direct", 0.8),
    candidate("junk-steelman", 0.01, {
      bearingType: "steelman",
      stanceGoal: "steelman",
      expectedStance: "refute",
    }),
    candidate("useful-steelman", 0.25, {
      bearingType: "steelman",
      stanceGoal: "steelman",
      expectedStance: "refute",
    }),
  ];
  const plan = selectCandidatesForClaim(thesisClaim, candidates, config({
    perClaimLimits: { thesis: 4 },
  }));
  const ids = plan.selectedCandidates.map((item) => item.id);
  assert.ok(ids.includes("origin"));
  assert.ok(ids.includes("direct"));
  assert.ok(ids.includes("useful-steelman"));
  assert.equal(ids.includes("junk-steelman"), false);
});

test("all-low candidate sets retain at most one conservative fallback", () => {
  const plan = selectCandidatesForClaim(thesisClaim, [
    candidate("best-maybe", 0.2, { bearingType: "indirect" }),
    candidate("lower-maybe", 0.18, { bearingType: "indirect" }),
    candidate("force-skip", 0.05, { bearingType: "none" }),
  ], config());
  assert.deepEqual(plan.selectedCandidates.map((item) => item.id), ["best-maybe"]);
});

test("LLM failure uses deterministic scores and high scorer disagreement is not force-skipped", () => {
  const deterministicDirect = candidate("deterministic-direct", 0.01, {
    bearingPreScore: undefined,
    llmBearingPreScore: null,
    deterministicBearingScore: 0.7,
  });
  const disagreement = candidate("disagreement", 0.01, {
    bearingPreScore: 0.05,
    llmBearingPreScore: 0.8,
    deterministicBearingScore: 0,
    scorerDisagreement: 0.8,
  });
  const lowFallback = candidate("low", 0.01, {
    bearingPreScore: undefined,
    llmBearingPreScore: null,
    deterministicBearingScore: 0.02,
    bearingType: "none",
    claimComponentAddressed: "none",
  });
  const plan = selectCandidatesForClaim(thesisClaim, [deterministicDirect, disagreement, lowFallback], config());
  const ids = plan.selectedCandidates.map((item) => item.id);
  assert.ok(ids.includes("deterministic-direct"));
  assert.ok(ids.includes("disagreement"));
  assert.equal(ids.includes("low"), false);
});

test("canonical merge is live only inside the selector and preserves provenance", () => {
  const merged = mergeCanonicalCandidates([
    candidate("first", 0.5, { url: "https://example.org/report?utm_source=a", provider: "tavily" }),
    candidate("second", 0.8, { url: "https://example.org/report", provider: "bing" }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "second");
  assert.equal(merged[0].retrievalProvenance.length, 2);
});

test("global allocation is round-robin and counts canonical URLs once", () => {
  const first = { ...thesisClaim, id: 1 };
  const second = { ...thesisClaim, id: 2 };
  const sharedA = candidate("shared-a", 0.9, { url: "https://example.org/shared?utm_source=a" });
  const sharedB = candidate("shared-b", 0.95, { url: "https://example.org/shared" });
  const plans = [
    { claim: first, selectedCandidates: [sharedA, candidate("one-extra", 0.8)] },
    { claim: second, selectedCandidates: [sharedB, candidate("two-extra", 0.85)] },
  ];
  const allocation = allocateCandidatesAcrossClaims(plans, config({ globalScrapeLimitPerContent: 2 }));

  assert.equal(allocation.usedCanonicalUrls.size, 2);
  assert.equal(allocation.selectedByClaimId.get(1).length, 2);
  assert.equal(allocation.selectedByClaimId.get(2).length, 1);
  assert.equal(allocation.selectedByClaimId.get(1)[0].id, "shared-a");
  assert.equal(allocation.selectedByClaimId.get(2)[0].id, "shared-b");
});

test("gated EvidenceEngine enforces claim/global limits and reuses canonical URLs", async () => {
  const originalBearing = process.env.ENABLE_BEARING_SHADOW;
  const originalLlm = process.env.ENABLE_SNIPPET_BEARING_LLM;
  process.env.ENABLE_BEARING_SHADOW = "true";
  process.env.ENABLE_SNIPPET_BEARING_LLM = "false";

  const networkFetches = [];
  const cache = new Map();
  const search = {
    internal: async () => [],
    web: async ({ query }) => {
      if (query.includes("claim-one")) {
        return [
          candidate("shared-one", 0.95, { url: "https://example.org/shared?utm_source=one" }),
          candidate("one-extra", 0.85),
          candidate("one-low", 0.02, { bearingType: "none", claimComponentAddressed: "none" }),
        ];
      }
      return [
        candidate("shared-two", 0.96, { url: "https://example.org/shared" }),
        candidate("two-extra", 0.86),
        candidate("two-low", 0.01, { bearingType: "none", claimComponentAddressed: "none" }),
      ];
    },
  };
  const engine = new EvidenceEngine({
    search,
    fetcher: {
      async getText(item) {
        if (!cache.has(item.url)) {
          networkFetches.push(item.url);
          cache.set(item.url, { isProcessed: true, cleanText: `Full text for ${item.url}`, citationCount: 0 });
        }
        return cache.get(item.url);
      },
    },
    extractQuotesAndScoreQuality: async ({ url }) => ({
      quotes: [{ quote: `Quote from ${url}`, stance: "support", summary: "Fixture", bearing_score: 0.8, bearing_type: "direct", claim_component_addressed: "whole_claim", causal_strength: "not_applicable", bearing_reason: "Direct." }],
      qualityScores: null,
    }),
  });
  const claims = [
    { id: 1, text: "Claim one", role: "thesis", evidenceNeed: buildEvidenceNeedV1({ id: 1, text: "Claim one", role: "thesis" }), searchTargets: [{ query: "claim-one", intent: "support" }] },
    { id: 2, text: "Claim two", role: "pillar", evidenceNeed: buildEvidenceNeedV1({ id: 2, text: "Claim two", role: "pillar" }), searchTargets: [{ query: "claim-two", intent: "support" }] },
    { id: 3, text: "Background", role: "background", evidenceNeed: buildEvidenceNeedV1({ id: 3, text: "Background", role: "background" }), searchTargets: [{ query: "background", intent: "background" }] },
  ];

  try {
    const gatingConfig = config({
      maxClaimsSearchedPerContent: 2,
      globalScrapeLimitPerContent: 2,
      perClaimLimits: { thesis: 3, pillar: 3 },
    });
    const results = await engine.run(claims, null, {
      enableBearingGating: true,
      bearingConfig: gatingConfig,
      enableInternal: false,
      enableWeb: true,
      topKQueries: 1,
      topKCandidates: 10,
      topKPerIntent: 10,
      maxEvidenceCandidates: 9,
      maxEvidencePerDoc: 1,
      enableFringeSearch: false,
      taskContentId: 900,
    });

    assert.equal(results.length, 3, "claim indexes remain aligned with the legacy result contract");
    assert.equal(results[2].bearingGatingSkipReason, "background_claim");
    assert.equal(results[0].selectedCandidates.length, 2);
    assert.equal(results[1].selectedCandidates.length, 1);
    assert.equal(new Set(networkFetches).size, 2, "global unique URL cap is enforced");
    assert.equal(networkFetches.length, 2, "canonical duplicate is fetched once");
    assert.equal(results[0].evidence.length, 2);
    assert.equal(results[1].evidence.length, 1);
  } finally {
    if (originalBearing === undefined) delete process.env.ENABLE_BEARING_SHADOW;
    else process.env.ENABLE_BEARING_SHADOW = originalBearing;
    if (originalLlm === undefined) delete process.env.ENABLE_SNIPPET_BEARING_LLM;
    else process.env.ENABLE_SNIPPET_BEARING_LLM = originalLlm;
  }
});
