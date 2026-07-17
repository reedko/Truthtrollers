import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOfflinePlanning } from "../../src/evidence-run/runOfflinePlanning.js";
import { ER1_CF1_FIXTURES } from "./fixtures/manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const f01 = path.join(root, ER1_CF1_FIXTURES[0].relativePath);

test("ER1-1 builds selected target, identity, and deterministic lane artifacts offline", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "er1-offline-"));
  const options = { profile: "standard",
    retrievalStrategy: { mode: "role_diverse_falsifiability" } };
  const first = await runOfflinePlanning({ packagePath: f01, outputDir, options });
  assert.equal(first.portfolio.taskCount, 8);
  assert.equal(first.portfolio.targetCount, 8);
  assert.ok(first.identityRegistry.entries.some((x) => x.identifiers.doi.includes("10.1542/peds.113.2.259")));
  assert.ok(first.lanePlan.lanes.some((x) => x.laneType === "exact_doi"));
  const targetLanes = first.lanePlan.lanes.filter((x) => x.queryClass === "target_evidence");
  assert.ok(targetLanes.every((x) => x.evidenceRole && !x.bearingGoal));
  assert.ok(targetLanes.some((x) => x.evidenceRole === "reanalysis_or_correction"));
  assert.deepEqual(first.trace.prohibitedOperations, {
    providerCalls: 0, searchCalls: 0, resolverCalls: 0, scraperCalls: 0,
    modelCalls: 0, databaseCalls: 0, migrations: 0,
  });
  assert.equal(first.state.usage.modelCalls, 0);
  assert.equal(first.state.usage.providerCalls, 0);
  assert.ok(first.manifest.artifacts.some((x) => x.relativePath === "target-portfolio.json"));
  assert.match(await readFile(path.join(outputDir, "offline-summary.md"), "utf8"), /No provider, search/);

  const secondDir = await mkdtemp(path.join(os.tmpdir(), "er1-offline-"));
  const second = await runOfflinePlanning({ packagePath: f01, outputDir: secondDir, options });
  assert.equal(first.runId, second.runId);
  assert.deepEqual(first.portfolio, second.portfolio);
  assert.deepEqual(first.identityRegistry, second.identityRegistry);
  assert.deepEqual(first.lanePlan, second.lanePlan);
});
