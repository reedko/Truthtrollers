import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeCf1Artifacts } from "../../src/claim-foundry/artifacts.js";
import { createRunId } from "../../src/claim-foundry/ids.js";
import { createValidPackage } from "./fixtures/packages.js";

test("artifact writer creates auditable JSON and Markdown copies", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cf1-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claimPackage = createValidPackage();
  const state = {
    run: { runId: createRunId(), status: "ready_for_evidence", executionPath: "normal",
      usage: { semanticCalls: 1, totalTokens: 100 } },
    article: claimPackage.article,
    structuralBlocks: claimPackage.semanticBlocks,
    claimPackage,
    verification: claimPackage.verification,
  };
  const result = await writeCf1Artifacts(state, { artifactRoot: root });
  assert.ok(result.files.some((file) => file.endsWith("claim-package.json")));
  assert.ok(result.files.some((file) => file.endsWith("claim-package.md")));
  assert.match(await readFile(path.join(result.artifactRoot, "summary.md"), "utf8"), /ready_for_evidence/);
  const review = await readFile(path.join(result.artifactRoot, "claim-package.md"), "utf8");
  assert.match(review, /# Selected claims/);
  assert.match(review, /### Falsifiability/);
  assert.match(review, /### EvidenceRun guidance/);
  const saved = JSON.parse(await readFile(path.join(result.artifactRoot, "claim-package.json"), "utf8"));
  assert.equal(saved.packageHash, claimPackage.packageHash);
});

test("artifact writer rejects unsafe or invalid run identity", async () => {
  await assert.rejects(
    writeCf1Artifacts({ run: { runId: "../../escape" } }, { artifactRoot: os.tmpdir() }),
    /valid CF1 run ID/,
  );
});
