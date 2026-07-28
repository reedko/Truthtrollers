#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreFixture } from "./scoring.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
};
const fixtureId = valueAfter("--fixture");
if (!/^CF1-F\d{2}$/.test(fixtureId ?? "")) {
  throw new Error("Usage: score.mjs --fixture CF1-F01 [--prediction FILE]");
}

const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));
const tupleReview = readJson(path.join(
  here,
  "reviews",
  `${fixtureId}.discourse-tuples.review.json`,
));
const positionReview = readJson(path.join(
  here,
  "reviews",
  `${fixtureId}.article-position-map.review.json`,
));
const predictionPath = valueAfter("--prediction")
  ? path.resolve(process.cwd(), valueAfter("--prediction"))
  : path.join(here, "observed", `${fixtureId}.observed-prediction.json`);
const prediction = readJson(predictionPath);
const scores = scoreFixture({ tupleReview, positionReview, prediction });
scores.predictionPath = path.relative(here, predictionPath);

const outputDir = path.join(here, "scores");
mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `${fixtureId}.score.json`);
writeFileSync(outputPath, `${JSON.stringify(scores, null, 2)}\n`);
console.log(JSON.stringify(scores, null, 2));
console.error(`Wrote ${outputPath}`);
