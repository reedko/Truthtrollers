#!/usr/bin/env node
// CF1 prompt-benchmark GENERATION command (coder plan §10.2). Reads articles and
// prompt-set code only; never evaluation keys. One immutable manifest per
// invocation. All runs are strict two-call (allowRepair:false), temperature 0.
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { createCf1ModelRunner } from "../../backend/src/claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../backend/src/claim-foundry/openAiTransport.js";
import { listPairProfiles } from "../../backend/test/claim-foundry/prompt-benchmark/promptSets/index.js";
import { assertBilledRunApproved, loadBenchmarkConfig, parseFixtureRepeats,
  resolveFixtureSelection, resolveRepeats }
  from "../../backend/test/claim-foundry/prompt-benchmark/benchmarkConfig.js";
import { finalizeManifest, runCall1Generation, runCall2Generation, runFullGeneration }
  from "../../backend/test/claim-foundry/prompt-benchmark/generationRun.js";

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const values = (flag) => args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []));
const has = (flag) => args.includes(flag);

if (has("--help") || args.length === 0) {
  console.log(`Usage: node scripts/testing/cf1_run_prompt_sets.mjs
  --benchmark-dir <artifacts/claim-foundry/prompt-sets/<id>>  --mode call1|call2|full
  --phase <name>  --set <profile-id> [repeatable, >=1 required]
  (--fixture <CF1-FXX> [repeatable] | --battery)   [call1/full]
  --packet <packet-id> [repeatable]                [call2]
  --repeats <n>  --fixture-repeats CF1-FXX=n [repeatable]
  --model <id> (must equal config)  --seed <seed>
  (--openai | --transport <module.mjs>)   [billed --openai requires approved config]`);
  process.exit(2);
}

try {
  const benchmarkDir = value("--benchmark-dir");
  const mode = value("--mode");
  const seed = value("--seed");
  const model = value("--model");
  const phase = value("--phase") ?? `${mode}-${new Date().toISOString().slice(0, 10)}`;
  const profileIds = values("--set");
  if (!benchmarkDir || !mode || !seed || !model) {
    throw new Error("--benchmark-dir, --mode, --model, and --seed are required (no silent defaults)");
  }
  if (!["call1", "call2", "full"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  if (!profileIds.length) throw new Error("At least one --set is required");
  const known = new Map(listPairProfiles().map((profile) => [profile.id, profile]));
  for (const id of profileIds) {
    if (!known.has(id)) throw new Error(`Unknown prompt profile: ${id}`);
    if (mode !== "call1" && known.get(id).call1Only) {
      throw new Error(`${id} is a test-only Call 1 profile`);
    }
  }
  const config = loadBenchmarkConfig(benchmarkDir);
  if (model !== config.model) throw new Error(`--model ${model} differs from frozen config model ${config.model}`);

  const packets = values("--packet");
  const fixtureFlags = values("--fixture");
  if (mode === "call2") {
    if (!packets.length) throw new Error("call2 mode requires --packet (repeatable)");
    if (fixtureFlags.length || has("--battery")) throw new Error("--fixture/--battery are invalid in call2 mode");
  } else if (packets.length) {
    throw new Error("--packet is only valid in call2 mode");
  }

  dotenv.config({ path: path.resolve("backend/.env"), quiet: true });
  let transport;
  if (has("--openai")) {
    assertBilledRunApproved(config);
    transport = createOpenAiCf1Transport();
  } else {
    const transportPath = value("--transport");
    if (!transportPath) throw new Error("Provide --openai (billed) or --transport <module.mjs>");
    const transportModule = await import(pathToFileURL(path.resolve(transportPath)).href);
    transport = transportModule.default ?? transportModule.transport;
  }
  const modelRunner = createCf1ModelRunner({ transport });

  const subjects = mode === "call2"
    ? packets.map((packetId) => ({ key: packetId }))
    : resolveFixtureSelection({ config, fixtures: fixtureFlags, useBattery: has("--battery"),
      fixturesRoot: path.resolve("backend/test/claim-foundry/fixtures") })
      .map((fixture) => ({ key: fixture.fixtureId, fixture }));
  const repeatPlan = mode === "call2"
    ? Object.fromEntries(subjects.map(({ key }) => [key, Number(value("--repeats") ?? 1)]))
    : resolveRepeats({ config, fixtureIds: subjects.map(({ key }) => key),
      repeats: value("--repeats") ? Number(value("--repeats")) : undefined,
      fixtureRepeats: parseFixtureRepeats(values("--fixture-repeats")) });

  const entries = [];
  for (const profileId of profileIds) {
    for (const subject of subjects) {
      for (let repeat = 1; repeat <= repeatPlan[subject.key]; repeat += 1) {
        const shared = { config, benchmarkDir: path.resolve(benchmarkDir), phase, profileId,
          repeat, seed, modelRunner };
        const outcome = mode === "call1"
          ? await runCall1Generation({ ...shared, fixture: subject.fixture })
          : mode === "full"
            ? await runFullGeneration({ ...shared, fixture: subject.fixture })
            : await runCall2Generation({ ...shared, packetId: subject.key });
        entries.push(outcome.entry);
        console.log(JSON.stringify({ profileId, subject: subject.key, repeat,
          status: outcome.status, tokens: outcome.entry.usage?.totalTokens ?? null }));
      }
    }
  }
  const manifest = { benchmarkId: config.benchmarkId, phase, mode, seed, model,
    profileIds, subjects: subjects.map(({ key }) => key), repeatPlan,
    createdAt: new Date().toISOString(), runs: entries };
  const { manifestPath } = finalizeManifest({ benchmarkDir: path.resolve(benchmarkDir),
    manifest, phase });
  console.log(JSON.stringify({ manifest: manifestPath, runs: entries.length,
    failed: entries.filter((entry) => entry.status !== "completed").length }, null, 2));
  process.exitCode = entries.every((entry) => entry.status === "completed") ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? "CF1_BENCHMARK_CLI_FAILED",
    message: error.message }));
  process.exitCode = 2;
}
