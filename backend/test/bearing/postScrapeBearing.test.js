import assert from "node:assert/strict";
import test from "node:test";

import { EvidenceEngine } from "../../src/core/evidenceEngine.js";
import {
  extractQuotesAndScoreQuality,
  isPostScrapeBearingEnabled,
  normalizePostScrapeBearingScore,
} from "../../src/utils/extractQuote.js";
import logger from "../../src/utils/logger.js";

const quality = {
  author_transparency: 7,
  publisher_transparency: 8,
  evidence_density: 6,
  claim_specificity: 9,
  correction_behavior: 5,
  original_reporting: 8,
  sensationalism_score: 2,
  monetization_pressure: 1,
  reasoning: "Fixture quality",
};

function makeMockLlm(response, calls) {
  return {
    async generate(args) {
      calls.push(args);
      return structuredClone(response);
    },
  };
}

test("Phase 2 adds normalized final bearing while preserving legacy quote and quality fields", async () => {
  const calls = [];
  const result = await extractQuotesAndScoreQuality({
    claimText: "Exposure causes outcome Y",
    fullText: "A study found a causal mechanism linking exposure to outcome Y.",
    sourceTitle: "Mechanism study",
    url: "https://example.org/study",
    llm: makeMockLlm({
      quotes: [{
        quote: "A causal mechanism linked exposure to outcome Y.",
        stance: "support",
        summary: "Direct causal evidence.",
        location: { page: null, section: "Results" },
        bearing_score: 1.4,
        bearing_type: "direct",
        claim_component_addressed: "relation",
        causal_strength: "mechanistic",
        bearing_reason: "The passage directly addresses the claimed causal relationship.",
      }],
      quality,
    }, calls),
    enablePostScrapeBearing: true,
  });

  assert.equal(calls.length, 1, "bearing remains part of the existing single combined call");
  assert.match(calls[0].schemaHint, /bearing_score/);
  assert.match(calls[0].user, /Bearing is NOT source quality/);
  assert.match(calls[0].user, /article-level fact-check does not refute every embedded subclaim/i);
  assert.match(calls[0].user, /Skepticism, doubt, or criticism alone is not refutation/i);
  assert.match(calls[0].user, /different location, population, date, or dose is not automatically refutation/i);
  assert.match(calls[0].user, /whether X said Y \(attribution\) and whether Y is true/i);
  assert.deepEqual(
    {
      quote: result.quotes[0].quote,
      stance: result.quotes[0].stance,
      summary: result.quotes[0].summary,
      location: result.quotes[0].location,
    },
    {
      quote: "A causal mechanism linked exposure to outcome Y.",
      stance: "support",
      summary: "Direct causal evidence.",
      location: { page: null, section: "Results" },
    },
  );
  assert.equal(result.quotes[0].bearing_score, 1, "score is clamped to 0-1");
  assert.equal(result.quotes[0].bearing_type, "direct");
  assert.equal(result.quotes[0].claim_component_addressed, "relation");
  assert.equal(result.quotes[0].causal_strength, "mechanistic");
  assert.equal(result.documentBearingScore, 1);
  assert.equal(result.qualityScores.author_transparency, quality.author_transparency);
  assert.equal(result.qualityScores.reasoning, quality.reasoning);
  assert.ok(Number.isFinite(result.qualityScores.quality_score));
  assert.ok(Number.isFinite(result.qualityScores.risk_score));
});

test("Phase 2 flag off returns the legacy quote shape and old prompt contract", async () => {
  const calls = [];
  const result = await extractQuotesAndScoreQuality({
    claimText: "Claim",
    fullText: "Source text",
    llm: makeMockLlm({
      quotes: [{
        quote: "Source quote",
        stance: "nuance",
        summary: "Context",
        location: { page: null, section: "Body" },
        bearing_score: 0.9,
        bearing_type: "direct",
      }],
      quality,
    }, calls),
    enablePostScrapeBearing: false,
  });

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].schemaHint, /bearing_score/);
  assert.doesNotMatch(calls[0].user, /BEARING RULES/);
  assert.deepEqual(Object.keys(result.quotes[0]), ["quote", "stance", "summary", "location"]);
  assert.equal("documentBearingScore" in result, false);
});

