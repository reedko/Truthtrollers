import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCf1ModelRunner } from "../../src/claim-foundry/modelRunner.js";
import { assignOpaqueLabels, buildBlindPackets, assertNoIdentityLeak }
  from "./prompt-benchmark/blindPackets.js";
import { assertScoresLocked, lockScores, verifyGenerationIntegrity }
  from "./prompt-benchmark/evaluationKeys.js";
import { call1BlindOutput, markdownToHtml, renderCall1Review } from "./prompt-benchmark/renderReview.js";
import { loadBenchmarkConfig, resolveFixtureSelection, sha256 } from "./prompt-benchmark/benchmarkConfig.js";
import { finalizeManifest, runCall1Generation } from "./prompt-benchmark/generationRun.js";
import { createArticleAndBlocks, createSemanticInventoryOutput } from "./fixtures/packages.js";

const PROFILES = ["set-control-current-v1", "set-a-recall-reasoning-v1",
  "set-b-fidelity-ladder-v1", "set-c-claim-contract-v1"];

test("opaque labels are seeded, stable, bijective, and never A/B/C", () => {
  const first = assignOpaqueLabels(PROFILES, "seed-1");
  const second = assignOpaqueLabels(PROFILES, "seed-1");
  assert.deepEqual(first.producerKey, second.producerKey, "stable per seed");
  const labels = Object.keys(first.producerKey);
  assert.equal(new Set(labels).size, 4);
  for (const label of labels) assert.match(label, /^Profile [A-Z]$/);
  assert.deepEqual(new Set(Object.values(first.producerKey)), new Set(PROFILES));
  // 4 arms → 24 permutations; individual seed pairs may collide, but the seed
  // must actually drive the shuffle.
  const variants = ["s2", "s3", "s4", "s5", "s6"].map((seed) =>
    JSON.stringify(assignOpaqueLabels(PROFILES, seed).producerKey));
  assert.ok(variants.some((variant) => variant !== JSON.stringify(first.producerKey)),
    "seed drives the label shuffle");
});

test("blind packets randomize section order per subject and hide identity", () => {
  const runs = PROFILES.flatMap((pairProfileId) => [
    { pairProfileId, fixtureId: "CF1-F98", repeat: 1, status: "completed",
      blindOutput: { candidateClaims: [] } },
    { pairProfileId, fixtureId: "CF1-F97", repeat: 1, status: "completed",
      blindOutput: { candidateClaims: [] } }]);
  const first = buildBlindPackets({ runs, seed: "seed-1" });
  const second = buildBlindPackets({ runs, seed: "seed-1" });
  assert.deepEqual(first.packets, second.packets, "stable per seed");
  assert.ok(assertNoIdentityLeak(first.packets));
  const leaking = structuredClone(first.packets);
  leaking[0].outputs[Object.keys(leaking[0].outputs)[0]].output = { totalTokens: 5 };
  assert.throws(() => assertNoIdentityLeak(leaking),
    (error) => error.code === "CF1_BLINDING_LEAK");
});

test("generation integrity verifies hashes and the score lock gates unblinding", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cf1pb-eval-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { article } = createArticleAndBlocks();
  const fixturesRoot = path.join(dir, "fixtures");
  await mkdir(path.join(fixturesRoot, "CF1-F98"), { recursive: true });
  const articleBody = JSON.stringify({ title: article.title, text: article.text });
  await writeFile(path.join(fixturesRoot, "CF1-F98", "article.json"), articleBody);
  await mkdir(path.join(dir, "inputs"), { recursive: true });
  await writeFile(path.join(dir, "inputs", "benchmark-config.json"), JSON.stringify({
    schemaVersion: "cf1.benchmarkConfig.v1", benchmarkId: "cf1pb-eval", approved: false,
    seed: "seed-1", model: "fake", temperature: 0, timeoutMs: 1_000,
    budgetLimits: { maxTotalTokens: 20_000, maxOutputTokensPerCall: 3_000, maxDurationMs: 30_000 },
    blockOptions: { targetMinChars: 1, targetMaxChars: 70, hardMaxChars: 100 },
    allowRepair: false, battery: ["CF1-F98"], repeats: { default: 1 },
    approvedFixtures: [{ fixtureId: "CF1-F98", class: "short", articleSha256: sha256(articleBody) }],
  }));
  const config = loadBenchmarkConfig(dir);
  const [fixture] = resolveFixtureSelection({ config, useBattery: true, fixturesRoot });
  const modelRunner = createCf1ModelRunner({ transport: { invoke: async () => ({
    output: createSemanticInventoryOutput(), model: "fake",
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } }) } });
  const runs = [];
  for (const profileId of PROFILES.slice(0, 2)) {
    const outcome = await runCall1Generation({ config, benchmarkDir: dir, phase: "p1",
      profileId, fixture, repeat: 1, seed: config.seed, modelRunner });
    runs.push(outcome);
  }
  finalizeManifest({ benchmarkDir: dir, phase: "p1", manifest: { benchmarkId: "cf1pb-eval",
    phase: "p1", mode: "call1", seed: config.seed, runs: runs.map((run) => run.entry) } });
  const manifest = verifyGenerationIntegrity({ benchmarkDir: dir, phase: "p1" });
  assert.equal(manifest.runs.length, 2);
  // Rendering smoke: blinded review shows opaque labels, not profile IDs.
  const verified = JSON.parse(await readFile(path.join(runs[0].dir,
    "semantic-inventory.verified-pre-host.json"), "utf8"));
  const { packets } = buildBlindPackets({ runs: manifest.runs.map((run) => ({
    pairProfileId: run.pairProfileId, fixtureId: run.fixtureId, repeat: run.repeat,
    status: run.status, blindOutput: call1BlindOutput(verified) })), seed: config.seed });
  const review = renderCall1Review(packets);
  assert.match(review, /### Profile [A-Z]/);
  assert.doesNotMatch(review, /set-(?:control|a|b|c)-/);
  const html = markdownToHtml(review, "<title> & test");
  assert.match(html, /<h3>Profile [A-Z]<\/h3>/);
  assert.match(html, /<table><thead><tr><th>#<\/th>/);
  assert.doesNotMatch(html, /set-(?:control|a|b|c)-/);
  assert.ok(html.includes("&lt;title&gt; &amp; test"), "titles are entity-escaped");
  // Tampering with a raw artifact must fail integrity verification.
  writeFileSync(path.join(runs[0].dir, "usage.json"), "{\"tampered\":true}");
  assert.throws(() => verifyGenerationIntegrity({ benchmarkDir: dir, phase: "p1" }),
    (error) => error.code === "CF1_EVALUATION_INVALID");
  // Score lock flow.
  await mkdir(path.join(dir, "scores"), { recursive: true });
  const scoresPath = path.join(dir, "scores", "completed-p1.json");
  await writeFile(scoresPath, JSON.stringify({ packets: [] }));
  assert.throws(() => assertScoresLocked({ benchmarkDir: dir, phase: "p1" }),
    (error) => error.code === "CF1_EVALUATION_INVALID", "unlocked scores refuse unblinding");
  const { lockPath, lock } = lockScores({ benchmarkDir: dir, phase: "p1" });
  await writeFile(lockPath, JSON.stringify(lock));
  assert.ok(assertScoresLocked({ benchmarkDir: dir, phase: "p1" }));
  await writeFile(scoresPath, JSON.stringify({ packets: [], edited: true }));
  assert.throws(() => assertScoresLocked({ benchmarkDir: dir, phase: "p1" }),
    (error) => error.code === "CF1_EVALUATION_INVALID", "post-lock edits refuse unblinding");
});
