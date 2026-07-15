import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("activation migration enforces one active binding per consumer and content", async () => {
  const url = new URL("../../migrations/2026-07-13-03-claim-foundry-activation.sql", import.meta.url);
  const sql = await readFile(url, "utf8");
  assert.match(sql, /is_active_projection/);
  assert.match(sql, /CASE WHEN is_active_projection = 1 THEN content_id ELSE NULL END/);
  assert.match(sql, /UNIQUE KEY uq_cf1_active_content\s*\(consumer_key, active_content_id\)/);
  assert.doesNotMatch(sql, /DELETE|DROP TABLE|DROP COLUMN/i);
});