test("invalid optional bearing fields normalize conservatively", async () => {
  const result = await extractQuotesAndScoreQuality({
    claimText: "Claim",
    fullText: "Text",
    llm: makeMockLlm({
      quotes: [{
        quote: "Quote",
        stance: "insufficient",
        bearing_score: "not-a-number",
        bearing_type: "authoritative",
        claim_component_addressed: "everything",
        causal_strength: "certain",
        bearing_reason: "r".repeat(1000),
      }],
      quality,
    }, []),
    enablePostScrapeBearing: true,
  });

  assert.equal(result.quotes[0].bearing_score, null);
  assert.equal(result.quotes[0].bearing_type, "none");
  assert.equal(result.quotes[0].claim_component_addressed, "none");
  assert.equal(result.quotes[0].causal_strength, "not_applicable");
  assert.ok(result.quotes[0].bearing_reason.length <= 500);
  assert.equal(result.documentBearingScore, null);
});

test("post-scrape quantitative guard corrects explicit 25 percent evidence to refute", async () => {
  const result = await extractQuotesAndScoreQuality({
    claimText: "More than half of all babies born with CHD will require surgery in order to survive.",
    fullText: "Approximately 25% of children born with a CHD will need surgery.",
    llm: makeMockLlm({
      quotes: [{
        quote: "Approximately 25% of children born with a CHD will need heart surgery in their first year of life to survive.",
        stance: "support",
        summary: "A significant percentage need surgery.",
        bearing_score: 0.8,
        bearing_type: "direct",
        claim_component_addressed: "object",
        causal_strength: "not_applicable",
        bearing_reason: "Many children need surgery.",
      }],
      quality,
    }, []),
    enablePostScrapeBearing: true,
  });

  assert.equal(result.quotes[0].stance, "refute");
  assert.equal(result.quotes[0].bearing_score, 0.8);
  assert.match(result.quotes[0].bearing_reason, /25%.*contradicts.*50%/);
});

test("post-scrape quantitative guard rejects a reversed surgery-age denominator", async () => {
  const result = await extractQuotesAndScoreQuality({
    claimText: "40% of children requiring cardiac surgery are under 1 year old.",
    fullText: "Of babies born with a heart defect, 25% need surgery within the first year.",
    llm: makeMockLlm({
      quotes: [{
        quote: "Of babies born with a heart defect, 25% need surgery within the first year.",
        stance: "support",
        summary: "Infants need surgery.",
        bearing_score: 0.8,
        bearing_type: "direct",
        claim_component_addressed: "whole_claim",
        causal_strength: "not_applicable",
        bearing_reason: "Mentions surgery and age.",
      }],
      quality,
    }, []),
    enablePostScrapeBearing: true,
  });

  assert.equal(result.quotes[0].stance, "insufficient");
  assert.equal(result.quotes[0].bearing_score, 0.2);
  assert.equal(result.quotes[0].bearing_type, "context");
  assert.match(result.quotes[0].bearing_reason, /denominator or outcome differs/);
});

test("post-scrape quantitative guard rejects an absolute count for a percentage claim", async () => {
  const result = await extractQuotesAndScoreQuality({
    claimText: "More than half of all babies born with CHD will require surgery in order to survive.",
    fullText: "Around 3,000 surgeries take place on babies under one year every year.",
    llm: makeMockLlm({
      quotes: [{
        quote: "Around 3,000 surgeries or catheter procedures take place on babies under one year of age every year.",
        stance: "support",
        summary: "This shows many babies receive surgery.",
        bearing_score: 0.8,
        bearing_type: "direct",
        claim_component_addressed: "object",
        causal_strength: "not_applicable",
        bearing_reason: "Large surgery count.",
      }],
      quality,
    }, []),
    enablePostScrapeBearing: true,
  });

  assert.equal(result.quotes[0].stance, "insufficient");
  assert.equal(result.quotes[0].bearing_score, 0.2);
  assert.equal(result.quotes[0].bearing_type, "context");
  assert.match(result.quotes[0].bearing_reason, /absolute count without a denominator/);
});

