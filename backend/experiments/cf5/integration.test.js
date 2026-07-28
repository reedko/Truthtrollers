import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCf5Once, loadFixtureArticle } from "./run-cf5.mjs";
import { replayRun } from "./replay.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function fakeRawResponse(payload) {
  return { output_text: JSON.stringify(payload), usage: { input_tokens: 10, output_tokens: 5 }, model: "fake-model" };
}

// Distinguishes the generation call from the repair call by the schema name, exactly
// as the real transport would just be handed different request.responseSchema values.
function makeFakeRunner({ claims, repairedClaims = null }) {
  return {
    async invokeStructured(request) {
      if (request.responseSchema.name === "cf5_claims_v1") {
        const payload = { claims };
        return {
          output: payload, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 0 },
          model: "fake-model", rawResponse: fakeRawResponse(payload),
        };
      }
      if (request.responseSchema.name === "cf5_repair_v1") {
        const payload = { repairedClaims: repairedClaims ?? [] };
        return {
          output: payload, usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6, cachedInputTokens: 0 },
          model: "fake-model", rawResponse: fakeRawResponse(payload),
        };
      }
      throw new Error(`Unexpected schema in test: ${request.responseSchema.name}`);
    },
  };
}

function baseClaim(overrides = {}) {
  return {
    claimId: "E001",
    claim: "The CDC reported a rise in cases.",
    grounding: ["U0001"],
    articleTreatment: "adopted",
    provenance: null,
    ...overrides,
  };
}

function tmpOutDir() {
  return mkdtempSync(path.join(tmpdir(), "cf5-integration-"));
}

async function runWithFakeArticle(runner, outDir) {
  const article = { title: "Test Article", authors: ["Author"], publisher: "Pub", publishedAt: null, contentHash: "abc123" };
  const units = [{ unitId: "U0001", text: "The CDC reported a rise in cases." }];
  // The runner writes source-units.json at the shared (parent) level in real usage;
  // reproduce that here since runCf5Once itself only writes per-repeat artifacts.
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "source-units.json"), JSON.stringify(units));
  writeFileSync(path.join(outDir, "article-input.json"), JSON.stringify(article));
  const repeatDir = path.join(outDir, "repeat1");
  mkdirSync(repeatDir, { recursive: true });
  const result = await runCf5Once({
    fixture: "TEST-FIXTURE", article, units, model: "fake-model", timeoutMs: 1000,
    runner, outDir: repeatDir, repeatLabel: 1,
  });
  return { ...result, repeatDir, article, units };
}

test("integration: article preprocessing through final persisted claim artifact (real fixture loader)", () => {
  const { article, units } = loadFixtureArticle("CF1-F03");
  assert.ok(article.contentHash);
  assert.ok(units.length > 0);
  assert.ok(units.every((unit) => typeof unit.unitId === "string" && typeof unit.text === "string"));
});

test("integration: strict structured model response parses into the same claims persisted to disk", async () => {
  const outDir = tmpOutDir();
  const runner = makeFakeRunner({ claims: [baseClaim()] });
  const { repeatDir, finalClaims } = await runWithFakeArticle(runner, outDir);
  const persisted = JSON.parse(readFileSync(path.join(repeatDir, "parsed-claims.json"), "utf8"));
  assert.deepEqual(persisted, [baseClaim()]);
  assert.equal(finalClaims.length, 1);
});

test("integration: validation failure followed by a successful repair", async () => {
  const outDir = tmpOutDir();
  const runner = makeFakeRunner({
    claims: [baseClaim({ grounding: ["U9999"] })],
    repairedClaims: [baseClaim({ grounding: ["U0001"] })],
  });
  const { manifest, finalClaims } = await runWithFakeArticle(runner, outDir);
  assert.equal(manifest.status, "completed_with_repair");
  assert.equal(manifest.repairUsed, true);
  assert.deepEqual(finalClaims[0].grounding, ["U0001"]);
  assert.ok(existsSync(path.join(outDir, "repeat1", "repair-prompt.txt")));
  assert.ok(existsSync(path.join(outDir, "repeat1", "raw-repair-response.json")));
});

