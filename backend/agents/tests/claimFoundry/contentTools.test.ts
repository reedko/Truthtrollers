import assert from "node:assert/strict";
import test from "node:test";
import { document, harness } from "./fixtures.js";

test("content tools are authorized, ordered, bounded, and persisted", async () => {
  const { tools, persistence } = await harness();
  const map = await tools.get_content_map({ idempotencyKey: "map-key-1", maxBlocks: 20 });
  assert.ok(map.result.blocks.length > 0);
  const ids = document.sourceUnits.slice(0, 2).map((unit: any) => unit.unitId).reverse();
  const read = await tools.read_source_units({ idempotencyKey: "read-key-1", unitIds: ids, adjacent: 0, maxTextChars: 1000 });
  assert.deepEqual(read.result.units.map((unit: any) => unit.order), [...read.result.units.map((unit: any) => unit.order)].sort((a, b) => a - b));
  await assert.rejects(() => tools.read_source_units({ idempotencyKey: "read-bad-1", unitIds: ["U9999"], adjacent: 0, maxTextChars: 1000 }), /Unknown source unit/);
  const found = await tools.find_source_units({ idempotencyKey: "find-key-1", query: "rainfall 2025", mode: "normalized_tokens", maxResults: 1 });
  assert.equal(found.result.matches.length, 1);
  assert.ok(found.result.matches[0]!.score > 0);
  const events = await persistence.events("run-1");
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3, 4]);
  assert.equal(events[2]!.status, "failed");
  assert.deepEqual((await persistence.load("run-1"))!.inspectedUnitIds,
    read.result.units.map((unit: any) => unit.unitId));
});

test("idempotent replay returns the same result without another event", async () => {
  const { tools, persistence } = await harness();
  const input = { idempotencyKey: "find-replay", query: "rainfall", mode: "literal" as const, maxResults: 5 };
  const first = await tools.find_source_units(input);
  const replay = await tools.find_source_units(input);
  assert.equal(first.replayed, false); assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
  assert.equal((await persistence.events("run-1")).length, 1);
  await assert.rejects(() => tools.find_source_units({ ...input, query: "study" }), /Idempotency key arguments differ/);
});
