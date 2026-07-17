// Benchmark configuration + selection rules (coder plan §10.2). Generation-side
// module: it must never resolve evaluation keys, expectations, scores, or
// producer keys — readGenerationFile enforces that fail-closed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const FORBIDDEN_GENERATION_PATHS =
  /expectations(?:\.proposed)?\.json$|prompt-evaluation-keys|producer-key|scores|review-notes/i;

export function readGenerationFile(filePath) {
  if (FORBIDDEN_GENERATION_PATHS.test(filePath)) {
    throw Object.assign(new Error(`Generation may not read evaluation material: ${filePath}`),
      { code: "CF1_BENCHMARK_EVALUATION_ACCESS" });
  }
  return readFileSync(filePath, "utf8");
}

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function configError(message) {
  return Object.assign(new Error(message), { code: "CF1_BENCHMARK_CONFIG_INVALID" });
}

export function loadBenchmarkConfig(benchmarkDir) {
  const configPath = path.join(benchmarkDir, "inputs", "benchmark-config.json");
  const config = JSON.parse(readGenerationFile(configPath));
  if (config.schemaVersion !== "cf1.benchmarkConfig.v1") throw configError("Unknown benchmark-config schema");
  if (config.allowRepair !== false) throw configError("Benchmark config must set allowRepair:false");
  if (!Array.isArray(config.approvedFixtures) || !config.approvedFixtures.length) {
    throw configError("Benchmark config must list approvedFixtures");
  }
  if (!Array.isArray(config.battery) || !config.battery.length) throw configError("Benchmark config must record the battery");
  return config;
}

// Resolve and validate the fixture selection per the plan's first-class rules:
// repeatable --fixture XOR --battery; NO implicit default; unknown or unapproved
// IDs (including CF1-F09 unless approved) fail closed; frozen article hash must
// match at selection time.
export function resolveFixtureSelection({ config, fixtures = [], useBattery = false,
  fixturesRoot }) {
  if (useBattery && fixtures.length) throw configError("--fixture and --battery may not be combined");
  const requested = useBattery ? config.battery : fixtures;
  if (!requested.length) {
    throw configError("No fixtures selected: pass --fixture <CF1-FXX> (repeatable) or --battery");
  }
  const approved = new Map(config.approvedFixtures.map((item) => [item.fixtureId, item]));
  return requested.map((fixtureId) => {
    const entry = approved.get(fixtureId);
    if (!entry) throw configError(`Fixture ${fixtureId} is not approved for this benchmark`);
    const articlePath = path.join(fixturesRoot, fixtureId, "article.json");
    const raw = readGenerationFile(articlePath);
    if (sha256(raw) !== entry.articleSha256) {
      throw configError(`Fixture ${fixtureId} article no longer matches its frozen hash`);
    }
    return { fixtureId, articlePath, article: JSON.parse(raw), class: entry.class };
  });
}

// Precedence: explicit --fixture-repeats > explicit --repeats > config
// per-fixture default > config default. An explicit CLI --repeats overrides the
// config's per-fixture canary default (the operator asked for exactly that count).
export function resolveRepeats({ config, fixtureIds, repeats, fixtureRepeats = {} }) {
  const base = repeats ?? config.repeats?.default ?? 3;
  const perFixture = repeats === undefined
    ? { ...(config.repeats?.perFixture ?? {}), ...fixtureRepeats }
    : fixtureRepeats;
  return Object.fromEntries(fixtureIds.map((id) => [id, Number(perFixture[id] ?? base)]));
}

export function parseFixtureRepeats(values = []) {
  return Object.fromEntries(values.map((value) => {
    const match = /^(CF1-F\d{2})=(\d+)$/.exec(value);
    if (!match) throw configError(`Invalid --fixture-repeats value: ${value}`);
    return [match[1], Number(match[2])];
  }));
}

export function assertBilledRunApproved(config) {
  if (config.approved !== true) {
    throw configError("benchmark-config.json is not approved; owner must set approved:true before billed runs");
  }
}
