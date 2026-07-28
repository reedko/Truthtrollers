import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { MySqlClaimFoundryPersistence, hashValue } from "../../claimFoundry/claimFoundryPersistence.js";
import { createRunState } from "../../claimFoundry/claimFoundryState.js";
import { createClaimFoundryTools } from "../../claimFoundry/claimFoundryTools.js";
import { deriveContentRegions } from "../../claimFoundry/claimFoundryCoverage.js";
import {
  createWholeArticleClaimFoundryTools,
} from "../../claimFoundry/claimFoundryWholeArticleTools.js";
import { claim, document, manifestHash, pkg } from "../claimFoundry/fixtures.js";
import { readCf6MySqlTestEnvironment } from "../claimFoundry/mysqlEnvironment.js";

const config = readCf6MySqlTestEnvironment();
const pool = mysql.createPool({ ...config, connectionLimit: 6 });
const migrationPath = fileURLToPath(new URL("../../../migrations/2026-07-27-01-cf6-agent-state.sql", import.meta.url));
const expectedTables = ["cf6_claim_foundry_final_packages", "cf6_claim_foundry_model_requests",
  "cf6_claim_foundry_run_states", "cf6_claim_foundry_tool_events"];
const expectedTriggers = ["cf6_final_packages_immutable", "cf6_final_packages_no_delete",
  "cf6_model_requests_no_delete", "cf6_model_requests_no_update",
  "cf6_tool_events_no_delete", "cf6_tool_events_no_update"];

function statements(sql: string) {
  const output: string[] = []; let delimiter = ";"; let buffer = "";
  for (const line of sql.split(/\r?\n/)) {
    const directive = line.trim().match(/^DELIMITER\s+(.+)$/i);
    if (directive) { delimiter = directive[1]!; continue; }
    buffer += `${line}\n`;
    if (buffer.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trim().slice(0, -delimiter.length).trim();
      if (statement) output.push(statement); buffer = "";
    }
  }
  if (buffer.trim()) output.push(buffer.trim());
  return output;
}

async function query(connection: Pool | PoolConnection, sql: string, values: unknown[] = []) {
  const [rows] = await connection.query(sql, values);
  return rows as any;
}

async function applyMigration() {
  const connection = await pool.getConnection();
  try { for (const statement of statements(readFileSync(migrationPath, "utf8"))) await query(connection, statement); }
  finally { connection.release(); }
}

async function cleanup() {
  for (const trigger of [...expectedTriggers, "cf6_test_force_rollback"]) {
    await query(pool, `DROP TRIGGER IF EXISTS \`${trigger}\``);
  }
  await query(pool, "DROP TABLE IF EXISTS cf6_claim_foundry_final_packages");
  await query(pool, "DROP TABLE IF EXISTS cf6_claim_foundry_model_requests");
  await query(pool, "DROP TABLE IF EXISTS cf6_claim_foundry_tool_events");
  await query(pool, "DROP TABLE IF EXISTS cf6_claim_foundry_run_states");
}

function transactionPort() {
  return {
    async transaction<T>(work: (q: (sql: string, values?: unknown[]) => Promise<any[]>) => Promise<T>) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work((sql, values = []) => query(connection, sql, values));
        await connection.commit(); return result;
      } catch (error) {
        await connection.rollback(); throw error;
      } finally { connection.release(); }
    },
  };
}

function state(runId: string) {
  return createRunState({
    runId, contentId: "content-1", contentHash: document.contentHash,
    sourceUnitManifestHash: manifestHash,
    budgets: { maxToolCalls: 100, maxUnitsRead: 100, maxRepairRounds: 2 },
    traceId: "trace-mysql", versions: {
      instruction: "test", toolSchema: "cf6.tools.v1", model: "none", code: "mysql-test",
    },
  });
}

