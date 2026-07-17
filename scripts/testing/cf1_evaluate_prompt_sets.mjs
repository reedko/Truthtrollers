#!/usr/bin/env node
// CF1 prompt-benchmark EVALUATION command (coder plan §10.4). Subcommands:
//   prepare      verify generation hashes, build blinded packets/review/score sheets
//   lock-scores  hash completed scores before any unblinding
//   report       (requires valid lock) join scores + producer key into reports
// Never modifies raw/ or a finalized manifest.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildBlindPackets, assertNoIdentityLeak }
  from "../../backend/test/claim-foundry/prompt-benchmark/blindPackets.js";
import { assertScoresLocked, loadEvaluationKeys, lockScores, verifyGenerationIntegrity }
  from "../../backend/test/claim-foundry/prompt-benchmark/evaluationKeys.js";
import { call1BlindOutput, call2BlindOutput, markdownToHtml, packageBlindOutput,
  renderCall1Review, renderCall2Review, scoreTemplate }
  from "../../backend/test/claim-foundry/prompt-benchmark/renderReview.js";
import { CALL1_DIMENSIONS, CALL2_DIMENSIONS, call1VarianceCsv, coverageSummary,
  runMetricsCsv, scoreSummary }
  from "../../backend/test/claim-foundry/prompt-benchmark/metrics.js";

const args = process.argv.slice(2);
const command = args[0];
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has = (flag) => args.includes(flag);
const benchmarkDir = path.resolve(value("--benchmark-dir") ?? "");
const phase = value("--phase");
if (!command || !value("--benchmark-dir") || !phase) {
  console.error("Usage: cf1_evaluate_prompt_sets.mjs <prepare|lock-scores|report> --benchmark-dir <dir> --phase <phase>");
  process.exit(2);
}
const readJsonIfExists = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

