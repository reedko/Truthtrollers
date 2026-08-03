import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cf7Root = path.resolve(here, "../../../src/claimfoundry/cf7");
const claimfoundryRoot = path.resolve(cf7Root, "..");
const sharedRoot = path.join(claimfoundryRoot, "shared");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  }));
  return nested.flat();
}

test("CF7 imports stay inside the isolated claimfoundry boundary", async () => {
  const violations: string[] = [];
  for (const file of await sourceFiles(cf7Root)) {
    const source = await readFile(file, "utf8");
    const importSpecifiers = [...source.matchAll(
      /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    )].map((match) => match[1]!);
    for (const specifier of importSpecifiers) {
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      if (!resolved.startsWith(`${claimfoundryRoot}${path.sep}`)) {
        violations.push(`${path.relative(cf7Root, file)} -> ${specifier}`);
      }
    }
    if (
      /(?:agents?\/|Agent\/|experiments\/cf[1-6]|evidence-run|EvidenceRun)/.test(
        source,
      )
    ) {
      violations.push(`${path.relative(cf7Root, file)} contains a prohibited path`);
    }
  }
  assert.deepEqual(violations, []);
});

test("CF7 has no agent loop, working-package, disposition, or repair imports", async () => {
  const prohibited = [
    "claimFoundryAgent",
    "claimFoundryRunner",
    "WorkingPackage",
    "regionDisposition",
    "semanticCritic",
    "applyRepair",
  ];
  const violations: string[] = [];
  for (const file of await sourceFiles(cf7Root)) {
    const source = await readFile(file, "utf8");
    for (const term of prohibited) {
      if (source.includes(term)) {
        violations.push(`${path.relative(cf7Root, file)} contains ${term}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("shared adapters reach outside the boundary only through the approved neutral utilities", async () => {
  const approvedExternalSpecifiers = new Set([
    "../../../claim-foundry/article-document/index.js",
    "../../../claim-foundry/canonicalJson.js",
    "../../../core/openAiLLM.js",
  ]);
  const violations: string[] = [];
  for (const file of await sourceFiles(sharedRoot)) {
    const source = await readFile(file, "utf8");
    const importSpecifiers = [...source.matchAll(
      /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    )].map((match) => match[1]!);
    for (const specifier of importSpecifiers) {
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      if (
        !resolved.startsWith(`${claimfoundryRoot}${path.sep}`)
        && !approvedExternalSpecifiers.has(specifier)
      ) {
        violations.push(`${path.relative(sharedRoot, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