test("EvidenceEngine carries bearing additively and adjudication ignores it", async () => {
  const extractor = async () => ({
    quotes: [{
      quote: "Direct quote",
      stance: "support",
      summary: "Direct support",
      location: { page: null, section: "Results" },
      bearing_score: 0.82,
      bearing_type: "direct",
      claim_component_addressed: "whole_claim",
      causal_strength: "not_applicable",
      bearing_reason: "Tests the exact assertion.",
    }],
    qualityScores: { quality_tier: "mid" },
    documentBearingScore: 0.82,
  });
  const engine = new EvidenceEngine({
    fetcher: {
      async getText() {
        return { isProcessed: true, cleanText: "Source text long enough for extraction.", citationCount: 0 };
      },
    },
    extractQuotesAndScoreQuality: extractor,
  });
  const evidence = await engine.extractEvidence(
    { id: 77, text: "Exact task claim" },
    { id: "candidate", url: "https://example.org/evidence", title: "Evidence", domain: "example.org", score: 0.7 },
    { maxCharsPerDoc: 8000, maxEvidencePerDoc: 2 },
  );

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].bearingScore, 0.82);
  assert.equal(evidence[0].bearingType, "direct");
  assert.equal(evidence[0].bearingMethod, "post_scrape_llm_v1");

  const legacyEvidence = [{ ...evidence[0] }];
  delete legacyEvidence[0].bearingScore;
  delete legacyEvidence[0].bearingType;
  delete legacyEvidence[0].bearingReason;
  delete legacyEvidence[0].claimComponentAddressed;
  delete legacyEvidence[0].causalStrength;
  delete legacyEvidence[0].bearingMethod;

  assert.deepEqual(
    engine.adjudicate({ id: 77 }, evidence),
    engine.adjudicate({ id: 77 }, legacyEvidence),
    "Phase 2 bearing fields must not affect adjudication",
  );
});

test("post-scrape feature flag defaults on outside production and supports a kill switch", () => {
  assert.equal(isPostScrapeBearingEnabled({ NODE_ENV: "development" }), true);
  assert.equal(isPostScrapeBearingEnabled({ NODE_ENV: "production" }), false);
  assert.equal(isPostScrapeBearingEnabled({ NODE_ENV: "production", ENABLE_POST_SCRAPE_BEARING_SHADOW: "true" }), true);
  assert.equal(isPostScrapeBearingEnabled({ NODE_ENV: "development", ENABLE_POST_SCRAPE_BEARING_SHADOW: "false" }), false);
  assert.equal(normalizePostScrapeBearingScore(-3), 0);
  assert.equal(normalizePostScrapeBearingScore(3), 1);
  assert.equal(normalizePostScrapeBearingScore(undefined), null);
});

test("post-scrape structured logs bound claim, title, URL, quote, and reason", async () => {
  const originalLog = logger.log;
  const captured = [];
  logger.log = (...args) => captured.push(args.join(" "));
  const long = "z".repeat(5000);

  try {
    await extractQuotesAndScoreQuality({
      claimText: long,
      fullText: "Text",
      sourceTitle: long,
      url: `https://example.org/${long}`,
      llm: makeMockLlm({
        quotes: [{
          quote: long,
          stance: "support",
          bearing_score: 0.8,
          bearing_type: "direct",
          claim_component_addressed: "whole_claim",
          causal_strength: "not_applicable",
          bearing_reason: long,
        }],
        quality,
      }, []),
      enablePostScrapeBearing: true,
    });
  } finally {
    logger.log = originalLog;
  }

  const line = captured.find((entry) => entry.startsWith("[BEARING_POST_SCRAPE] "));
  assert.ok(line);
  const record = JSON.parse(line.slice("[BEARING_POST_SCRAPE] ".length));
  assert.ok(record.claimText.length <= 500);
  assert.ok(record.sourceTitle.length <= 500);
  assert.ok(record.url.length <= 2048);
  assert.ok(record.quotes[0].quote.length <= 1000);
  assert.ok(record.quotes[0].reason.length <= 500);
});