try {
  if (command === "prepare") {
    const manifest = verifyGenerationIntegrity({ benchmarkDir, phase });
    const runs = manifest.runs.map((run) => {
      const subject = run.fixtureId ?? run.packetId;
      const dir = path.join(benchmarkDir, "raw", phase, subject, run.pairProfileId, String(run.repeat));
      const blindOutput = manifest.mode === "call1"
        ? call1BlindOutput(readJsonIfExists(path.join(dir, "semantic-inventory.verified-pre-host.json")))
        : manifest.mode === "call2"
          ? call2BlindOutput(readJsonIfExists(path.join(dir, "selected-enrichment.verified.json")))
          : packageBlindOutput(readJsonIfExists(path.join(dir, "claim-package.json")));
      return { pairProfileId: run.pairProfileId, fixtureId: run.fixtureId,
        packetId: run.packetId, repeat: run.repeat, status: run.status, blindOutput };
    });
    const { packets, producerKey } = buildBlindPackets({ runs, seed: manifest.seed });
    assertNoIdentityLeak(packets);
    const blindDir = path.join(benchmarkDir, "blind", phase);
    mkdirSync(blindDir, { recursive: true });
    mkdirSync(path.join(benchmarkDir, "private"), { recursive: true });
    mkdirSync(path.join(benchmarkDir, "scores"), { recursive: true });
    const dimensions = manifest.mode === "call1" ? CALL1_DIMENSIONS : CALL2_DIMENSIONS;
    // Canary keys stay sealed until scores are locked (coder plan §5.6): their
    // targets never enter the pre-lock score template.
    const config = readJsonIfExists(path.join(benchmarkDir, "inputs", "benchmark-config.json"));
    const sealed = new Set(config?.sealedCanaryFixtures ?? []);
    const keys = manifest.mode === "call1" || manifest.mode === "full"
      ? loadEvaluationKeys({ keysRoot: path.resolve("backend/test/claim-foundry/prompt-evaluation-keys"),
        fixtureIds: [...new Set(manifest.runs.map((run) => run.fixtureId)
          .filter((id) => id && !sealed.has(id)))] })
      : [];
    const review = manifest.mode === "call1" ? renderCall1Review(packets) : renderCall2Review(packets);
    writeFileSync(path.join(blindDir, "review.md"), review);
    writeFileSync(path.join(blindDir, "review.html"),
      markdownToHtml(review, `CF1 blinded review — ${phase}`));
    writeFileSync(path.join(blindDir, "review-packets.json"), JSON.stringify(packets, null, 2));
    writeFileSync(path.join(blindDir, "score-template.json"),
      JSON.stringify({ ...scoreTemplate({ packets, dimensions }), evaluationTargets: keys }, null, 2));
    writeFileSync(path.join(benchmarkDir, "private", `producer-key-${phase}.json`),
      JSON.stringify({ phase, seed: manifest.seed, producerKey }, null, 2));
    console.log(JSON.stringify({ phase, packets: packets.length,
      blindDir, note: "score into scores/completed-" + phase + ".json, then lock-scores" }, null, 2));
  } else if (command === "deep-review") {
    // Render-spec v2 deliverables: claims.csv + interactive review.html
    // (claims table, provenance-tagged detail, alignment view). Blinded.
    const { collectDeepRows, rowsToCsv } = await import(
      "../../backend/test/claim-foundry/prompt-benchmark/deepReview.js");
    const { renderDeepReviewHtml } = await import(
      "../../backend/test/claim-foundry/prompt-benchmark/deepReviewHtml.js");
    const manifest = verifyGenerationIntegrity({ benchmarkDir, phase });
    const unblinded = has("--unblinded");
    const labelsByProfile = unblinded
      ? new Map(manifest.profileIds.map((profileId) => {
        if (profileId === "set-e-posture-first-c-full-v1") return [profileId, "Set E2 + C2"];
        const match = /^set-([a-z])-/.exec(profileId);
        return [profileId, match ? `Set ${match[1].toUpperCase()}` : profileId];
      }))
      : new Map(Object.entries(JSON.parse(readFileSync(
        path.join(benchmarkDir, "private", `producer-key-${phase}.json`), "utf8")).producerKey)
        .map(([label, profileId]) => [profileId, label]));
    const { rows, orientations } = collectDeepRows({ benchmarkDir, phase, manifest, labelsByProfile });
    const csv = rowsToCsv(rows);
    const html = renderDeepReviewHtml({ phase, mode: manifest.mode, rows, orientations });
    for (const [name, body] of [["claims.csv", csv], ["review.html", html]]) {
      if (!unblinded) {
        for (const profileId of labelsByProfile.keys()) {
          if (body.includes(profileId)) throw new Error(`${name} leaks producer identity ${profileId}`);
        }
      }
    }
    const outputDir = path.join(benchmarkDir, unblinded ? "reports" : "blind", phase);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(path.join(outputDir, "claims.csv"), csv);
    writeFileSync(path.join(outputDir, "review.html"), html);
    console.log(JSON.stringify({ phase, rows: rows.length,
      failedRuns: orientations.filter((o) => o.runStatus === "failed").length,
      unblinded,
      files: [path.join(outputDir, "claims.csv"), path.join(outputDir, "review.html")] }, null, 2));
  } else if (command === "lock-scores") {
    const { lockPath, lock } = lockScores({ benchmarkDir, phase });
    writeFileSync(lockPath, JSON.stringify(lock, null, 2));
    console.log(JSON.stringify(lock, null, 2));
  } else if (command === "report") {
    const lock = assertScoresLocked({ benchmarkDir, phase });
    const manifest = verifyGenerationIntegrity({ benchmarkDir, phase });
    const scores = JSON.parse(readFileSync(path.join(benchmarkDir, "scores", `completed-${phase}.json`), "utf8"));
    const { producerKey } = JSON.parse(readFileSync(
      path.join(benchmarkDir, "private", `producer-key-${phase}.json`), "utf8"));
    const reportsDir = path.join(benchmarkDir, "reports");
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(path.join(reportsDir, `run-metrics-${phase}.csv`), runMetricsCsv(manifest));
    if (manifest.mode === "call1") {
      const counts = manifest.runs.map((run) => {
        const dir = path.join(benchmarkDir, "raw", phase, run.fixtureId, run.pairProfileId, String(run.repeat));
        const verified = readJsonIfExists(path.join(dir, "semantic-inventory.verified-pre-host.json"));
        return { pairProfileId: run.pairProfileId, subject: run.fixtureId,
          candidateCount: verified?.candidateClaims?.length ?? null };
      });
      writeFileSync(path.join(reportsDir, `variance-${phase}.csv`), call1VarianceCsv(counts));
    }
    const { dimensionsCsv, recallCsv } = scoreSummary({ scores, producerKey });
    writeFileSync(path.join(reportsDir, `dimension-scores-${phase}.csv`), dimensionsCsv);
    writeFileSync(path.join(reportsDir, `category-recall-${phase}.csv`), recallCsv);
    const coverage = coverageSummary(manifest, { expectedSubjects: manifest.subjects ?? [],
      expectedProfiles: manifest.profileIds ?? [] });
    writeFileSync(path.join(reportsDir, `coverage-${phase}.json`),
      JSON.stringify({ lock, coverage }, null, 2));
    console.log(JSON.stringify({ phase, reportsDir, partial: coverage.partial }, null, 2));
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? "CF1_EVALUATE_CLI_FAILED", message: error.message }));
  process.exit(1);
}
