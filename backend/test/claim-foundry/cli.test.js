import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createArticleAndBlocks, createSelectedEnrichmentOutput, createSemanticInventoryOutput,
  createValidPackage } from "./fixtures/packages.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function jsonFile(directory, name, value) {
  const file = path.join(directory, name);
  await writeFile(file, `${JSON.stringify(value)}\n`);
  return file;
}

test("offline validator accepts a finalized portable package", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cf1-validator-"));
  const packageFile = await jsonFile(directory, "package.json", createValidPackage());
  const result = spawnSync(process.execPath,
    ["scripts/testing/cf1_validate_package.mjs", "--package", packageFile],
    { cwd: REPO, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
});

test("local runner completes without persistence through an injected transport", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cf1-runner-"));
  const { article } = createArticleAndBlocks();
  const inventory = JSON.stringify(createSemanticInventoryOutput());
  const enrichment = JSON.stringify(createSelectedEnrichmentOutput());
  const articleFile = await jsonFile(directory, "article.json", article);
  const transportFile = path.join(directory, "transport.mjs");
  await writeFile(transportFile, `const inventory = ${inventory};\nconst enrichment = ${enrichment};\n`
    + `export default { invoke: async (request) => ({\n`
    + `output: request.usageContext.stage === "semantic_inventory" ? inventory : enrichment, model: "fixture",\n`
    + `usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } }) };\n`);
  const result = spawnSync(process.execPath, ["scripts/dev/cf1_run_claim_foundry.mjs",
    "--article", articleFile, "--transport", transportFile, "--model", "fixture",
    "--max-output-tokens", "3000", "--max-total-tokens", "20000"],
  { cwd: REPO, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.run.status, "ready_for_evidence");
  assert.equal(output.run.executionPath, "agent");
  assert.match(output.packageHash, /^[a-f0-9]{64}$/);
  assert.equal(output.artifactRefs.artifactRoot, null);
});