test("integration: validation failure followed by a failed repair is recorded, not retried", async () => {
  const outDir = tmpOutDir();
  const runner = makeFakeRunner({
    claims: [baseClaim({ grounding: ["U9999"] })],
    repairedClaims: [baseClaim({ grounding: ["U8888"] })], // still unknown
  });
  const { manifest } = await runWithFakeArticle(runner, outDir);
  assert.equal(manifest.status, "completed_with_unresolved_failures");
  const report = JSON.parse(readFileSync(path.join(outDir, "repeat1", "validation-report.json"), "utf8"));
  assert.ok(report.repairInfo.stillFailingClaimIds.includes("E001"));
});

test("integration: artifact completeness for a repair-free run", async () => {
  const outDir = tmpOutDir();
  const runner = makeFakeRunner({ claims: [baseClaim()] });
  const { repeatDir } = await runWithFakeArticle(runner, outDir);
  const required = [
    "raw-model-response.json", "parsed-claims.json", "validation-report.json",
    "final-claims.json", "usage.json", "run-manifest.json",
  ];
  for (const name of required) {
    assert.ok(existsSync(path.join(repeatDir, name)), `missing artifact: ${name}`);
  }
  assert.ok(existsSync(path.join(outDir, "article-input.json")));
  assert.ok(existsSync(path.join(outDir, "source-units.json")));
});

test("integration: replay reproduces the persisted final claims with zero network calls", async () => {
  const outDir = tmpOutDir();
  const runner = makeFakeRunner({ claims: [baseClaim(), baseClaim({ claimId: "E002", claim: "A second claim." })] });
  const { repeatDir, finalClaims } = await runWithFakeArticle(runner, outDir);
  const replayed = await replayRun(repeatDir);
  assert.deepEqual(replayed.finalClaims, finalClaims);
});

test("integration: canonical claim objects contain only the five authorized fields — no CF1/CF4 package shape", async () => {
  const outDir = tmpOutDir();
  const runner = makeFakeRunner({ claims: [baseClaim()] });
  const { finalClaims } = await runWithFakeArticle(runner, outDir);
  const allowedKeys = new Set(["claimId", "claim", "grounding", "articleTreatment", "provenance"]);
  const forbiddenKeys = [
    "selectedEvaluationClaims", "phase3Targets", "evidenceNeedCards", "pillar",
    "scoreTransform", "identityBundle", "attributionChain", "searchHints",
    "evidenceWarrant", "bearingCriteria", "confidence", "citedWorks", "thesisEffect",
  ];
  for (const claim of finalClaims) {
    const keys = Object.keys(claim);
    assert.deepEqual(new Set(keys), allowedKeys, `claim ${claim.claimId} has unexpected keys`);
    for (const forbidden of forbiddenKeys) {
      assert.ok(!(forbidden in claim), `claim ${claim.claimId} unexpectedly has forbidden field ${forbidden}`);
    }
  }
});

test("integration: no CF5 module imports archived CF1/CF4 semantic machinery", () => {
  const cf5Files = ["schemas.js", "prompts.js", "validation.js", "pipeline.js", "run-cf5.mjs", "replay.mjs"];
  const forbiddenImportFragments = [
    "cf4/candidates", "cf4/attribution", "cf4/coreference", "cf4/ambiguity_gate",
    "claim-foundry/contract.js", "claim-foundry/assemblePackage", "claim-foundry/verify",
    "claim-foundry/applyRepair.js", "claim-foundry/repairContract",
    "claim-foundry/oneCallAgentOutput", "claim-foundry/twoCallAgentOutput",
    "claim-foundry/claimPosture", "cf3/", "cf4/candidates.py", "cf4/phase1",
  ];
  for (const file of cf5Files) {
    const source = readFileSync(path.join(here, file), "utf8");
    for (const fragment of forbiddenImportFragments) {
      assert.ok(!source.includes(fragment),
        `${file} references forbidden semantic module fragment "${fragment}"`);
    }
  }
});
