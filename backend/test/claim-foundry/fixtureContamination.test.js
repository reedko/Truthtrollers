import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guard against fixture contamination (MCT §13.3): entities from debugging fixtures
// must never appear in CF1 *or ER1* production code, prompts, matchers, or heuristics.
// This denylist may exist ONLY here, in a test file. The capability under test is
// general; a production file matching any of these terms is contamination, not
// topic support.
const DENYLISTED_FIXTURE_TERMS = [
  /\bcdc\b/i,
  /\bthompson\b/i,
  /\bvaccin/i,
  /\bautism\b/i,
  /\bmmr\b/i,
  /\bmeasles\b/i,
  /\bmumps\b/i,
  /\brubella\b/i,
  /\bthimerosal\b/i,
  /\bdestefano\b/i,
  /\bwakefield\b/i,
  /\bglyphosate\b/i,
  /\baluminum\b/i,
  /\bport townsend\b/i,
  // ER1-specific F01 identity constants (not topic words — CF1 never hardcoded these,
  // so the original denylist would miss them; ER1 hardcodes them in production logic).
  /10\.1542\/peds\.113\.2\.259/i, // DeStefano 2004 DOI
  /\b14754936\b/, // DeStefano 2004 PMID
  /school-matched/i, // F01 title fragment
  /age at first/i, // F01 title fragment
  /institute of medicine/i, // F01 named work (IOM review)
  // Fixture-specific domains hardcoded in the ER1 selector's classifier (Cleanup 2 lock);
  // these contain no topic word, so they slipped the guard until now.
  /broken\.?science/i,
  /expose-news/i,
  /house\.mn\.gov/i,
];

const PRODUCTION_ROOTS = [
  fileURLToPath(new URL("../../src/claim-foundry/", import.meta.url)),
  fileURLToPath(new URL("../../src/evidence-run/", import.meta.url)),
];
const SRC_ROOT = fileURLToPath(new URL("../../src/", import.meta.url));

async function productionFiles(root) {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

test("no fixture entity appears anywhere in CF1 or ER1 production sources", async () => {
  const files = (await Promise.all(PRODUCTION_ROOTS.map(productionFiles))).flat();
  assert.ok(files.length > 40, `Expected CF1+ER1 production tree, found ${files.length} files`);
  const violations = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const term of DENYLISTED_FIXTURE_TERMS) {
      if (term.test(content)) {
        violations.push(`${path.relative(SRC_ROOT, file)} matches ${term}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
