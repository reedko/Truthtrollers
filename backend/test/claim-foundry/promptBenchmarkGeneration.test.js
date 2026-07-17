import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { loadBenchmarkConfig, parseFixtureRepeats, readGenerationFile,
  resolveFixtureSelection, sha256 } from "./prompt-benchmark/benchmarkConfig.js";
import { finalizeManifest, runCall1Generation, runFullGeneration }
  from "./prompt-benchmark/generationRun.js";
import { createArticleAndBlocks, createSelectedEnrichmentOutput,
  createSemanticInventoryOutput } from "./fixtures/packages.js";

function runner(calls = []) {
  return createCf1ModelRunner({ transport: { invoke: async (request) => {
    calls.push(request);
    return { output: request.usageContext.stage === "semantic_inventory"
      ? createSemanticInventoryOutput() : createSelectedEnrichmentOutput(), model: "fake",
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } };
  } } });
}

async function scratchBenchmark(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cf1pb-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { article } = createArticleAndBlocks();
  const fixturesRoot = path.join(dir, "fixtures");
  await mkdir(path.join(fixturesRoot, "CF1-F98"), { recursive: true });
  const articleBody = JSON.stringify({ title: article.title, text: article.text });
  await writeFile(path.join(fixturesRoot, "CF1-F98", "article.json"), articleBody);
  const config = {
    schemaVersion: "cf1.benchmarkConfig.v1", benchmarkId: "cf1pb-test", approved: false,
    seed: "seed-1", model: "fake", temperature: 0, timeoutMs: 1_000,
    budgetLimits: { maxTotalTokens: 20_000, maxOutputTokensPerCall: 3_000, maxDurationMs: 30_000 },
    blockOptions: { targetMinChars: 1, targetMaxChars: 70, hardMaxChars: 100 },
    modelContextTokens: 100_000, allowRepair: false,
    approvedFixtures: [{ fixtureId: "CF1-F98", class: "short_factual_event",
      articleSha256: sha256(articleBody) }],
    battery: ["CF1-F98"], repeats: { default: 1, perFixture: {} },
  };
  await mkdir(path.join(dir, "inputs"), { recursive: true });
  await writeFile(path.join(dir, "inputs", "benchmark-config.json"), JSON.stringify(config));
  return { dir, fixturesRoot, config };
}

test("fixture selection fails closed: no default, unapproved IDs, stale hashes, flag conflicts", async (t) => {
  const { dir, fixturesRoot } = await scratchBenchmark(t);
  const config = loadBenchmarkConfig(dir);
  assert.throws(() => resolveFixtureSelection({ config, fixturesRoot }),
    (error) => error.code === "CF1_BENCHMARK_CONFIG_INVALID", "no implicit default");
  assert.throws(() => resolveFixtureSelection({ config, fixtures: ["CF1-F09"], fixturesRoot }),
    (error) => error.code === "CF1_BENCHMARK_CONFIG_INVALID", "unapproved fixture rejected");
  assert.throws(() => resolveFixtureSelection({ config, fixtures: ["CF1-F98"],
    useBattery: true, fixturesRoot }),
  (error) => error.code === "CF1_BENCHMARK_CONFIG_INVALID", "--fixture with --battery rejected");
  const selected = resolveFixtureSelection({ config, useBattery: true, fixturesRoot });
  assert.deepEqual(selected.map((item) => item.fixtureId), ["CF1-F98"]);
  await writeFile(path.join(fixturesRoot, "CF1-F98", "article.json"), "{\"title\":\"t\",\"text\":\"x\"}");
  assert.throws(() => resolveFixtureSelection({ config, useBattery: true, fixturesRoot }),
    (error) => error.code === "CF1_BENCHMARK_CONFIG_INVALID", "frozen hash mismatch rejected");
  assert.throws(() => parseFixtureRepeats(["CF1-F98=x"]),
    (error) => error.code === "CF1_BENCHMARK_CONFIG_INVALID");
});

test("generation cannot read evaluation material", () => {
  for (const forbidden of ["backend/test/claim-foundry/fixtures/CF1-F01/expectations.json",
    "backend/test/claim-foundry/prompt-evaluation-keys/CF1-F01.json",
    "artifacts/x/private/producer-key.json", "artifacts/x/scores/completed.json"]) {
    assert.throws(() => readGenerationFile(forbidden),
      (error) => error.code === "CF1_BENCHMARK_EVALUATION_ACCESS", forbidden);
  }
});

