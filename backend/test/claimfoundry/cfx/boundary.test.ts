import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function tsFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await tsFiles(target));
    else if (entry.name.endsWith(".ts")) files.push(target);
  }
  return files;
}

test("CFX imports only its own module and neutral shared infrastructure", async () => {
  const root = path.resolve("src/claimfoundry/cfx");
  const files = await tsFiles(root);
  assert.ok(files.length > 0);
  const forbidden = [
    /\/cf[1-7]\//i,
    /agents?\//i,
    /EvidenceRun/i,
    /workingPackage/i,
    /semanticGrouping/i,
    /selectorExperiment/i,
    /regionDisposition/i,
    /repairLoop/i,
  ];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const imports = [...content.matchAll(
      /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g,
    )].map((match) => match[1]!);
    for (const imported of imports) {
      for (const pattern of forbidden) {
        assert.equal(
          pattern.test(imported),
          false,
          `${path.relative(root, file)} imports forbidden ${imported}`,
        );
      }
    }
  }
});
