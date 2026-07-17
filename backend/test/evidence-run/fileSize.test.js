import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testRoot, "../..");
const projectRoot = path.resolve(backendRoot, "..");

async function javascriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return javascriptFiles(absolute);
    return entry.isFile() && /\.(?:js|mjs)$/.test(entry.name) ? [absolute] : [];
  }));
  return nested.flat();
}

test("handwritten ER1 files stay within the project line limits", async (t) => {
  const files = [
    ...(await javascriptFiles(path.join(backendRoot, "src/evidence-run"))),
    ...(await javascriptFiles(testRoot)),
    path.join(projectRoot, "scripts/dev/er1_run_offline_plan.mjs"),
    path.join(projectRoot, "scripts/dev/er1_run_candidate_discovery.mjs"),
    path.join(projectRoot, "scripts/dev/er1_select_candidate_portfolio.mjs"),
  ];
  assert.ok(files.length > 0);
  for (const file of files) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/).length;
    if (lines > 250) t.diagnostic(`split recommended: ${path.relative(projectRoot, file)} has ${lines} lines`);
    assert.ok(lines <= 500, `${path.relative(projectRoot, file)} exceeds 500 lines`);
  }
});
