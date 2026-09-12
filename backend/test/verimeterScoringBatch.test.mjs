import assert from "node:assert/strict";
import test from "node:test";

import { calculateUserContentScore } from "../src/services/verimeterScoringService.js";

test("content scoring batches reviewer reputation lookups", async () => {
  const calls = [];
  const links = Array.from({ length: 100 }, (_, index) => ({
    claim_link_id: index + 1,
    target_claim_id: index % 4 + 1,
    support_level: index % 2 === 0 ? 0.8 : -0.4,
    score_transform: "normal",
    user_id: index % 3 + 1,
    source_admiralty_code: "B2",
    source_publisher_id: null,
    source_content_id: null,
  }));

  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("verimeter_weighting_config")) return [];
    if (sql.includes("FROM claim_links cl")) return links;
    if (sql.includes("FROM user_reputation WHERE user_id IN")) {
      return [
        { user_id: 1, veracity_rating: 70 },
        { user_id: 2, veracity_rating: 60 },
        { user_id: 3, veracity_rating: 50 },
      ];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const result = await calculateUserContentScore(query, 42, null);

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].params, [[1, 2, 3]]);
  assert.equal(result.link_count, 100);
  assert.ok(Number.isFinite(result.verimeter_score));
});
