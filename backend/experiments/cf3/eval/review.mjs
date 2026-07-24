#!/usr/bin/env node
// Build a review page from a CF2/CF3 result.json.
// Usage: node eval/review.mjs <result.json> [--system CF2|CF3] [--fixture CF1-F03] [--out path]
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeRun, renderReview } from "./apparatus.mjs";

const opt = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const resultPath = process.argv[2];
if (!resultPath || resultPath.startsWith("--")) throw new Error("usage: node eval/review.mjs <result.json> [--system] [--fixture] [--out]");

const result = JSON.parse(readFileSync(resultPath, "utf8"));
const run = normalizeRun(result, { system: opt("--system"), fixture: opt("--fixture") });
const out = opt("--out", path.join(path.dirname(resultPath), "review.html"));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, renderReview(run));
console.log(`${run.system} ${run.fixture}: ${run.candidates.length} candidates, ${run.selectedCount} selected`);
console.log(`review -> ${out}`);
