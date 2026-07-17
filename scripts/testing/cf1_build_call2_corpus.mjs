#!/usr/bin/env node
// Build and freeze the Call 2 packet corpus from completed CF1 run artifact
// directories (coder plan §10.8). Offline; no model calls; never reads prior
// Call 2 output or evaluation material.
import path from "node:path";
import { buildCall2Corpus } from "../../backend/test/claim-foundry/prompt-benchmark/call2Corpus.js";

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const values = (flag) => args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []));

const benchmarkDir = value("--benchmark-dir");
const sourceRunDirs = values("--source-run");
if (!benchmarkDir || !sourceRunDirs.length) {
  console.error("Usage: node scripts/testing/cf1_build_call2_corpus.mjs --benchmark-dir <dir> --source-run <cf1run dir> [--source-run ...]");
  process.exit(2);
}
try {
  const manifest = buildCall2Corpus({ benchmarkDir: path.resolve(benchmarkDir),
    sourceRunDirs: sourceRunDirs.map((dir) => path.resolve(dir)) });
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? "CF1_CORPUS_CLI_FAILED", message: error.message }));
  process.exit(1);
}
