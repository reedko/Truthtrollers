import test from "node:test";
import assert from "node:assert/strict";
import { withTransaction } from "../../src/storage/dbTransaction.js";

function fakePool({ failCommit = false } = {}) {
  const events = [];
  const connection = {
    beginTransaction(callback) { events.push("begin"); callback(null); },
    query(sql, values, callback) { events.push([sql, values]); callback(null, [{ ok: true }]); },
    commit(callback) { events.push("commit"); callback(failCommit ? new Error("commit failed") : null); },
    rollback(callback) { events.push("rollback"); callback(null); },
    release() { events.push("release"); },
  };
  return { events, getConnection(callback) { callback(null, connection); } };
}

test("transaction helper binds query, commits, and releases", async () => {
  const pool = fakePool();
  const value = await withTransaction(async ({ query }) => {
    const rows = await query("SELECT ?", [7]);
    return rows[0].ok;
  }, { pool });
  assert.equal(value, true);
  assert.deepEqual(pool.events.map((event) => Array.isArray(event) ? event[0] : event),
    ["begin", "SELECT ?", "commit", "release"]);
});

test("transaction helper rolls back and releases on work or commit failure", async () => {
  const workPool = fakePool();
  await assert.rejects(withTransaction(async () => { throw new Error("work failed"); },
    { pool: workPool }), /work failed/);
  assert.deepEqual(workPool.events, ["begin", "rollback", "release"]);
  const commitPool = fakePool({ failCommit: true });
  await assert.rejects(withTransaction(async () => true, { pool: commitPool }), /commit failed/);
  assert.deepEqual(commitPool.events, ["begin", "commit", "rollback", "release"]);
});
