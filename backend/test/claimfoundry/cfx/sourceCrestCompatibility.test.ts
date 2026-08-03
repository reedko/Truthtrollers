import assert from "node:assert/strict";
import test from "node:test";
import { ensureCfxSourceCrest as ensureCfxSourceCrestUntyped } from "../../../src/services/cfxSourceCrestCompatibility.js";

const ensureCfxSourceCrest = ensureCfxSourceCrestUntyped as any;

test("CFX SourceCrest runs production enrichment before the final stored-signal evaluation", async () => {
  const events:string[] = [];
  const row = {
    admiralty_evaluation_id:8,
    admiralty_code:"AØ",
    evaluation_status:"machine_suggested",
  };
  const result = await ensureCfxSourceCrest({
    query: async (sql:string, values:unknown[]) => {
      if (sql.includes("FROM content c")) {
        events.push("identity");
        assert.deepEqual(values, [20]);
        return [{
          publisher_id:9,
          publisher_name:"Example Journal",
          source_url:"https://example.test/article",
        }];
      }
      if (sql.includes("FROM admiralty_evaluations")) {
        events.push("reload-result");
        assert.deepEqual(values, [20]);
        return [row];
      }
      throw new Error(`unexpected SQL ${sql}`);
    },
    referenceContentId:20,
    publisherId:99,
    publisherName:"Non-canonical caller hint",
    async enricher(input:any) {
      events.push("enrich");
      assert.equal(input.publisherId, 9);
      assert.equal(input.publisherName, "Example Journal");
      assert.equal(input.sourceUrl, "https://example.test/article");
      assert.equal(input.force, false);
      assert.equal(input.context, "reference_source");
      return {status:"enriched"};
    },
    async evaluator(_query:unknown,publisherId:number,publisherName:string) {
      events.push("evaluate");
      assert.equal(publisherId, 9);
      assert.equal(publisherName, "Example Journal");
      return {20:"AØ"};
    },
  });
  assert.deepEqual(events, ["identity", "enrich", "evaluate", "reload-result"]);
  assert.equal(result.status, "production_enriched_and_evaluated");
  assert.equal(result.completed, true);
  assert.equal(result.row, row);
  assert.deepEqual(result.enrichment, {status:"enriched"});
  assert.deepEqual(result.updates, {20:"AØ"});
});

test("CFX SourceCrest reports ØØ as attempted but incomplete after the full lifecycle", async () => {
  let enrichmentCalls = 0;
  let evaluatorCalls = 0;
  const result = await ensureCfxSourceCrest({
    query: async (sql:string) => {
      if (sql.includes("FROM content c")) return [{
        publisher_id:9,
        publisher_name:"Example Journal",
        source_url:"https://example.test/article",
      }];
      if (sql.includes("FROM admiralty_evaluations")) return [{
        admiralty_evaluation_id:8,
        admiralty_code:"ØØ",
        evaluation_status:"machine_suggested",
      }];
      throw new Error(`unexpected SQL ${sql}`);
    },
    referenceContentId:20,
    async enricher() { enrichmentCalls += 1; return {status:"insufficient_data"}; },
    async evaluator() { evaluatorCalls += 1; return {20:"ØØ"}; },
  });
  assert.equal(enrichmentCalls, 1);
  assert.equal(evaluatorCalls, 1);
  assert.equal(result.status, "insufficient_data");
  assert.equal(result.completed, false);
  assert.equal(result.row.admiralty_code, "ØØ");
});

test("CFX SourceCrest does not enrich or evaluate without a resolved publisher identity", async () => {
  let enrichmentCalls = 0;
  let evaluatorCalls = 0;
  const result = await ensureCfxSourceCrest({
    query: async (sql:string) => {
      assert.match(sql, /FROM content c/u);
      return [{publisher_id:null,publisher_name:null,source_url:"https://example.test/article"}];
    },
    referenceContentId:20,
    async enricher() { enrichmentCalls += 1; },
    async evaluator() { evaluatorCalls += 1; },
  });
  assert.equal(result.status, "identity_pending");
  assert.equal(result.completed, false);
  assert.equal(enrichmentCalls, 0);
  assert.equal(evaluatorCalls, 0);
});