test("real MySQL durability, immutability, rollback, concurrency, and cleanup", async t => {
  t.after(async () => {
    try {
      await cleanup();
      const remaining = await query(pool, `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=? AND TABLE_NAME LIKE 'cf6_claim_foundry_%'`, [config.database]);
      assert.equal(remaining.length, 0);
    } finally { await pool.end(); }
  });
  const existing = (await query(pool, `SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ?`, [config.database])).map((row: any) => row.TABLE_NAME);
  assert.ok(existing.every((name: string) => expectedTables.includes(name)),
    `Disposable database contains unrelated tables: ${existing.join(", ")}`);
  await cleanup(); await applyMigration(); await applyMigration();

  await t.test("migration objects exist and second application is safe", async () => {
    const tables = (await query(pool, `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME`, [config.database])).map((row: any) => row.TABLE_NAME);
    const triggers = (await query(pool, `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA=? ORDER BY TRIGGER_NAME`, [config.database])).map((row: any) => row.TRIGGER_NAME);
    assert.deepEqual(tables, expectedTables); assert.deepEqual(triggers, expectedTriggers);
  });

  const adapter = new MySqlClaimFoundryPersistence(transactionPort());
  const runId = `mysql-recovery-${Date.now()}`; const initial = state(runId);
  await adapter.create(initial);

  await t.test("state survives fresh adapter context exactly", async () => {
    const fresh = new MySqlClaimFoundryPersistence(transactionPort());
    assert.deepEqual(await fresh.load(runId), initial);
    const row = (await query(pool, "SELECT state_version, status FROM cf6_claim_foundry_run_states WHERE run_id=?", [runId]))[0];
    assert.equal(Number(row.state_version), 1); assert.equal(row.status, "created");
  });

  await t.test("model request accounting survives a fresh adapter and is append-only", async () => {
    const record = {
      runId, turn: 1, responseId: "resp-test-1", requestId: "req-test-1",
      inputTokens: 120, cachedInputTokens: 80, uncachedInputTokens: 40,
      outputTokens: 12, totalTokens: 132, model: "test-model",
      toolsExposed: ["get_content_map", "read_source_units"],
      toolSelected: "get_content_map", modelVisibleInputHash: "a".repeat(64),
      estimatedInputTokens: 115,
      payloadClassTokens: { instructions: 10, tools: 60, input: 45 },
      createdAt: new Date().toISOString(),
    };
    await adapter.recordModelRequest(record);
    assert.deepEqual(await new MySqlClaimFoundryPersistence(transactionPort()).modelRequests(runId), [record]);
    for (const sql of [
      "UPDATE cf6_claim_foundry_model_requests SET input_tokens=999 WHERE run_id=?",
      "DELETE FROM cf6_claim_foundry_model_requests WHERE run_id=?",
    ]) {
      await assert.rejects(query(pool, sql, [runId]), /append-only/);
    }
  });

  await adapter.mutate(runId, "probe_one", "mysql-idem-1", { value: 1 }, current => ({
    state: { ...current, counters: { ...current.counters, toolCalls: current.counters.toolCalls + 1 } },
    result: { ok: 1 },
  }));
  const replay = await adapter.mutate(runId, "probe_one", "mysql-idem-1", { value: 1 }, () => {
    throw new Error("must not execute");
  });
  assert.equal(replay.replayed, true);

  await t.test("events reload and append-only triggers reject update/delete", async () => {
    const events = await new MySqlClaimFoundryPersistence(transactionPort()).events(runId);
    assert.equal(events.length, 1); assert.equal(events[0]!.sequence, 1);
    for (const [verb, sql] of [
      ["update", "UPDATE cf6_claim_foundry_tool_events SET duration_ms=99 WHERE run_id=?"],
      ["delete", "DELETE FROM cf6_claim_foundry_tool_events WHERE run_id=?"],
    ]) {
      await assert.rejects(query(pool, sql, [runId]), error => {
        console.log(JSON.stringify({ trigger: `event_${verb}`, code: (error as any).code, message: (error as Error).message }));
        return /append-only/.test((error as Error).message);
      });
    }
  });

  await t.test("actual adapter transaction rolls state back when event insert fails", async () => {
    await query(pool, `CREATE TRIGGER cf6_test_force_rollback BEFORE INSERT ON cf6_claim_foundry_tool_events
      FOR EACH ROW BEGIN IF NEW.tool_name='force_rollback' THEN SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='CF6 forced rollback'; END IF; END`);
    const before = await adapter.load(runId);
    await assert.rejects(adapter.mutate(runId, "force_rollback", "rollback-key", {}, current => ({
      state: { ...current, counters: { ...current.counters, toolCalls: 77 } }, result: { impossible: true },
    })), /forced rollback/);
    assert.deepEqual(await adapter.load(runId), before);
    assert.equal((await query(pool, "SELECT COUNT(*) AS n FROM cf6_claim_foundry_tool_events WHERE run_id=? AND tool_name='force_rollback'", [runId]))[0].n, 0);
    await query(pool, "DROP TRIGGER cf6_test_force_rollback");
  });

  await t.test("concurrent writes serialize and duplicate idempotency converges", async () => {
    const concurrentId = `mysql-concurrent-${Date.now()}`; await adapter.create(state(concurrentId));
    const change = (key: string) => adapter.mutate(concurrentId, "concurrent_probe", key, { key }, current => ({
      state: { ...current, counters: { ...current.counters, toolCalls: current.counters.toolCalls + 1 } }, result: { key },
    }));
    await Promise.all([change("key-a"), change("key-b")]);
    const duplicate = () => adapter.mutate(concurrentId, "duplicate_probe", "same-key", { same: true }, current => ({
      state: { ...current, counters: { ...current.counters, toolCalls: current.counters.toolCalls + 1 } }, result: { same: true },
    }));
    await Promise.all([duplicate(), duplicate()]);
    const events = await adapter.events(concurrentId);
    assert.deepEqual(events.map(event => event.sequence), [1, 2, 3]);
    assert.equal((await adapter.load(concurrentId))!.counters.toolCalls, 3);
  });

  await t.test("final package and terminal state persist atomically and are immutable", async () => {
    const finalId = `mysql-final-${Date.now()}`; await adapter.create(state(finalId));
    const tools = createClaimFoundryTools({ runId: finalId, contentId: "content-1",
      articleDocument: document, persistence: adapter });
    await tools.save_working_package({ idempotencyKey: "mysql-save", package: pkg(finalId) });
    await tools.validate_working_package({ idempotencyKey: "mysql-validate" });
    const final = await tools.finalize_claim_package({ idempotencyKey: "mysql-finalize",
      mode: "complete", inspectedContextUnitIds: [] });
    const replayed = await tools.finalize_claim_package({ idempotencyKey: "mysql-finalize",
      mode: "complete", inspectedContextUnitIds: [] });
    assert.equal(replayed.replayed, true); assert.equal(replayed.result.packageId, final.result.packageId);
    assert.equal((await adapter.load(finalId))!.status, "completed");
    assert.equal((await adapter.loadFinalPackage(final.result.packageId!))!.packageHash, final.result.packageHash);
    for (const [verb, sql] of [
      ["update", "UPDATE cf6_claim_foundry_final_packages SET package_hash=? WHERE package_id=?"],
      ["delete", "DELETE FROM cf6_claim_foundry_final_packages WHERE package_id=?"],
    ]) {
      const values = verb === "update" ? ["0".repeat(64), final.result.packageId] : [final.result.packageId];
      await assert.rejects(query(pool, sql, values), error => {
        console.log(JSON.stringify({ trigger: `package_${verb}`, code: (error as any).code, message: (error as Error).message }));
        return /immutable/.test((error as Error).message);
      });
    }
    await assert.rejects(() => tools.find_source_units({ idempotencyKey: "terminal-mutation",
      query: "rainfall", maxResults: 1 }), /Terminal runs/);
  });

  await t.test("whole-article final package persists atomically without a tool-result echo", async () => {
    const wholeId = `mysql-whole-final-${Date.now()}`;
    await adapter.create({
      ...state(wholeId),
      contentRegions: deriveContentRegions(document),
    });
    const tools = createWholeArticleClaimFoundryTools({
      runId: wholeId,
      contentId: "content-1",
      articleDocument: document,
      persistence: adapter,
    });
    const sourceUnitId = document.sourceUnits[1]!.unitId;
    const updated = await tools.update_working_package({
      idempotencyKey: "mysql-whole-update",
      expectedPackageRevision: 0,
      setTheses: [{
        thesisId: "T1",
        statement: "The article reports a quantified rainfall increase.",
        groundingUnitIds: [sourceUnitId],
      }],
      upsertClaims: [{
        ...claim("C1", sourceUnitId),
        thesisIds: ["T1"],
        thesisEffect: "Provides the central quantified representation.",
      }],
    });
    const finalized = await tools.finalize_working_package({
      idempotencyKey: "mysql-whole-finalize",
      expectedPackageRevision: 1,
      expectedPackageHash: updated.result.packageHash,
      inspectionId: "I-NO-SEPARATE-MYSQL-INSPECTION",
    });
    assert.equal("finalPackage" in finalized.result, false);
    const stored = await new MySqlClaimFoundryPersistence(transactionPort())
      .loadWholeArticleFinalPackage(finalized.result.finalPackageId);
    assert.equal(stored?.status, "final");
    assert.equal(stored?.packageHash, finalized.result.finalPackageHash);
    assert.equal(stored?.latestInspection?.deterministicClean, true);
    assert.deepEqual(
      (await adapter.events(wholeId)).map(event => event.toolName),
      ["update_working_package", "finalize_working_package"],
    );
  });

  await t.test("blocked whole-article finalization atomically persists its current inspection", async () => {
    const wholeId = `mysql-whole-blocked-${Date.now()}`;
    await adapter.create({
      ...state(wholeId),
      contentRegions: deriveContentRegions(document),
    });
    const tools = createWholeArticleClaimFoundryTools({
      runId: wholeId,
      contentId: "content-1",
      articleDocument: document,
      persistence: adapter,
    });
    const sourceUnitId = document.sourceUnits[1]!.unitId;
    const updated = await tools.update_working_package({
      idempotencyKey: "mysql-whole-blocked-update",
      expectedPackageRevision: 0,
      setTheses: [{
        thesisId: "T1",
        statement: "The package intentionally remains incomplete.",
        groundingUnitIds: [sourceUnitId],
      }],
    });
    await assert.rejects(
      tools.finalize_working_package({
        idempotencyKey: "mysql-whole-blocked-finalize",
        expectedPackageRevision: updated.result.packageRevision,
        expectedPackageHash: updated.result.packageHash,
        inspectionId: "I-NO-SEPARATE-BLOCKED-INSPECTION",
      }),
      /DETERMINISTIC_DEFECTS_REMAIN/,
    );

    const persisted = await new MySqlClaimFoundryPersistence(transactionPort())
      .load(wholeId);
    assert.equal(persisted?.status, "validating");
    assert.equal(
      persisted?.wholeArticleWorkingPackage?.latestInspection?.packageHash,
      updated.result.packageHash,
    );
    assert.equal(
      persisted?.wholeArticleWorkingPackage?.latestInspection
        ?.deterministicClean,
      false,
    );
    assert.equal(persisted?.finalPackageId, null);
    const events = await adapter.events(wholeId);
    assert.deepEqual(
      events.map(event => [event.toolName, event.status]),
      [
        ["update_working_package", "completed"],
        ["finalize_working_package", "failed"],
      ],
    );
    assert.notEqual(events[1]?.beforeStateHash, events[1]?.afterStateHash);
    const finalRows = await query(
      pool,
      "SELECT COUNT(*) AS n FROM cf6_claim_foundry_final_packages WHERE run_id=?",
      [wholeId],
    );
    assert.equal(Number(finalRows[0].n), 0);
  });

});
