#!/usr/bin/env node
// Evaluate a CF3 result.json against a sealed gold key: inventory recall (discovery
// coverage), portfolio recall (selection coverage), and crux coverage.
// Usage: node eval-gold.mjs <result.json> [gold.json]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const resultPath = process.argv[2];
if (!resultPath) throw new Error("usage: node eval-gold.mjs <result.json> [gold.json]");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const goldPath = process.argv[3]
  ?? path.join(here, "gold", `${result.article?.fixtureId ?? "CF1-F03"}.gold.json`);
const gold = JSON.parse(readFileSync(goldPath, "utf8"));

const selectedIds = new Set(result.assertions.map((a) => a.assertionId));
// Text a gold claim can match against: inventory items use assertionText; selected rows
// use both the final testableAssertion and the inventory text they came from.
const inventoryTexts = result.inventory.map((x) => x.assertionText);
const portfolioTexts = result.assertions.map((a) =>
  `${a.testableAssertion ?? ""} || ${a.inventoryAssertionText ?? ""}`);

const covers = (claim, text) =>
  claim.all.every((group) => group.some((alt) => new RegExp(alt, "i").test(text)));
const anyCovers = (claim, texts) => texts.some((t) => covers(claim, t));

let invHit = 0; let portHit = 0; const missingInv = []; const missingPort = [];
for (const claim of gold.claims) {
  const inInv = anyCovers(claim, inventoryTexts);
  const inPort = anyCovers(claim, portfolioTexts);
  if (inInv) invHit += 1; else missingInv.push(claim.goldId);
  if (inPort) portHit += 1; else missingPort.push(claim.goldId);
  const tag = claim.crux ? " ◀ CRUX" : "";
  console.log(`  ${claim.goldId} ${inInv ? "inv✓" : "inv✗"} ${inPort ? "port✓" : "port✗"}`
    + `  [${claim.branch}]${tag}  ${claim.text.slice(0, 66)}`);
}

const n = gold.claims.length;
const crux = gold.claims.find((c) => c.crux);
console.log(`\n${path.basename(resultPath === "-" ? resultPath : path.dirname(resultPath))}`);
console.log(`inventory recall:  ${invHit}/${n} (${Math.round((invHit / n) * 100)}%)  missing: ${missingInv.join(",") || "none"}`);
console.log(`portfolio recall:  ${portHit}/${n} (${Math.round((portHit / n) * 100)}%)  missing: ${missingPort.join(",") || "none"}`);
if (crux) {
  console.log(`CRUX (${crux.goldId}): inventory ${anyCovers(crux, inventoryTexts) ? "PRESENT" : "ABSENT"}`
    + ` · portfolio ${anyCovers(crux, portfolioTexts) ? "SELECTED ✓" : "NOT SELECTED ✗"}`);
}
