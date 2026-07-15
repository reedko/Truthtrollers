import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testRoot, "../..");
const scanRoots = [path.join(backendRoot, "src/claim-foundry"),
  path.join(backendRoot, "src/routes/claim-foundry"), testRoot];
const storageFiles = ["dbTransaction.js", "claimFoundryIdentity.js", "claimFoundryRunStore.js",
  "claimFoundryPackageStore.js", "claimFoundryBindingStore.js", "claimFoundryPersistence.js"]
  .map((name) => path.join(backendRoot, "src/storage", name));

async function javascriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return javascriptFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".js") ? [absolute] : [];
  }));
  return nested.flat();
}

test("handwritten CF1 JavaScript files stay within the line limit", async (t) => {
  const files = [...(await Promise.all(scanRoots.map(javascriptFiles))).flat(), ...storageFiles];
  assert.ok(files.length > 0, "expected CF1 JavaScript files");

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length;
    if (lines > 250) t.diagnostic(`split recommended: ${path.relative(backendRoot, file)} has ${lines} lines`);
    assert.ok(lines <= 500, `${path.relative(backendRoot, file)} has ${lines} lines; maximum is 500`);
  }
});