test("generation modules have no import path to evaluation modules", async () => {
  const roots = ["prompt-benchmark/benchmarkConfig.js", "prompt-benchmark/generationRun.js",
    "prompt-benchmark/promptSets/index.js"];
  const seen = new Set();
  const queue = roots.map((rel) => path.join(TEST_DIR, rel));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const content = await readFile(file, "utf8");
    const specifiers = [...content.matchAll(/(?:from|import\()\s*"([^"]+)"/g)]
      .map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.doesNotMatch(specifier, /evaluationKeys|blindPackets|renderReview|evaluation-keys/,
        `${file} must not import evaluation modules (${specifier})`);
      if (specifier.startsWith(".")) queue.push(path.resolve(path.dirname(file), specifier));
    }
  }
  assert.ok(seen.size >= 3);
});

test("call2 corpus round-trip: materialize from a run, freeze, replay through an arm", async (t) => {
  const { buildCall2Corpus } = await import("./prompt-benchmark/call2Corpus.js");
  const { runCall2Generation } = await import("./prompt-benchmark/generationRun.js");
  const { dir, fixturesRoot } = await scratchBenchmark(t);
  const config = loadBenchmarkConfig(dir);
  const [fixture] = resolveFixtureSelection({ config, useBattery: true, fixturesRoot });
  const full = await runFullGeneration({ config, benchmarkDir: dir, phase: "corpus-source",
    profileId: "set-control-current-v1", fixture, repeat: 1, seed: config.seed,
    modelRunner: runner() });
  assert.equal(full.status, "completed");
  const runSubdirs = (await readdir(full.dir)).filter((name) => name.startsWith("cf1run_"));
  assert.equal(runSubdirs.length, 1);
  const sourceRunDir = path.join(full.dir, runSubdirs[0]);
  const manifest = buildCall2Corpus({ benchmarkDir: dir, sourceRunDirs: [sourceRunDir],
    blockOptions: config.blockOptions });
  assert.equal(manifest.packets.length, 1);
  assert.equal(manifest.packets[0].claimCount, 1);
  assert.throws(() => buildCall2Corpus({ benchmarkDir: dir, sourceRunDirs: [sourceRunDir] }),
    (error) => error.code === "CF1_CALL2_CORPUS_INVALID", "corpus is frozen after first build");
  const replay = await runCall2Generation({ config, benchmarkDir: dir, phase: "stage3-mock",
    profileId: "set-b-fidelity-ladder-v1", packetId: "pkt-001", repeat: 1,
    seed: config.seed, modelRunner: runner() });
  assert.equal(replay.status, "completed");
  const files = await readdir(replay.dir);
  for (const name of ["selected-enrichment.model-raw.json", "selected-enrichment.verified.json",
    "prompt-fingerprints.json"]) assert.ok(files.includes(name), name);
});

test("mocked call1 + full generation produce immutable artifacts and a manifest", async (t) => {
  const { dir, fixturesRoot } = await scratchBenchmark(t);
  const config = loadBenchmarkConfig(dir);
  const [fixture] = resolveFixtureSelection({ config, useBattery: true, fixturesRoot });
  const shared = { config, benchmarkDir: dir, phase: "stage0-mock", fixture, repeat: 1,
    seed: config.seed, modelRunner: runner() };
  const call1 = await runCall1Generation({ ...shared, profileId: "set-a-recall-reasoning-v1" });
  assert.equal(call1.status, "completed");
  const call1Files = await readdir(call1.dir);
  for (const name of ["request-provenance.json", "prompt-fingerprints.json",
    "semantic-inventory.model-raw.json", "semantic-inventory.verified-pre-host.json",
    "usage.json", "files.sha256"]) assert.ok(call1Files.includes(name), name);
  const prov = JSON.parse(await readFile(path.join(call1.dir, "request-provenance.json"), "utf8"));
  assert.equal(prov.allowRepair, false);
  assert.equal(prov.pairProfileId, "set-a-recall-reasoning-v1");
  assert.equal(prov.call1.version, "recall-reasoning-call1-v1");
  assert.match(prov.fingerprints.call1.systemSha256, /^[0-9a-f]{64}$/);
  await assert.rejects(async () => runCall1Generation({ ...shared,
    profileId: "set-a-recall-reasoning-v1" }),
  (error) => error.code === "CF1_BENCHMARK_RUN_INVALID", "run dirs are immutable");

  const full = await runFullGeneration({ ...shared, profileId: "set-control-current-v1" });
  assert.equal(full.status, "completed");
  assert.equal(full.result.claimPackage.diagnostics.agentRuntime.promptIdentity.profileId,
    "set-control-current-v1");
  const manifestOutcome = finalizeManifest({ benchmarkDir: dir, phase: "stage0-mock",
    manifest: { benchmarkId: config.benchmarkId, runs: [call1.entry, full.entry] } });
  assert.match(manifestOutcome.manifestSha256, /^[0-9a-f]{64}$/);
  assert.throws(() => finalizeManifest({ benchmarkDir: dir, phase: "stage0-mock",
    manifest: {} }), (error) => error.code === "CF1_BENCHMARK_RUN_INVALID",
  "manifests are immutable per phase");
});
