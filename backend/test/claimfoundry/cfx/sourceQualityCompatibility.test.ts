import assert from "node:assert/strict";
import test from "node:test";
import { SourceQualityScorer } from "../../../src/core/sourceQualityScorer.js";
import { ensureCfxSourceQuality as ensureCfxSourceQualityUntyped } from "../../../src/services/cfxSourceQualityCompatibility.js";

const ensureCfxSourceQuality = ensureCfxSourceQualityUntyped as any;

test("CFX source quality preserves an existing assessment without rescoring", async () => {
  let scorerCalls = 0;
  const existing = {
    source_quality_id: 4, content_id: 20, quality_score: 8.2,
    risk_score: 1.5, quality_tier: "high", scored_by: "user",
    scoring_model: "manual",
  };
  const result = await ensureCfxSourceQuality({
    query: async () => [existing],
    referenceContentId: 20,
    contentText: "Text",
    scorer: {
      async scoreSource() { scorerCalls += 1; return {}; },
      async saveScores() { scorerCalls += 1; },
    } as any,
  });
  assert.equal(result.status, "preserved_existing");
  assert.equal(result.row, existing);
  assert.equal(scorerCalls, 0);
});

test("CFX source quality reuses the scorer once and marks its compatibility provenance", async () => {
  const calls: Array<{sql:string; values:unknown[]}> = [];
  let scoreCalls = 0;
  const scores = {
    author_transparency:5,publisher_transparency:6,evidence_density:7,
    claim_specificity:8,correction_behavior:4,domain_reputation:0,
    original_reporting:6,sensationalism_score:2,monetization_pressure:1,
    quality_score:6.4,risk_score:2.1,quality_tier:"mid",
  };
  const result = await ensureCfxSourceQuality({
    query: async (sql:string, values:unknown[] = []) => {
      calls.push({sql, values});
      if (sql.includes("FROM source_quality_scores")) return [];
      if (sql.startsWith("INSERT IGNORE INTO source_quality_scores")) return {affectedRows:1};
      throw new Error(`unexpected SQL ${sql}`);
    },
    referenceContentId: 20,
    contentText: "A measured source with [1] and 12%.",
    url: "https://example.test/study",
    scorer: {
      async scoreSource(input:unknown) { scoreCalls += 1; assert.ok(input); return scores; },
    } as any,
  });
  assert.equal(result.status, "created");
  assert.equal(scoreCalls, 1);
  assert.ok(calls.some(({sql}) => sql.includes("heuristic:cfx-compatibility-v1")));
  const insert = calls.find(({sql}) => sql.startsWith("INSERT IGNORE INTO source_quality_scores"));
  assert.equal(insert?.values[6], 0);
});

test("legacy source-quality persistence preserves a measured domain reputation of zero", async () => {
  let parameters: unknown[] = [];
  const scorer = new (SourceQualityScorer as any)(null, async (_sql:string, values:unknown[]) => {
    parameters = values;
    return {affectedRows:1};
  });
  await scorer.saveScores(20, {
    author_transparency: 1,
    publisher_transparency: 2,
    evidence_density: 3,
    claim_specificity: 4,
    correction_behavior: 5,
    domain_reputation: 0,
    original_reporting: 6,
    sensationalism_score: 7,
    monetization_pressure: 8,
    quality_score: 3.2,
    risk_score: 7.4,
    quality_tier: "unreliable",
  });
  assert.equal(parameters[6], 0);
});
